import { useEffect, useState } from 'react';
import { api, type DocumentTemplate, type MailMergeBody, type MailMergePreview } from '../api';
import { ClientSelect } from '../DocumentCreate';
import { useUsers } from '../directory';
import { t as tr, tf, live } from '../i18n';
import { ViewFrame } from '../Layout';
import { ErrorText, Field, Stepper, useAction } from '../ui';

const SUITE = live(() => ({ label: tr("Nexus"), href: '#/nexus' }));

function csvCell(v: string): string {
  return /[";\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** Agera ManyMail: cohort → template → preview → send (SMTP) or export / open one by one. */
export function MailMergeView() {
  const users = useUsers();
  const [mode, setMode] = useState<'single_client' | 'client_cohort'>('client_cohort');
  const [clientId, setClientId] = useState('');
  const [sector, setSector] = useState('');
  const [manager, setManager] = useState('');
  const [minArr, setMinArr] = useState('');
  const [maxHealth, setMaxHealth] = useState('');
  const [sectors, setSectors] = useState<string[]>([]);
  const [templates, setTemplates] = useState<DocumentTemplate[]>([]);
  const [templateId, setTemplateId] = useState('');
  const [recipients, setRecipients] = useState<'primary' | 'all'>('primary');
  const [preview, setPreview] = useState<MailMergePreview | null>(null);
  const [index, setIndex] = useState(0);
  const [done, setDone] = useState<string | null>(null);
  const { busy, error, run } = useAction();

  useEffect(() => {
    api.documentTemplates().then((r) => setTemplates(r.items.filter((x) => x.kind === 'mail' && x.active !== false)), () => setTemplates([]));
    api.surveyAudience({ targetType: 'client_cohort', all: true }).then((r) => setSectors(r.sectors), () => undefined);
  }, []);

  const filtered = !!(sector || manager || minArr || maxHealth);
  const body = (): MailMergeBody =>
    mode === 'single_client'
      ? { targetType: 'single_client', clientId, templateId, recipients }
      : { targetType: 'client_cohort', all: !filtered, sector: sector || null, accountManagerId: manager || null, minArr: minArr ? Number(minArr) : null, maxHealthScore: maxHealth ? Number(maxHealth) : null, templateId, recipients };
  const ready = !!templateId && (mode === 'client_cohort' || !!clientId);
  const load = () => {
    setDone(null);
    void run(() => api.mailMergePreview(body())).then((r) => { if (r) { setPreview(r); setIndex(0); } });
  };
  const sendAll = () => {
    void run(() => api.mailMergeSend(body())).then((r) => r && setDone(tf("{sent} e-mails sent, {failed} failed", { sent: String(r.sent), failed: String(r.failed.length) })));
  };
  const exportCsv = () => {
    if (!preview) return;
    const lines = [['client', 'contact', 'email', 'subject', 'body'].join(';'), ...preview.mails.map((m) => [m.clientName, m.contactName, m.email, m.subject, m.text].map(csvCell).join(';'))];
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([`\uFEFF${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' }));
    a.download = `manymail-${preview.template.name.replace(/[^\w-]+/g, '_')}.csv`;
    a.click();
  };
  const current = preview?.mails[index];
  const step = preview ? 2 : templateId ? 1 : 0;

  return (
    <ViewFrame title={tr("ManyMail")} crumbs={[SUITE, { label: tr("ManyMail") }]}>
      <Stepper steps={[tr("Choose clients"), tr("Choose template"), tr("Preview and send")]} current={step} />
      <div className="doc-form">
        <Field label={tr("Send to")}>
          <select value={mode} onChange={(e) => { setMode(e.target.value as typeof mode); setPreview(null); }}>
            <option value="client_cohort">{tr("A group of clients (cohort)")}</option>
            <option value="single_client">{tr("One client")}</option>
          </select>
        </Field>
        {mode === 'single_client' ? (
          <ClientSelect value={clientId} onChange={(v) => { setClientId(v); setPreview(null); }} />
        ) : (
          <>
            <Field label={tr("Sector")}>
              <select value={sector} onChange={(e) => setSector(e.target.value)}>
                <option value="">{tr("All sectors")}</option>
                {sectors.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label={tr("Account manager")}>
              <select value={manager} onChange={(e) => setManager(e.target.value)}>
                <option value="">{tr("All account managers")}</option>
                {users.map((u) => <option key={u.id} value={u.id}>{u.name ?? u.email}</option>)}
              </select>
            </Field>
            <Field label={tr("Minimum annual contract value (EUR)")}><input type="number" min="0" value={minArr} onChange={(e) => setMinArr(e.target.value)} /></Field>
            <Field label={tr("Maximum health score")} hint={tr("For example 60 to reach clients that need attention.")}><input type="number" min="0" max="100" value={maxHealth} onChange={(e) => setMaxHealth(e.target.value)} /></Field>
          </>
        )}
        <Field label={tr("E-mail template")} hint={templates.length === 0 ? tr("No e-mail templates yet. Create one under Nexus › Document templates (type: e-mail).") : undefined}>
          <select value={templateId} onChange={(e) => { setTemplateId(e.target.value); setPreview(null); }}>
            <option value="">{tr("Choose a template…")}</option>
            {templates.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        </Field>
        <Field label={tr("Recipients per client")}>
          <select value={recipients} onChange={(e) => { setRecipients(e.target.value as typeof recipients); setPreview(null); }}>
            <option value="primary">{tr("Primary contact only")}</option>
            <option value="all">{tr("All contacts with an e-mail address")}</option>
          </select>
        </Field>
        <div className="form-actions">
          <button type="button" className="primary" disabled={busy || !ready} onClick={load}>{tr("Show preview")}</button>
        </div>
      </div>
      <ErrorText error={error} />
      {done && <p className="callout good">{done}</p>}
      {preview && (
        <section className="panel">
          <h3>{tf("{n} personalised e-mails", { n: String(preview.mails.length) })}</h3>
          {preview.clientsWithoutEmail.length > 0 && (
            <p className="muted small">{tr("Clients without a contact e-mail address (skipped)")}: {preview.clientsWithoutEmail.map((c) => c.name).join(', ')}</p>
          )}
          {preview.mail.connected
            ? <p className="callout good">{tr("Sent from Agera through your organisation's e-mail server")} ({preview.mail.from}).</p>
            : <p className="not-connected-note">{tr("Not connected")}: {tr("sending from Agera needs the SMTP settings on the server. Export the batch as CSV or open each e-mail in your own e-mail program.")}</p>}
          {current && (
            <div className="mail-preview">
              <div className="list-toolbar">
                <button type="button" className="secondary" disabled={index === 0} onClick={() => setIndex(index - 1)}>{tr("Previous")}</button>
                <span>{tf("{i} of {n}", { i: String(index + 1), n: String(preview.mails.length) })}</span>
                <button type="button" className="secondary" disabled={index >= preview.mails.length - 1} onClick={() => setIndex(index + 1)}>{tr("Next")}</button>
              </div>
              <p><strong>{tr("To")}:</strong> {current.contactName} &lt;{current.email}&gt; · {current.clientName}</p>
              <p><strong>{tr("Subject")}:</strong> {current.subject}</p>
              <pre className="mail-body">{current.text}</pre>
              {current.missing.length > 0 && <p className="callout warn small">{tr("Missing data for")}: {current.missing.join(', ')}</p>}
              <a className="small" href={`mailto:${encodeURIComponent(current.email)}?subject=${encodeURIComponent(current.subject)}&body=${encodeURIComponent(current.text)}`}>{tr("Open this e-mail in your e-mail program")}</a>
            </div>
          )}
          <div className="form-actions">
            <button type="button" className="secondary" disabled={preview.mails.length === 0} onClick={exportCsv}>{tr("Export batch (CSV)")}</button>
            <button type="button" className="primary" disabled={busy || !preview.mail.configured || preview.mails.length === 0} onClick={sendAll}>{tf("Send {n} e-mails", { n: String(preview.mails.length) })}</button>
          </div>
        </section>
      )}
    </ViewFrame>
  );
}
