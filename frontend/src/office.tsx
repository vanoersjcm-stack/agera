import { type FormEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { api, type DocumentTemplate, type EditorSession, type OfficeDocument, type OfficeVersion } from './api';
import { ClientSelect, csvOf, DocIcon, type DocIconKind, initialClient, RoomSelect, scheduleGrid, tiersGrid, useClientRecord } from './DocumentCreate';
import { formatDateTime } from './labels';
import { getLanguage, t as tr, tf } from './i18n';
import type { NewDefaults, NewKind } from './shell';
import { ErrorText, Field, Tabs, useAction } from './ui';
import { ViewFrame } from './Layout';

type Format = 'docx' | 'xlsx' | 'pptx';
const OPEN_EVENT = 'agera:office-open';
export const CLOSED_EVENT = 'agera:office-closed';

let statusPromise: Promise<boolean> | null = null;

/** Whether Collabora Online answers; checked once per page load. */
export function useEditorConnected(): boolean | null {
  const [connected, setConnected] = useState<boolean | null>(null);
  useEffect(() => {
    statusPromise ??= api.editorStatus().then((s) => s.connected, () => false);
    void statusPromise.then(setConnected);
  }, []);
  return connected;
}

export function openOfficeEditor(documentId: string): void {
  window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: documentId }));
}

const FORMAT_ICON: Record<string, DocIconKind> = { docx: 'text', odt: 'text', doc: 'text', xlsx: 'sheet', ods: 'sheet', xls: 'sheet', csv: 'sheet', pptx: 'slides', odp: 'slides' };

/** Mounted once in the shell: opens the full-screen editor when openOfficeEditor() is called anywhere. */
export function OfficeEditorHost() {
  const [session, setSession] = useState<EditorSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const onOpen = (e: Event) => {
      setError(null);
      api.officeSession((e as CustomEvent<string>).detail).then(setSession, (err: Error) => setError(err.message));
    };
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, []);
  const close = () => {
    setSession(null);
    window.dispatchEvent(new Event(CLOSED_EVENT));
  };
  if (error) {
    return (
      <div className="office-overlay" role="alertdialog" aria-label={tr("Agera Office")}>
        <div className="office-error card-panel">
          <p>{tr("The document could not be opened in the editor.")}</p>
          <ErrorText error={error} />
          <button className="primary" onClick={() => setError(null)}>{tr("Close")}</button>
        </div>
      </div>
    );
  }
  return session ? <OfficeEditor session={session} onClose={close} /> : null;
}

/** Collabora Online in an iframe; the access token is POSTed so it never appears in the frame URL. */
function OfficeEditor({ session, onClose }: { session: EditorSession; onClose: () => void }) {
  const formRef = useRef<HTMLFormElement | null>(null);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const frameName = `office-frame-${session.documentId}`;
  const src = `${session.editorUrl}&lang=${getLanguage() === 'nl' ? 'nl' : 'en-GB'}&closebutton=1`;

  useEffect(() => {
    formRef.current?.submit();
  }, [session.accessToken]);

  useEffect(() => {
    const post = (msg: object) => frameRef.current?.contentWindow?.postMessage(JSON.stringify({ ...msg, SendTime: Date.now() }), window.location.origin);
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frameRef.current?.contentWindow) return;
      let data: { MessageId?: string; Values?: { Status?: string; success?: boolean } };
      try {
        data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
      } catch {
        return;
      }
      if (data.MessageId === 'App_LoadingStatus' && data.Values?.Status === 'Frame_Ready') post({ MessageId: 'Host_PostmessageReady' });
      if (data.MessageId === 'UI_Close') onClose();
      if (data.MessageId === 'Action_Save_Resp' && data.Values?.success !== false) setSaved(new Date().toLocaleTimeString());
      if (data.MessageId === 'Doc_ModifiedStatus') setSaved((s) => s);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [onClose]);

  return (
    <div className="office-overlay" role="dialog" aria-modal="true" aria-label={session.documentTitle}>
      <div className="office-bar">
        <div className="office-title">
          <DocIcon kind={FORMAT_ICON[session.fileFormat] ?? 'text'} />
          <strong>{session.documentTitle}</strong>
          {session.clientName && <span className="office-pill">{session.clientName}</span>}
          {session.contactName && <span className="office-pill muted-pill">{session.contactName}</span>}
        </div>
        <div className="office-actions">
          <span className="office-saved">{saved ? tf("Saved in the client dossier at {time}", { time: saved }) : tr("Changes are saved to the client dossier automatically")}</span>
          <button className="secondary" onClick={onClose}>{tr("Close and return to Agera")}</button>
        </div>
      </div>
      <form ref={formRef} action={src} method="post" target={frameName} className="office-form">
        <input type="hidden" name="access_token" value={session.accessToken} />
        <input type="hidden" name="access_token_ttl" value={String(session.accessTokenTtl)} />
      </form>
      <iframe ref={frameRef} name={frameName} title={tf("Agera Office: {title}", { title: session.documentTitle })} className="office-frame" allow="clipboard-read; clipboard-write; fullscreen" />
    </div>
  );
}

interface FormProps {
  defaults: NewDefaults;
  onDone: (route?: string, message?: string) => void;
  onCancel: () => void;
}

/** "+ New" document entries: LibreOffice when Collabora is connected, otherwise the simple built-in editor. */
export function OfficeOrSimple({ format, simple, ...props }: FormProps & { format: Format; simple: ReactNode }) {
  const connected = useEditorConnected();
  if (connected === null) return <p className="muted">{tr("Checking Agera Office…")}</p>;
  if (connected) return <NewOfficeDocumentForm format={format} {...props} />;
  return (
    <>
      <div className="assistant-tip">
        <strong>{tr("Agera Office not connected")}</strong>
        <p>{simple ? tr("Agera Office is not reachable, so this opens the simple editor instead.") : tr("Presentations need Agera Office, which is not reachable right now.")}</p>
      </div>
      {simple}
    </>
  );
}

const FORMAT_LABEL: Record<Format, string> = { docx: 'Word document', xlsx: 'Spreadsheet', pptx: 'Presentation' };

function NewOfficeDocumentForm({ format, defaults, onDone, onCancel }: FormProps & { format: Format }) {
  const [clientId, setClientId] = useState(initialClient(defaults));
  const record = useClientRecord(clientId);
  const [contactId, setContactId] = useState('');
  const [roomId, setRoomId] = useState('');
  const [title, setTitle] = useState('');
  const [templates, setTemplates] = useState<DocumentTemplate[]>([]);
  const [templateId, setTemplateId] = useState('');
  const [starter, setStarter] = useState<'blank' | 'tiers' | 'schedule'>('blank');
  const { busy, error, run } = useAction();

  useEffect(() => {
    if (format === 'docx') api.documentTemplates().then((r) => setTemplates(r.items.filter((x) => x.kind !== 'mail' && x.active !== false)), () => setTemplates([]));
  }, [format]);
  useEffect(() => {
    setRoomId('');
    setContactId('');
  }, [clientId]);
  useEffect(() => {
    if (record && !contactId) setContactId(record.contacts.find((c) => c.isPrimary)?.id ?? '');
  }, [record]);

  const template = templates.find((x) => x.id === templateId);
  const suggested = template ? template.name : starter === 'tiers' ? tr("Volume price tiers") : starter === 'schedule' ? tr("Payment schedule") : tr(FORMAT_LABEL[format]);
  const docTitle = title.trim() || (record ? `${suggested} - ${record.client.name}` : suggested);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!clientId) return;
    void run(async () => {
      let starterCsv: string | null = null;
      if (format === 'xlsx' && starter === 'tiers') starterCsv = csvOf(tiersGrid(await api.products()));
      if (format === 'xlsx' && starter === 'schedule') starterCsv = csvOf(scheduleGrid(record));
      return api.createOfficeDocument({ clientId, contactId: contactId || null, clientRoomId: roomId || null, title: docTitle, format, templateId: templateId || null, starterCsv });
    }).then((doc) => {
      if (!doc) return;
      onDone(`/nexus/clients/${clientId}?tab=documents`, tf("{title} created", { title: doc.title }));
      openOfficeEditor(doc.id);
    });
  };

  return (
    <form className="doc-form" onSubmit={submit}>
      <ClientSelect value={clientId} onChange={setClientId} />
      {record && (
        <Field label={tr("Contact person")} hint={tr("Optional")}>
          <select value={contactId} onChange={(e) => setContactId(e.target.value)}>
            <option value="">{tr("No contact")}</option>
            {record.contacts.map((c) => <option key={c.id} value={c.id}>{[c.firstName, c.lastName].filter(Boolean).join(' ')}</option>)}
          </select>
        </Field>
      )}
      {format === 'docx' && (
        <Field label={tr("Start from")} hint={tr("Template fields such as the client's name, KvK and address are filled in automatically.")}>
          <select value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
            <option value="">{tr("Blank document")}</option>
            {templates.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        </Field>
      )}
      {format === 'xlsx' && (
        <Field label={tr("Start from")}>
          <select value={starter} onChange={(e) => setStarter(e.target.value as typeof starter)}>
            <option value="blank">{tr("Blank spreadsheet")}</option>
            <option value="tiers">{tr("Volume price tiers (from the product catalogue)")}</option>
            <option value="schedule">{tr("Payment schedule (from active agreements)")}</option>
          </select>
        </Field>
      )}
      <Field label={tr("Title")}><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={docTitle} /></Field>
      {clientId && <RoomSelect record={record} value={roomId} onChange={setRoomId} optionalLabel={tr("Client dossier only")} />}
      <p className="hint">{tr("The document is stored in the client dossier with version history and opens in Agera Office.")}</p>
      <ErrorText error={error} />
      <div className="form-actions">
        <button type="button" className="secondary" onClick={onCancel}>{tr("Cancel")}</button>
        <button type="submit" className="primary" disabled={busy || !clientId}>{tr("Open in Agera Office")}</button>
      </div>
    </form>
  );
}

// Client dossier tab ----------------------------------------------------------------------------------------------

const GROUPS: { id: string; label: string; formats: string[] }[] = [
  { id: 'word', label: 'Word documents', formats: ['docx', 'odt', 'doc'] },
  { id: 'sheets', label: 'Spreadsheets & price matrices', formats: ['xlsx', 'ods', 'xls', 'csv'] },
  { id: 'slides', label: 'Presentations', formats: ['pptx', 'odp'] },
  { id: 'other', label: 'Other files', formats: [] },
];
const KNOWN = new Set(GROUPS.flatMap((g) => g.formats));
const groupOf = (d: OfficeDocument) => GROUPS.find((g) => g.formats.includes(d.fileFormat ?? ''))?.id ?? 'other';
const kb = (n: number) => (n < 1024 * 1024 ? tf("{n} KB", { n: Math.max(1, Math.round(n / 1024)) }) : tf("{n} MB", { n: (n / 1024 / 1024).toFixed(1) }));

export function ClientOfficeDocuments({ clientId, canCreate, openNew }: { clientId: string; canCreate: boolean; openNew: (kind: NewKind, defaults?: NewDefaults) => void }) {
  const connected = useEditorConnected();
  const [docs, setDocs] = useState<OfficeDocument[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [group, setGroup] = useState('word');
  const [history, setHistory] = useState<string | null>(null);

  const load = () => api.officeDocuments(clientId).then(setDocs, (e: Error) => setError(e.message));
  useEffect(() => {
    void load();
    window.addEventListener(CLOSED_EVENT, load);
    return () => window.removeEventListener(CLOSED_EVENT, load);
  }, [clientId]);

  const count = (id: string) => (docs ?? []).filter((d) => groupOf(d) === id).length;
  const shown = (docs ?? []).filter((d) => groupOf(d) === group);

  return (
    <div className="card-panel">
      <div className="panel-head">
        <h2>{tr("Office documents")}</h2>
        {canCreate && (
          <div className="row-actions">
            <button className="secondary" onClick={() => openNew('doc_text', { clientId })}><DocIcon kind="text" /> {tr("+ Word document")}</button>
            <button className="secondary" onClick={() => openNew('doc_sheet', { clientId })}><DocIcon kind="sheet" /> {tr("+ Spreadsheet")}</button>
            <button className="secondary" onClick={() => openNew('doc_slides', { clientId })}><DocIcon kind="slides" /> {tr("+ Presentation")}</button>
          </div>
        )}
      </div>
      {connected === false && (
        <div className="assistant-tip">
          <strong>{tr("Agera Office not connected")}</strong>
          <p>{tr("Agera Office is not reachable. You can still download files and see their history.")}</p>
        </div>
      )}
      <Tabs tabs={GROUPS.filter((g) => g.id !== 'other' || count('other') > 0).map((g) => ({ id: g.id, label: `${tr(g.label)} (${count(g.id)})` }))} active={group} onChange={setGroup} />
      <ErrorText error={error} />
      {docs === null ? <p className="muted">{tr("Loading…")}</p> : shown.length === 0 ? <p className="muted">{tr("No documents of this type yet.")}</p> : (
        <table className="grid">
          <thead><tr><th>{tr("Document")}</th><th>{tr("Linked to")}</th><th>{tr("Version")}</th><th>{tr("Last edited")}</th><th /></tr></thead>
          <tbody>
            {shown.map((d) => (
              <DocRow key={d.id} doc={d} canEdit={connected === true && d.editable && KNOWN.has(d.fileFormat ?? '')} showHistory={history === d.id} onHistory={() => setHistory(history === d.id ? null : d.id)} />
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/** Navigator › Documents › Drafts: office documents of all clients that are not yet shared in a client room. */
export function DraftDocumentsView() {
  const connected = useEditorConnected();
  const [docs, setDocs] = useState<OfficeDocument[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<string | null>(null);
  const load = () => api.officeDrafts().then(setDocs, (e: Error) => setError(e.message));
  useEffect(() => {
    void load();
    window.addEventListener(CLOSED_EVENT, load);
    return () => window.removeEventListener(CLOSED_EVENT, load);
  }, []);
  return (
    <ViewFrame title={tr("Draft documents")} subtitle={tr("Office documents not yet shared in a client room, newest first")} crumbs={[{ label: tr("Nexus"), href: '#/nexus' }, { label: tr("Draft documents") }]}>
      <ErrorText error={error} />
      {docs === null ? <p className="muted">{tr("Loading…")}</p> : docs.length === 0 ? <p className="muted">{tr("No draft documents.")}</p> : (
        <table className="grid">
          <thead><tr><th>{tr("Document")}</th><th>{tr("Linked to")}</th><th>{tr("Version")}</th><th>{tr("Last edited")}</th><th /></tr></thead>
          <tbody>
            {docs.map((d) => (
              <DocRow key={d.id} doc={d} showClient canEdit={connected === true && d.editable && KNOWN.has(d.fileFormat ?? '')} showHistory={history === d.id} onHistory={() => setHistory(history === d.id ? null : d.id)} />
            ))}
          </tbody>
        </table>
      )}
    </ViewFrame>
  );
}

function DocRow({ doc, canEdit, showHistory, onHistory, showClient = false }: { doc: OfficeDocument; canEdit: boolean; showHistory: boolean; onHistory: () => void; showClient?: boolean }) {
  const [versions, setVersions] = useState<OfficeVersion[] | null>(null);
  useEffect(() => {
    if (showHistory) api.officeVersions(doc.id).then(setVersions, () => setVersions([]));
  }, [showHistory, doc.currentVersion]);
  const links = [doc.contactName, doc.roomName && tf("Room: {name}", { name: doc.roomName }), doc.dealName && tf("Deal: {name}", { name: doc.dealName })].filter(Boolean).join(' · ');
  return (
    <>
      <tr>
        <td><DocIcon kind={FORMAT_ICON[doc.fileFormat ?? ''] ?? 'text'} /> <strong>{doc.title}</strong><div className="muted small">{doc.fileName} · {kb(doc.sizeBytes)}</div></td>
        <td>
          {showClient && doc.clientName && <div><a href={`#/nexus/clients/${doc.clientId}?tab=documents`}>{doc.clientName}</a></div>}
          {links || <span className="muted">{tr("Client dossier")}</span>}
        </td>
        <td>v{doc.currentVersion}</td>
        <td>{formatDateTime(doc.updatedAt)}<div className="muted small">{doc.lastModifiedByName ?? '—'}</div></td>
        <td className="row-actions">
          {canEdit && <button className="primary" onClick={() => openOfficeEditor(doc.id)}>{tr("Edit")}</button>}
          <button className="secondary" onClick={() => void api.downloadOfficeDocument(doc.id, doc.fileName)}>{tr("Download")}</button>
          <button className="link-button" aria-expanded={showHistory} onClick={onHistory}>{tr("History")}</button>
        </td>
      </tr>
      {showHistory && (
        <tr className="history-row">
          <td colSpan={5}>
            {versions === null ? <p className="muted">{tr("Loading…")}</p> : (
              <table className="grid compact">
                <thead><tr><th>{tr("Version")}</th><th>{tr("Saved")}</th><th>{tr("By")}</th><th>{tr("Size")}</th><th>{tr("SHA-256 fingerprint")}</th><th /></tr></thead>
                <tbody>
                  {versions.map((v) => (
                    <tr key={v.id}>
                      <td>v{v.version}</td>
                      <td>{formatDateTime(v.createdAt)}</td>
                      <td>{v.uploadedByName ?? '—'}</td>
                      <td>{kb(v.sizeBytes)}</td>
                      <td><span className="mono" title={v.sha256}>{v.sha256.slice(0, 16)}…</span></td>
                      <td><button className="link-button" onClick={() => void api.downloadOfficeDocument(doc.id, v.fileName, v.version)}>{tr("Download")}</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
