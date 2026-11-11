import { useEffect, useRef, useState } from 'react';
import { api, type AgreementSignature, type RoomDocument } from '../api';
import { formatDateTime } from '../labels';
import { useShell } from '../shell';
import { ErrorText, Loading, useAction, useLoad } from '../ui';
import { GenerateDocumentDrawer } from './Commercial';
import { t, tf } from '../i18n';
import { IdmsBadge, IdmsControl, isLocked } from '../Idms';
import { PrintButton } from '../Print';

const ACCEPT = '.pdf,.docx,.xlsx,.pptx,.doc,.xls,.csv,.txt,.png,.jpg,.jpeg';

function size(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function Versions({ roomId, doc }: { roomId: string; doc: RoomDocument }) {
  const versions = useLoad(() => api.documentVersions(roomId, doc.id), [roomId, doc.id, doc.currentVersion]);
  const { error, run } = useAction();
  if (!versions.data) return <Loading error={versions.error} />;
  return (
    <ul className="version-list">
      {versions.data.map((v) => (
        <li key={v.id}>
          <button className="link-button" onClick={() => void run(() => api.downloadRoomDocument(roomId, doc.id, v.fileName, v.version))}>
            {t("Version")} {v.version}: {v.fileName}
          </button>{' '}
          <span className="muted small">
            {size(v.sizeBytes)} · {v.uploadedByName ?? t("Agera")} · {formatDateTime(v.createdAt)}  {t("· SHA-256")} <code>{v.sha256.slice(0, 12)}…</code>
          </span>
        </li>
      ))}
      <ErrorText error={error} />
    </ul>
  );
}

/** Document vault of a client room: internal users upload, version, rename and delete; client contacts download (downloads are recorded). */
export function RoomDocumentsPanel({ roomId, external, active, compact = false }: { roomId: string; external: boolean; active: boolean; compact?: boolean }) {
  const { notify } = useShell();
  const docs = useLoad(() => api.roomDocuments(roomId), [roomId]);
  const { busy, error, run } = useAction();
  const fileInput = useRef<HTMLInputElement>(null);
  const [versionOf, setVersionOf] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const canEdit = !external && active;
  const [generating, setGenerating] = useState(false);
  const upload = (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    const documentId = versionOf ?? undefined;
    void run(() => api.uploadRoomDocument(roomId, file, { documentId })).then((r) => {
      if (fileInput.current) fileInput.current.value = '';
      setVersionOf(null);
      if (r) (notify(documentId ? tf("Version {v} of {title} uploaded", { v: r.currentVersion, title: r.title }) : tf("{title} uploaded", { title: r.title })), docs.reload());
    });
  };
  const pick = (documentId: string | null) => {
    setVersionOf(documentId);
    fileInput.current?.click();
  };
  const rename = (d: RoomDocument) => {
    const title = window.prompt('New title', d.title)?.trim();
    if (title && title !== d.title) void run(() => api.renameRoomDocument(roomId, d.id, title)).then((r) => r && docs.reload());
  };
  const remove = (d: RoomDocument) =>
    window.confirm(tf("Delete {title} and all its versions?", { title: d.title })) && void run(() => api.deleteRoomDocument(roomId, d.id)).then((r) => r !== undefined && (notify(t("Document deleted")), docs.reload()));
  const list = docs.data ?? [];
  return (
    <div className={compact ? '' : 'card-panel'}>
      {!compact && (
        <div className="panel-head">
          <h2>{t("Documents")}</h2>
          {canEdit && <span className="panel-actions"><button className="secondary" disabled={busy} onClick={() => setGenerating(true)}>{t("Generate from template…")}</button> <button className="primary" disabled={busy} onClick={() => pick(null)}>{t("+ Upload document")}</button></span>}
        </div>
      )}
      {generating && <GenerateDocumentDrawer roomId={roomId} onClose={() => setGenerating(false)} onDone={() => (setGenerating(false), notify(t("Document generated")), docs.reload())} />}
      <input ref={fileInput} type="file" accept={ACCEPT} hidden onChange={(e) => upload(e.target.files)} />
      {!compact && (
        <p className="muted">
          {external ? t("Documents Agera shared with you. Your downloads are visible to your Agera contact.") : t("Shared with the client contacts of this room. Client downloads are counted; every upload keeps the earlier versions.")}
        </p>
      )}
      <ErrorText error={error ?? docs.error} />
      {!docs.data ? (
        <Loading error={docs.error} />
      ) : list.length === 0 ? (
        <p className="muted">{t("No documents shared in this room yet.")}{canEdit && compact && t(" Use the Documents tab to upload one.")}</p>
      ) : (
        <ul className="doc-list">
          {list.map((d) => (
            <li key={d.id}>
              <div className="doc-main">
                <button className="link-button doc-title" onClick={() => void run(() => api.downloadRoomDocument(roomId, d.id, d.fileName))}>{d.title}</button>
                <span className="muted small">
                  {external ? <IdmsBadge status={d.idmsStatus} /> : <IdmsControl kind="documents" id={d.id} status={d.idmsStatus} onChanged={docs.reload} compact />} v{d.currentVersion} · {d.fileName} · {size(d.sizeBytes)}
                  {!external && ` · ${d.downloads} client download${d.downloads === 1 ? '' : 's'}`}
                </span>
              </div>
              {!compact && (
                <div className="doc-actions">
                  <button className="secondary small" onClick={() => void run(() => api.downloadRoomDocument(roomId, d.id, d.fileName))}>{t("Download")}</button>
                  {!external && <PrintButton documentId={d.id} className="secondary small" />}
                  <button className="secondary small" onClick={() => setOpen(open === d.id ? null : d.id)}>{open === d.id ? t("Hide versions") : t("Versions")}</button>
                  {canEdit && !isLocked(d.idmsStatus) && <button className="secondary small" disabled={busy} onClick={() => pick(d.id)}>{t("Upload new version")}</button>}
                  {canEdit && !isLocked(d.idmsStatus) && <button className="secondary small" onClick={() => rename(d)}>{t("Rename")}</button>}
                  {canEdit && !isLocked(d.idmsStatus) && <button className="secondary small danger" onClick={() => remove(d)}>{t("Delete")}</button>}
                </div>
              )}
              {open === d.id && <Versions roomId={roomId} doc={d} />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SignatureImage({ agreementId, signatureId }: { agreementId: string; signatureId: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let url: string | null = null;
    api.photoBlob(api.signatureImageUrl(agreementId, signatureId)).then((blob) => setSrc((url = URL.createObjectURL(blob))), () => setSrc(null));
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [agreementId, signatureId]);
  return src ? <img className="signature-img" src={src} alt={t("Drawn signature")} /> : null;
}

function SignaturePad({ onChange }: { onChange: (dataUrl: string | null) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = canvas.current!;
    const r = c.getBoundingClientRect();
    return [((e.clientX - r.left) * c.width) / r.width, ((e.clientY - r.top) * c.height) / r.height] as const;
  };
  const start = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const ctx = canvas.current!.getContext('2d')!;
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#0f172a';
    ctx.beginPath();
    ctx.moveTo(...point(e));
    drawing.current = true;
    canvas.current!.setPointerCapture(e.pointerId);
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const ctx = canvas.current!.getContext('2d')!;
    ctx.lineTo(...point(e));
    ctx.stroke();
  };
  const end = () => {
    if (!drawing.current) return;
    drawing.current = false;
    onChange(canvas.current!.toDataURL('image/png'));
  };
  const clear = () => {
    const c = canvas.current!;
    c.getContext('2d')!.clearRect(0, 0, c.width, c.height);
    onChange(null);
  };
  return (
    <div className="signature-pad">
      <canvas ref={canvas} width={560} height={160} aria-label={t("Draw your signature")} onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerLeave={end} />
      <button type="button" className="link-button" onClick={clear}>{t("Clear")}</button>
    </div>
  );
}

/** Contract sign-off: client contacts draw a signature on an agreement awaiting approval; everyone sees the signature record. */
export function SignaturePanel({ agreementId, status, external }: { agreementId: string; status: string; external: boolean }) {
  const { notify } = useShell();
  const signatures = useLoad(() => api.signatures(agreementId), [agreementId]);
  const [name, setName] = useState('');
  const [image, setImage] = useState<string | null>(null);
  const [agree, setAgree] = useState(false);
  const { busy, error, run } = useAction();
  const list: AgreementSignature[] = signatures.data ?? [];
  const canSign = external && status === 'pending_approval';
  const sign = () =>
    image &&
    void run(() => api.signAgreement(agreementId, { signerName: name.trim(), signatureImage: image })).then((r) => r && (notify(t("Agreement signed")), signatures.reload(), setImage(null)));
  if (!canSign && list.length === 0 && !external) {
    return (
      <div className="card-panel">
        <h2>{t("Electronic signature")}</h2>
        <p className="muted">{t("Not signed yet. The client contact signs in the client portal while the agreement is awaiting approval.")}</p>
      </div>
    );
  }
  return (
    <div className="card-panel signoff-panel">
      <h2>{t("Contract sign-off")}</h2>
      {list.map((s) => (
        <div key={s.id} className="signature-record">
          <SignatureImage agreementId={agreementId} signatureId={s.id} />
          <div>
            <strong>{t("Signed by")} {s.signerName}</strong> ({s.signerEmail}{t(") on")} {formatDateTime(s.signedAt)}
            <div className="muted small">
              {t("Simple electronic signature · SHA-256")} <code>{s.contentSha256}</code>
            </div>
          </div>
        </div>
      ))}
      {canSign && (
        <>
          <p className="muted">{t("Draw your signature below. It is stored with your login e-mail, the time and a fingerprint (SHA-256) of the agreement, and counts as accepting the terms.")}</p>
          <label className="field-label" htmlFor="signer-name">{t("Full name")}</label>
          <input id="signer-name" value={name} maxLength={200} onChange={(e) => setName(e.target.value)} />
          <SignaturePad onChange={setImage} />
          <label className="checkbox">
            <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />  {t("I have read the agreement and sign it on behalf of my organisation")}</label>
          <div className="form-actions start">
            <button className="primary" disabled={busy || !image || !name.trim() || !agree} onClick={sign}>{t("Sign agreement")}</button>
          </div>
        </>
      )}
      {external && !canSign && list.length === 0 && <p className="muted">{t("This agreement can no longer be signed here.")}</p>}
      <ErrorText error={error ?? signatures.error} />
    </div>
  );
}
