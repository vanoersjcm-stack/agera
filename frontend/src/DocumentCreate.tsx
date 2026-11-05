import { type FormEvent, type ReactNode, useEffect, useState } from 'react';
import { api, type ClientRecord, type DocumentTemplate, type Product } from './api';
import { getClientFilter } from './clientFilter';
import { activeClients, useClients } from './directory';
import type { NewDefaults } from './shell';
import { ErrorText, Field, useAction } from './ui';
import { t as tr, tf } from './i18n';

interface FormProps {
  defaults: NewDefaults;
  onDone: (route?: string, message?: string) => void;
  onCancel: () => void;
}

type Grid = string[][];

const ICON_PATHS: Record<'text' | 'sheet' | 'mail', ReactNode> = {
  text: <><path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z" /><path d="M14 3v5h5M9 13h6M9 17h6M9 9h2" /></>,
  sheet: <><path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z" /><path d="M14 3v5h5M8 12h8M8 16h8M12 12v6" /></>,
  mail: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></>,
};

export function DocIcon({ kind }: { kind: 'text' | 'sheet' | 'mail' }) {
  return (
    <svg className={`doc-icon doc-icon-${kind}`} viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICON_PATHS[kind]}
    </svg>
  );
}

function initialClient(defaults: NewDefaults): string {
  return defaults.clientId ?? getClientFilter()?.id ?? '';
}

function useClientRecord(clientId: string): ClientRecord | null {
  const [record, setRecord] = useState<ClientRecord | null>(null);
  useEffect(() => {
    setRecord(null);
    if (clientId) api.client(clientId).then(setRecord, () => setRecord(null));
  }, [clientId]);
  return record;
}

function ClientSelect({ value, onChange, optional }: { value: string; onChange: (id: string) => void; optional?: boolean }) {
  const clients = activeClients(useClients());
  return (
    <Field label={tr("Client")} hint={optional ? tr("Optional; fills the client's details into the template") : undefined}>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{optional ? tr("No client") : tr("Choose a client…")}</option>
        {clients.map((c) => <option key={c.clientId} value={c.clientId}>{c.name}</option>)}
      </select>
    </Field>
  );
}

function RoomSelect({ record, value, onChange }: { record: ClientRecord | null; value: string; onChange: (id: string) => void }) {
  const rooms = record?.rooms ?? [];
  return (
    <Field label={tr("Save into client room")} hint={record && rooms.length === 0 ? tr("This client has no client room yet; you can still download the file.") : tr("Stored with version history in the room's Documents tab")}>
      <select value={value} onChange={(e) => onChange(e.target.value)} disabled={rooms.length === 0}>
        <option value="">{tr("Don't save, download only")}</option>
        {rooms.map((r) => <option key={r.id} value={r.id}>{r.roomName}</option>)}
      </select>
    </Field>
  );
}

function download(name: string, type: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
}

function asHtml(title: string, text: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>body{font-family:Calibri,system-ui,sans-serif;max-width:46rem;margin:2rem auto;line-height:1.5;white-space:pre-wrap}</style></head><body>${escapeHtml(text)}</body></html>`;
}

function safeName(title: string): string {
  return title.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'document';
}

/** Word / text document: blank or from a document template, filled with the client's data. */
export function NewTextDocumentForm({ defaults, onDone, onCancel }: FormProps) {
  const [clientId, setClientId] = useState(initialClient(defaults));
  const record = useClientRecord(clientId);
  const [templates, setTemplates] = useState<DocumentTemplate[]>([]);
  const [templateId, setTemplateId] = useState('');
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [missing, setMissing] = useState<string[]>([]);
  const [roomId, setRoomId] = useState('');
  const { busy, error, run } = useAction();

  useEffect(() => {
    api.documentTemplates().then((r) => setTemplates(r.items.filter((x) => x.kind !== 'mail')), () => setTemplates([]));
  }, []);
  useEffect(() => setRoomId(''), [clientId]);
  useEffect(() => {
    if (!templateId) return;
    void run(() => api.renderTemplate(templateId, { clientId: clientId || undefined })).then((r) => {
      if (!r) return;
      setText(r.text);
      setMissing(r.missing);
      setTitle((cur) => cur || (record ? `${r.name} - ${record.client.name}` : r.name));
    });
  }, [templateId, clientId]);

  const docTitle = title.trim() || tr("Untitled document");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!roomId) {
      download(`${safeName(docTitle)}.doc`, 'application/msword', asHtml(docTitle, text));
      onDone(undefined, tf("Downloaded {title}", { title: docTitle }));
      return;
    }
    const file = new File([asHtml(docTitle, text)], `${safeName(docTitle)}.html`, { type: 'text/html' });
    void run(() => api.uploadRoomDocument(roomId, file, { title: docTitle })).then((r) => r && onDone(`/nexus/client-rooms/${roomId}`, tf("{title} saved in the client room", { title: docTitle })));
  };

  return (
    <form className="doc-form" onSubmit={submit}>
      <ClientSelect value={clientId} onChange={setClientId} optional />
      <Field label={tr("Start from")} hint={templates.length === 0 ? tr("No document templates yet; add them under Nexus › Document templates.") : undefined}>
        <select value={templateId} onChange={(e) => { setTemplateId(e.target.value); if (!e.target.value) { setText(''); setMissing([]); } }}>
          <option value="">{tr("Blank document")}</option>
          {templates.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
      </Field>
      <Field label={tr("Title")}><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={tr("Untitled document")} /></Field>
      <Field label={tr("Text")}><textarea className="doc-editor" rows={14} value={text} onChange={(e) => setText(e.target.value)} /></Field>
      {missing.length > 0 && <p className="hint">{tf("Not filled in (no data for this client): {fields}", { fields: missing.join(', ') })}</p>}
      {clientId && <RoomSelect record={record} value={roomId} onChange={setRoomId} />}
      <ErrorText error={error} />
      <div className="form-actions">
        <button type="button" className="secondary" onClick={onCancel}>{tr("Cancel")}</button>
        <button type="submit" className="primary" disabled={busy}>{roomId ? tr("Save in client room") : tr("Download (.doc)")}</button>
      </div>
    </form>
  );
}

type SheetTemplate = 'blank' | 'tiers' | 'schedule';

function blankGrid(): Grid {
  return [[tr("Column A"), tr("Column B"), tr("Column C"), tr("Column D")], ...Array.from({ length: 5 }, () => ['', '', '', ''])];
}

function tiersGrid(products: Product[]): Grid {
  const money = (n: number) => n.toFixed(2);
  return [
    [tr("SKU"), tr("Product"), tr("Base price (EUR)"), tr("From 10 units (-5%)"), tr("From 50 units (-10%)")],
    ...products.filter((p) => p.active).map((p) => {
      const base = Number(p.unitPrice);
      return [p.sku, p.name, money(base), money(base * 0.95), money(base * 0.9)];
    }),
  ];
}

function scheduleGrid(record: ClientRecord | null): Grid {
  const annual = (record?.agreements ?? []).filter((a) => a.status === 'active').reduce((sum, a) => sum + Number(a.annualValue || 0), 0);
  const start = new Date();
  return [
    [tr("Instalment"), tr("Due date"), tr("Amount (EUR)"), tr("Status")],
    ...Array.from({ length: 12 }, (_, i) => {
      const due = new Date(start.getFullYear(), start.getMonth() + i + 1, 1);
      return [String(i + 1), due.toISOString().slice(0, 10), (annual / 12).toFixed(2), tr("Open")];
    }),
  ];
}

function csvOf(grid: Grid): string {
  return grid.map((row) => row.map((c) => (/[",;\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',')).join('\r\n');
}

/** Spreadsheet: an editable grid, blank or prefilled from the product catalogue or the client's active agreements. */
export function NewSpreadsheetForm({ defaults, onDone, onCancel }: FormProps) {
  const [clientId, setClientId] = useState(initialClient(defaults));
  const record = useClientRecord(clientId);
  const [template, setTemplate] = useState<SheetTemplate>('blank');
  const [grid, setGrid] = useState<Grid>(blankGrid);
  const [title, setTitle] = useState('');
  const [roomId, setRoomId] = useState('');
  const { busy, error, run } = useAction();

  useEffect(() => setRoomId(''), [clientId]);
  const apply = (next: SheetTemplate) => {
    setTemplate(next);
    if (next === 'blank') setGrid(blankGrid());
    if (next === 'schedule') setGrid(scheduleGrid(record));
    if (next === 'tiers') void run(() => api.products()).then((p) => p && setGrid(tiersGrid(p)));
  };
  useEffect(() => {
    if (template === 'schedule') setGrid(scheduleGrid(record));
  }, [record]);

  const setCell = (r: number, c: number, v: string) => setGrid((g) => g.map((row, ri) => (ri === r ? row.map((x, ci) => (ci === c ? v : x)) : row)));
  const addRow = () => setGrid((g) => [...g, g[0].map(() => '')]);
  const addColumn = () => setGrid((g) => g.map((row, i) => [...row, i === 0 ? tf("Column {n}", { n: row.length + 1 }) : '']));
  const removeRow = (r: number) => setGrid((g) => g.filter((_, i) => i !== r));

  const sheetTitle = title.trim() || (template === 'tiers' ? tr("Volume price tiers") : template === 'schedule' ? tr("Payment schedule") : tr("Untitled spreadsheet"));
  const fullTitle = record ? `${sheetTitle} - ${record.client.name}` : sheetTitle;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const csv = csvOf(grid);
    if (!roomId) {
      download(`${safeName(fullTitle)}.csv`, 'text/csv;charset=utf-8', `\uFEFF${csv}`);
      onDone(undefined, tf("Downloaded {title}", { title: fullTitle }));
      return;
    }
    const file = new File([`\uFEFF${csv}`], `${safeName(fullTitle)}.csv`, { type: 'text/csv' });
    void run(() => api.uploadRoomDocument(roomId, file, { title: fullTitle })).then((r) => r && onDone(`/nexus/client-rooms/${roomId}`, tf("{title} saved in the client room", { title: fullTitle })));
  };

  return (
    <form className="doc-form" onSubmit={submit}>
      <ClientSelect value={clientId} onChange={setClientId} optional />
      <Field label={tr("Start from")} hint={template === 'schedule' && !record ? tr("Choose a client to spread its active agreements' annual value over 12 months.") : undefined}>
        <select value={template} onChange={(e) => apply(e.target.value as SheetTemplate)}>
          <option value="blank">{tr("Blank spreadsheet")}</option>
          <option value="tiers">{tr("Volume price tiers (from the product catalogue)")}</option>
          <option value="schedule">{tr("Payment schedule (from active agreements)")}</option>
        </select>
      </Field>
      <Field label={tr("Title")}><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={sheetTitle} /></Field>
      <div className="sheet-wrap">
        <table className="sheet">
          <tbody>
            {grid.map((row, r) => (
              <tr key={r} className={r === 0 ? 'sheet-head' : undefined}>
                <th scope="row">{r === 0 ? '' : r}</th>
                {row.map((cell, c) => (
                  <td key={c}><input aria-label={tf("Row {r}, column {c}", { r, c: c + 1 })} value={cell} onChange={(e) => setCell(r, c, e.target.value)} /></td>
                ))}
                <td>{r > 0 && <button type="button" className="link-button" aria-label={tr("Remove row")} onClick={() => removeRow(r)}>×</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="row-actions">
        <button type="button" className="secondary" onClick={addRow}>{tr("+ Row")}</button>
        <button type="button" className="secondary" onClick={addColumn}>{tr("+ Column")}</button>
      </div>
      {clientId && <RoomSelect record={record} value={roomId} onChange={setRoomId} />}
      <ErrorText error={error} />
      <div className="form-actions">
        <button type="button" className="secondary" onClick={onCancel}>{tr("Cancel")}</button>
        <button type="submit" className="primary" disabled={busy}>{roomId ? tr("Save in client room") : tr("Download (.csv)")}</button>
      </div>
    </form>
  );
}

const BUILT_IN_MAILS = {
  qbr: {
    label: "Quarterly business review invitation",
    subject: "Quarterly business review with {client}",
    body: "Dear {contact},\n\nI would like to invite you to our quarterly business review. We will look back on the last quarter together, discuss sales and shelf availability, and agree on the plans for the coming period.\n\nWould one of the following moments suit you?\n- \n- \n\nKind regards,",
  },
  followup: {
    label: "Agreement follow-up",
    subject: "Follow-up on our agreement with {client}",
    body: "Dear {contact},\n\nThank you for our recent conversation. As discussed, I am following up on the agreement between {client} and us. You can review and sign the documents in your client room in the Agera portal.\n\nPlease let me know if you have any questions.\n\nKind regards,",
  },
  price: {
    label: "Price adjustment notice",
    subject: "Price adjustment for {client}",
    body: "Dear {contact},\n\nWe would like to inform you of an adjustment to our prices. The updated price list for {client} will apply from [date]. Your current payment terms ({terms}) remain unchanged.\n\nYou can find the new prices in your client room. I am happy to explain the changes in person.\n\nKind regards,",
  },
} as const;
type BuiltIn = keyof typeof BUILT_IN_MAILS;

/** E-mail composer. Sending from Agera is not connected, so it hands the message to the user's own e-mail program. */
export function NewMailForm({ defaults, onDone, onCancel }: FormProps) {
  const [clientId, setClientId] = useState(initialClient(defaults));
  const record = useClientRecord(clientId);
  const [contactId, setContactId] = useState('');
  const [to, setTo] = useState('');
  const [templates, setTemplates] = useState<DocumentTemplate[]>([]);
  const [template, setTemplate] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [copied, setCopied] = useState(false);
  const { busy, error, run } = useAction();

  const contacts = (record?.contacts ?? []).filter((c) => c.email);
  const contact = contacts.find((c) => c.id === contactId);
  useEffect(() => {
    api.documentTemplates().then((r) => setTemplates(r.items.filter((x) => x.kind === 'mail')), () => setTemplates([]));
  }, []);
  useEffect(() => {
    const first = (record?.contacts ?? []).filter((c) => c.email).sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary))[0];
    setContactId(first?.id ?? '');
    setTo(first?.email ?? '');
  }, [record]);

  const fill = (key: string) => {
    setTemplate(key);
    if (!key) return;
    if (key in BUILT_IN_MAILS) {
      const m = BUILT_IN_MAILS[key as BuiltIn];
      const vars = { client: record?.client.name ?? tr("[client]"), contact: contact?.firstName ?? tr("[name]"), terms: record?.client.paymentTerms ?? '' };
      setSubject(tf(m.subject, vars));
      setBody(tf(m.body, vars));
      return;
    }
    void run(() => api.renderTemplate(key, { clientId: clientId || undefined })).then((r) => {
      if (!r) return;
      setSubject(r.name);
      setBody(r.text);
    });
  };
  useEffect(() => {
    if (template) fill(template);
  }, [record, contactId]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    window.location.href = `mailto:${encodeURIComponent(to.trim())}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    onDone(undefined, tr("Opened in your e-mail program"));
  };
  const copy = () => {
    void navigator.clipboard?.writeText(`${tr("Subject")}: ${subject}\n\n${body}`).then(() => setCopied(true));
  };

  return (
    <form className="doc-form" onSubmit={submit}>
      <p className="not-connected-note">{tr("Sending from Agera isn't connected yet (no e-mail integration). This opens your own e-mail program with the message filled in.")}</p>
      <ClientSelect value={clientId} onChange={setClientId} optional />
      {clientId && (
        <Field label={tr("Contact")} hint={record && contacts.length === 0 ? tr("This client has no contacts with an e-mail address.") : undefined}>
          <select value={contactId} onChange={(e) => { setContactId(e.target.value); setTo(contacts.find((c) => c.id === e.target.value)?.email ?? ''); }}>
            <option value="">{tr("Choose a contact…")}</option>
            {contacts.map((c) => <option key={c.id} value={c.id}>{[c.firstName, c.lastName].filter(Boolean).join(' ')} ({c.email})</option>)}
          </select>
        </Field>
      )}
      <Field label={tr("To")}><input type="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder="name@example.com" /></Field>
      <Field label={tr("Template")}>
        <select value={template} onChange={(e) => fill(e.target.value)}>
          <option value="">{tr("No template")}</option>
          <optgroup label={tr("Standard")}>
            {(Object.keys(BUILT_IN_MAILS) as BuiltIn[]).map((k) => <option key={k} value={k}>{tr(BUILT_IN_MAILS[k].label)}</option>)}
          </optgroup>
          {templates.length > 0 && (
            <optgroup label={tr("Your e-mail templates")}>
              {templates.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </optgroup>
          )}
        </select>
      </Field>
      <Field label={tr("Subject")}><input value={subject} onChange={(e) => setSubject(e.target.value)} required /></Field>
      <Field label={tr("Message")}><textarea className="doc-editor" rows={12} value={body} onChange={(e) => setBody(e.target.value)} /></Field>
      <ErrorText error={error} />
      <div className="form-actions">
        <button type="button" className="secondary" onClick={onCancel}>{tr("Cancel")}</button>
        <button type="button" className="secondary" onClick={copy}>{copied ? tr("Copied") : tr("Copy text")}</button>
        <button type="submit" className="primary" disabled={busy || !subject.trim()}>{tr("Open in e-mail program")}</button>
      </div>
    </form>
  );
}
