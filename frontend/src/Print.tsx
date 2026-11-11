import { type DragEvent, useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { api, type OfficeDocument, type PrintJob, type PrintStatus } from './api';
import { type UserContext, userContext } from './context';
import { ClientSelect, RoomSelect, useClientRecord } from './DocumentCreate';
import { t, tf } from './i18n';
import { formatDateTime } from './labels';
import { ViewFrame } from './Layout';
import type { Route } from './router';
import { useShell } from './shell';
import { Drawer, ErrorText, Field, Loading, StatusBadge, useAction, useLoad } from './ui';

const SCAN_ACCEPT = '.pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png';

/** Pull printing: internal roles except field representatives (they cannot open office documents). */
export function canPrint(user: UserContext = userContext()): boolean {
  if (user.scope === 'external') return false;
  return user.jobRole === null || ['PLATFORM_ADMIN', 'HQ_ADMIN', 'ACCOUNT_MANAGER'].includes(user.jobRole);
}

export function canScan(user: UserContext = userContext()): boolean {
  return user.scope !== 'external' && user.jobRole !== 'CLIENT_VIEWER';
}

let statusPromise: Promise<PrintStatus> | null = null;
function usePrintStatus(refresh = 0): PrintStatus | null {
  const [status, setStatus] = useState<PrintStatus | null>(null);
  useEffect(() => {
    if (refresh) statusPromise = null;
    statusPromise ??= api.printStatus().catch(() => ({ configured: false, connected: false, printer: null, jobTtlMinutes: 240, error: null }));
    void statusPromise.then(setStatus);
  }, [refresh]);
  return status;
}

function PrintServerNotice({ status }: { status: PrintStatus | null }) {
  if (!status || status.connected) return null;
  return (
    <div className="assistant-tip">
      <strong>{status.configured ? t("Print server not reachable") : t("Print server not connected")}</strong>
      <p>
        {status.configured
          ? tf("Agera cannot reach the print server ({error}). Jobs stay in the queue; try releasing again later.", { error: status.error ?? '' })
          : t("No CUPS print server is configured yet (CUPS_IPP_URL). You can queue documents, but they can only be released once an administrator connects the print server.")}
      </p>
    </div>
  );
}

function releaseUrl(code: string): string {
  return `${window.location.origin}${window.location.pathname}#/nexus/print?code=${code}`;
}

function QrCode({ text }: { text: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    void QRCode.toDataURL(text, { margin: 1, width: 192 }).then(setSrc, () => setSrc(null));
  }, [text]);
  return src ? <img className="print-qr" src={src} width={192} height={192} alt={t("QR code to release this print job")} /> : null;
}

function JobCode({ job }: { job: PrintJob }) {
  if (!job.code) return null;
  return (
    <div className="print-code">
      <QrCode text={releaseUrl(job.code)} />
      <div>
        <p className="muted small">{t("Release code")}</p>
        <p className="print-code-digits" aria-label={job.code.split('').join(' ')}>{job.code}</p>
        <p className="muted small">{tf("Valid until {time}", { time: formatDateTime(job.expiresAt) })}</p>
      </div>
    </div>
  );
}

/** "Print (Pull-Print)" on a document: queues it and shows the release code and QR code. */
export function PrintButton({ documentId, className = 'secondary' }: { documentId: string; className?: string }) {
  const { busy, error, run } = useAction();
  const [job, setJob] = useState<PrintJob | null>(null);
  const status = usePrintStatus();
  if (!canPrint()) return null;
  return (
    <>
      <button className={className} disabled={busy} onClick={() => void run(() => api.queuePrint(documentId)).then((j) => j && setJob(j))} title={t("Queue for pull printing; it prints when you release it at the printer")}>
        {t("Print (Pull-Print)")}
      </button>
      {error && <ErrorText error={error} />}
      {job && (
        <Drawer title={t("Print (Pull-Print)")} onClose={() => setJob(null)}>
          <p>{tf("{title} is in your print queue.", { title: job.documentTitle })}</p>
          <PrintServerNotice status={status} />
          <JobCode job={job} />
          <ol className="print-steps">
            <li>{t("Go to the printer.")}</li>
            <li>{t("Scan the QR code with your phone, or open Navigator › Documents › Print & Scan and enter the code.")}</li>
            <li>{t("Press Release to printer. Only then is the document printed.")}</li>
          </ol>
          <p><a href="#/nexus/print">{t("Open my print queue")}</a></p>
        </Drawer>
      )}
    </>
  );
}

const JOB_STATUS: Record<PrintJob['status'], string> = { queued: "Waiting for release", released: "Printed", expired: "Expired" };

function ReleasePanel({ initialCode, status, onReleased }: { initialCode: string; status: PrintStatus | null; onReleased: () => void }) {
  const { notify } = useShell();
  const { busy, error, run } = useAction();
  const [code, setCode] = useState(initialCode);
  const valid = /^[0-9]{6}$/.test(code);
  const release = () =>
    void run(() => api.releasePrint(code)).then((job) => {
      if (!job) return;
      notify(tf("{title} sent to the printer", { title: job.documentTitle }));
      setCode('');
      onReleased();
    });
  return (
    <div className="card-panel">
      <h2>{t("Release a print job")}</h2>
      <p className="muted">{t("At the printer, enter the 6-digit code of your job (or scan its QR code) to print it.")}</p>
      <div className="print-release">
        <Field label={t("Release code")}>
          <input inputMode="numeric" autoComplete="off" maxLength={6} pattern="[0-9]{6}" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="000000" />
        </Field>
        <button className="primary" disabled={!valid || busy || status?.configured === false} onClick={release}>{t("Release to printer")}</button>
      </div>
      {status?.configured === false && <p className="muted small">{t("Releasing is possible once the print server is connected.")}</p>}
      <ErrorText error={error} />
    </div>
  );
}

function JobsPanel({ reload }: { reload: number }) {
  const jobs = useLoad(() => api.printJobs(), [reload]);
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="card-panel">
      <div className="panel-head">
        <h2>{t("My print queue")}</h2>
        <button className="secondary small" onClick={jobs.reload}>{t("Refresh")}</button>
      </div>
      {!jobs.data ? <Loading error={jobs.error} /> : jobs.data.length === 0 ? <p className="muted">{t("No print jobs yet. Use Print (Pull-Print) on an office document or a client room document.")}</p> : (
        <table className="grid">
          <thead><tr><th>{t("Document")}</th><th>{t("Version")}</th><th>{t("Copies")}</th><th>{t("Status")}</th><th>{t("Queued")}</th><th>{t("Release code")}</th></tr></thead>
          <tbody>
            {jobs.data.map((j) => (
              <tr key={j.id}>
                <td>{j.documentTitle}</td>
                <td>v{j.version}</td>
                <td>{j.copies}</td>
                <td><StatusBadge status={j.status === 'released' ? 'COMPLETED' : j.status === 'expired' ? 'expired' : 'pending_approval'} label={t(JOB_STATUS[j.status])} /></td>
                <td>{formatDateTime(j.createdAt)}{j.releasedAt && <div className="muted small">{tf("Printed {time}", { time: formatDateTime(j.releasedAt) })}</div>}</td>
                <td>
                  {j.code ? (
                    <>
                      <code>{j.code}</code>{' '}
                      <button className="link-button" aria-expanded={open === j.id} onClick={() => setOpen(open === j.id ? null : j.id)}>{open === j.id ? t("Hide QR") : t("Show QR")}</button>
                      {open === j.id && <JobCode job={j} />}
                    </>
                  ) : '–'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/** Scan-to-Vault: drop zone and phone camera; the scan becomes a DRAFT document of the client (optionally in a client room). */
function ScanPanel({ fieldRole }: { fieldRole: boolean }) {
  const { notify } = useShell();
  const { busy, error, run, setError } = useAction();
  const [clientId, setClientId] = useState('');
  const [roomId, setRoomId] = useState('');
  const [title, setTitle] = useState('');
  const [over, setOver] = useState(false);
  const [done, setDone] = useState<OfficeDocument[]>([]);
  const record = useClientRecord(fieldRole ? '' : clientId);
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  useEffect(() => setRoomId(''), [clientId]);

  const send = (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    if (!clientId) return setError(t("Choose a client first."));
    void run(() => api.scanToVault(file, { clientId, clientRoomId: roomId || undefined, title: title.trim() || undefined })).then((doc) => {
      [fileInput.current, cameraInput.current].forEach((i) => i && (i.value = ''));
      if (!doc) return;
      setTitle('');
      setDone((d) => [doc, ...d]);
      notify(tf("{title} stored in the vault as Draft", { title: doc.title }));
    });
  };
  const drop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    send(e.dataTransfer.files);
  };

  return (
    <div className="card-panel">
      <h2>{t("Scan to vault")}</h2>
      <p className="muted">{t("Upload a scanned PDF or a photo (JPG, PNG). It is stored with the client as a Draft document with a SHA-256 fingerprint, and logged in the activity log.")}</p>
      <ClientSelect value={clientId} onChange={setClientId} />
      {!fieldRole && clientId && <RoomSelect record={record} value={roomId} onChange={setRoomId} optionalLabel={t("No client room")} />}
      <Field label={t("Title")} hint={t("Optional; defaults to the file name")}>
        <input value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <div
        className={`scan-dropzone${over ? ' over' : ''}${!clientId ? ' disabled' : ''}`}
        onDragOver={(e) => (e.preventDefault(), setOver(true))}
        onDragLeave={() => setOver(false)}
        onDrop={drop}
      >
        <p>{busy ? t("Uploading…") : t("Drop a scan here")}</p>
        <div className="row-actions">
          <button className="secondary" disabled={busy || !clientId} onClick={() => fileInput.current?.click()}>{t("Choose file…")}</button>
          <button className="secondary" disabled={busy || !clientId} onClick={() => cameraInput.current?.click()}>{t("Use camera")}</button>
        </div>
        <p className="muted small">{t("PDF, JPG or PNG, at most 20 MB")}</p>
      </div>
      <input ref={fileInput} type="file" accept={SCAN_ACCEPT} hidden onChange={(e) => send(e.target.files)} />
      <input ref={cameraInput} type="file" accept="image/*" capture="environment" hidden onChange={(e) => send(e.target.files)} />
      <ErrorText error={error} />
      {done.length > 0 && (
        <ul className="scan-done">
          {done.map((d) => (
            <li key={d.id}>
              <strong>{d.title}</strong> · {d.clientName ?? ''} · {t("Draft")} · SHA-256 <code>{d.sha256.slice(0, 12)}…</code>
              {!fieldRole && <> · <a href={`#/nexus/clients/${d.clientId}?tab=documents`}>{t("Open client")}</a></>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Navigator › Documents › Print & Scan (and RetailPower › Scan to vault for field representatives). */
export function PrintScanView({ route, suite }: { route: Route; suite: 'nexus' | 'retailpower' }) {
  const user = userContext();
  const [reload, setReload] = useState(0);
  const status = usePrintStatus(reload);
  const printing = canPrint(user) && suite === 'nexus';
  const title = printing ? t("Print & Scan") : t("Scan to vault");
  if (!canScan(user)) return <ViewFrame title={title}><p className="muted">{t("Not available to your role.")}</p></ViewFrame>;
  return (
    <ViewFrame
      title={title}
      subtitle={printing ? t("Pull printing on your own print server, and scans straight into the client's document vault") : t("Scans straight into the client's document vault")}
      crumbs={[{ label: suite === 'nexus' ? t("Nexus") : t("RetailPower"), href: `#/${suite}` }, { label: title }]}
    >
      {printing && (
        <>
          <PrintServerNotice status={status} />
          <ReleasePanel initialCode={route.params.get('code') ?? ''} status={status} onReleased={() => setReload((r) => r + 1)} />
          <JobsPanel reload={reload} />
        </>
      )}
      <ScanPanel fieldRole={user.jobRole === 'FIELD_REPRESENTATIVE'} />
    </ViewFrame>
  );
}
