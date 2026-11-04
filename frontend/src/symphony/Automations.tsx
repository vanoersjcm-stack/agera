import { type FormEvent, useState } from 'react';
import { api, type Automation, type AutomationCatalog, type AutomationStep, type UserSummary } from '../api';
import { formatDateTime } from '../labels';
import { EmptyState, ViewFrame } from '../Layout';
import { navigate } from '../router';
import { useShell } from '../shell';
import { currentTier } from '../suites';
import { Drawer, ErrorText, Field, FormActions, Loading, StatusBadge, useAction, useLoad } from '../ui';
import { t as tr } from '../i18n';

const SUITE = { label: tr("Symphony"), href: '#/symphony' };
const OPS: Record<string, string> = { equals: 'equals', not_equals: 'does not equal', contains: 'contains', exists: 'is filled in' };
const ACTIONS: Record<string, string> = { notify_user: 'Send a notification to', create_exception: 'Open an exception for' };
const blankStep = (): AutomationStep => ({ condition: null, action: 'notify_user', config: { userId: null, title: '', message: null, severity: 'medium' }, delayMinutes: 0 });

export function EnterpriseBadge() {
  return <span className="enterprise-badge" title={tr("Available in Agera Symphony (Enterprise). Ask your administrator to upgrade.")}>{tr("Enterprise tier required")}</span>;
}

function StepEditor({ step, index, users, onChange, onRemove, enterprise }: { step: AutomationStep; index: number; users: UserSummary[]; onChange: (s: AutomationStep) => void; onRemove?: () => void; enterprise: boolean }) {
  const cond = step.condition;
  return (
    <fieldset className="automation-step">
      <legend>{tr("Step")} {index + 1} {onRemove && <button type="button" className="link-button danger" onClick={onRemove}>{tr("Remove")}</button>}</legend>
      <div className="step-row">
        <label className="inline-label"><input type="checkbox" checked={!!cond} onChange={(e) => onChange({ ...step, condition: e.target.checked ? { field: '', op: 'equals', value: '' } : null })} />  {tr("Only if")}</label>
        {cond && (
          <>
            <input aria-label={tr("Field")} placeholder={tr("field, e.g. status")} value={cond.field} onChange={(e) => onChange({ ...step, condition: { ...cond, field: e.target.value } })} />
            <select aria-label={tr("Operator")} value={cond.op} onChange={(e) => onChange({ ...step, condition: { ...cond, op: e.target.value as typeof cond.op } })}>{Object.entries(OPS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
            {cond.op !== 'exists' && <input aria-label={tr("Value")} placeholder="value" value={cond.value ?? ''} onChange={(e) => onChange({ ...step, condition: { ...cond, value: e.target.value } })} />}
          </>
        )}
      </div>
      <div className="step-row">
        <select aria-label={tr("Action")} value={step.action} onChange={(e) => onChange({ ...step, action: e.target.value as AutomationStep['action'] })}>{Object.entries(ACTIONS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        <select aria-label={tr("Person")} required={step.action === 'notify_user'} value={step.config.userId ?? ''} onChange={(e) => onChange({ ...step, config: { ...step.config, userId: e.target.value || null } })}>
          <option value="">{step.action === 'notify_user' ? tr("Choose a person…") : tr("No owner")}</option>
          {users.map((u) => <option key={u.id} value={u.id}>{u.name || u.email}</option>)}
        </select>
        {step.action === 'create_exception' && (
          <select aria-label={tr("Severity")} value={step.config.severity ?? 'medium'} onChange={(e) => onChange({ ...step, config: { ...step.config, severity: e.target.value as 'low' } })}>
            <option value="low">{tr("Low")}</option><option value="medium">{tr("Medium")}</option><option value="high">{tr("High")}</option>
          </select>
        )}
      </div>
      <input aria-label={tr("Title")} required maxLength={200} placeholder={tr("Title, e.g. Field order {{orderId}} needs a check")} value={step.config.title} onChange={(e) => onChange({ ...step, config: { ...step.config, title: e.target.value } })} />
      <textarea aria-label={tr("Message")} rows={2} maxLength={2000} placeholder={tr("Optional message")} value={step.config.message ?? ''} onChange={(e) => onChange({ ...step, config: { ...step.config, message: e.target.value || null } })} />
      <div className="step-row">
        <label className="inline-label">{tr("Wait")} <input type="number" min={0} max={43200} disabled={!enterprise} value={step.delayMinutes} onChange={(e) => onChange({ ...step, delayMinutes: Math.max(0, Number(e.target.value) || 0) })} />  {tr("minutes first")}</label>
        {!enterprise && <EnterpriseBadge />}
      </div>
    </fieldset>
  );
}

function AutomationEditor({ automation, catalog, onDone, onCancel }: { automation?: Automation; catalog: AutomationCatalog; onDone: (a: Automation) => void; onCancel: () => void }) {
  const users = useLoad(() => api.users(), []);
  const enterprise = currentTier() === 'symphony';
  const [name, setName] = useState(automation?.name ?? '');
  const [trigger, setTrigger] = useState(automation?.trigger ?? catalog.triggers[0]?.value ?? '');
  const [steps, setSteps] = useState<AutomationStep[]>(automation?.steps ?? [blankStep()]);
  const { busy, error, run } = useAction();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const body = { name: name.trim(), trigger, steps };
    void run(() => (automation ? api.updateAutomation(automation.id, body) : api.createAutomation(body))).then((r) => r && onDone(r));
  };
  return (
    <form onSubmit={submit}>
      <Field label={tr("Name")}><input required maxLength={200} value={name} onChange={(e) => setName(e.target.value)} placeholder={tr("e.g. Tell the account manager about high exceptions")} autoFocus /></Field>
      <Field label={tr("When")} hint={tr("The event that starts this automation")}>
        <select value={trigger} onChange={(e) => setTrigger(e.target.value)}>{catalog.triggers.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</select>
      </Field>
      <Field label={tr("Then")} hint={tr("Conditions check the event's details (e.g. status, severity, sku). Use {{field}} in the title to insert a detail.")}>
        {steps.map((s, i) => (
          <StepEditor key={i} index={i} step={s} users={users.data ?? []} enterprise={enterprise} onChange={(n) => setSteps(steps.map((x, j) => (j === i ? n : x)))} onRemove={steps.length > 1 ? () => setSteps(steps.filter((_, j) => j !== i)) : undefined} />
        ))}
        <div className="step-row">
          <button type="button" className="secondary small" disabled={!enterprise || steps.length >= 10} onClick={() => setSteps([...steps, blankStep()])}>{tr("+ Add step (branch)")}</button>
          {!enterprise && <EnterpriseBadge />}
        </div>
      </Field>
      <ErrorText error={error} />
      <FormActions busy={busy} submitLabel={automation ? tr("Save automation") : tr("Create automation")} onCancel={onCancel} />
    </form>
  );
}

function summary(a: Automation, catalog?: AutomationCatalog): string {
  const t = catalog?.triggers.find((x) => x.value === a.trigger)?.label ?? a.trigger;
  return `${t} → ${a.steps.map((s) => (s.action === 'notify_user' ? 'notify' : 'open exception')).join(', ')}${a.steps.some((s) => s.delayMinutes) ? ' (delayed)' : ''}`;
}

export function AutomationsView() {
  const { notify } = useShell();
  const list = useLoad(() => api.automations(), []);
  const catalog = useLoad(() => api.automationCatalog(), []);
  const [creating, setCreating] = useState(false);
  const action = useAction();
  const l = list.data;
  const full = !!l && l.maxActive !== null && l.activeCount >= l.maxActive;
  return (
    <ViewFrame title={tr("Automations")} subtitle={tr("When something happens, check a condition and act: notify someone or open an exception")} crumbs={[SUITE, { label: tr("Automations") }]}
      actions={<button className="primary" disabled={!catalog.data} onClick={() => setCreating(true)}>{tr("+ New automation")}</button>}>
      {l && (
        <p className={`edition-limit${full ? ' full' : ''}`}>
          {l.maxActive === null
            ? <>{tr("Agera Symphony: unlimited automations with multiple steps, branches and delays.")} <strong>{l.activeCount}</strong>  {tr("active.")}</>
            : <><strong>{l.activeCount}  {tr("of")} {l.maxActive}</strong>  {tr("active automations (Agera Vanguard: one trigger, one condition, one action).")} {full && tr("Pause one to activate another.")} <EnterpriseBadge />  {tr("for more, branching and delays.")}</>}
        </p>
      )}
      <ErrorText error={action.error} />
      {!l && <Loading error={list.error} />}
      {l?.items.length === 0 && <EmptyState title={tr("No automations yet")}>{tr("Create one with “+ New automation”.")}</EmptyState>}
      {l && l.items.length > 0 && (
        <table className="grid clickable">
          <thead><tr><th>{tr("Automation")}</th><th>{tr("Rule")}</th><th className="num">{tr("Runs")}</th><th>{tr("Last run")}</th><th>{tr("Status")}</th><th /></tr></thead>
          <tbody>
            {l.items.map((a) => (
              <tr key={a.id} onClick={() => navigate(`/symphony/automations/${a.id}`)}>
                <td><a href={`#/symphony/automations/${a.id}`}>{a.name}</a></td>
                <td className="muted">{summary(a, catalog.data ?? undefined)}</td>
                <td className="num">{a.runCount}</td>
                <td>{a.lastRunAt ? formatDateTime(a.lastRunAt) : '—'}</td>
                <td>{a.active ? <StatusBadge status="active" label={tr("Active")} /> : <StatusBadge status="archived" label={tr("Paused")} />}</td>
                <td className="row-actions" onClick={(e) => e.stopPropagation()}>
                  <button className="link-button" disabled={action.busy} onClick={() => void action.run(() => api.updateAutomation(a.id, { active: !a.active })).then((r) => r && (notify(r.active ? tr("Automation activated") : tr("Automation paused")), list.reload()))}>{a.active ? tr("Pause") : tr("Activate")}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {creating && catalog.data && (
        <Drawer title={tr("New automation")} onClose={() => setCreating(false)}>
          <AutomationEditor catalog={catalog.data} onCancel={() => setCreating(false)} onDone={(a) => (setCreating(false), notify(tr("Automation created")), navigate(`/symphony/automations/${a.id}`))} />
        </Drawer>
      )}
    </ViewFrame>
  );
}

export function AutomationDossier({ id }: { id: string }) {
  const { notify } = useShell();
  const a = useLoad(() => api.automation(id), [id]);
  const catalog = useLoad(() => api.automationCatalog(), []);
  const users = useLoad(() => api.users(), []);
  const [editing, setEditing] = useState(false);
  const action = useAction();
  const crumbs = [SUITE, { label: tr("Automations"), href: '#/symphony/automations' }];
  if (!a.data) return <ViewFrame title={tr("Automation")} crumbs={[...crumbs, { label: tr("Loading…") }]}><Loading error={a.error} /></ViewFrame>;
  const x = a.data;
  const who = (uid?: string | null) => users.data?.find((u) => u.id === uid)?.name ?? (uid ? 'someone' : 'no owner');
  return (
    <ViewFrame title={x.name} subtitle={summary(x, catalog.data ?? undefined)} crumbs={[...crumbs, { label: x.name }]}
      actions={<>
        <button className="secondary" disabled={!catalog.data} onClick={() => setEditing(true)}>{tr("Edit")}</button>
        <button className="secondary" disabled={action.busy} onClick={() => void action.run(() => api.updateAutomation(id, { active: !x.active })).then((r) => r && (notify(r.active ? tr("Automation activated") : tr("Automation paused")), a.reload()))}>{x.active ? tr("Pause") : tr("Activate")}</button>
        <button className="secondary danger" disabled={action.busy} onClick={() => window.confirm(`Delete ${x.name} and its history?`) && void action.run(() => api.deleteAutomation(id)).then((r) => r !== undefined && (notify(tr("Automation deleted")), navigate('/symphony/automations')))}>{tr("Delete")}</button>
      </>}>
      <ErrorText error={action.error} />
      <div className="card-panel">
        <h2>{tr("Rule")}</h2>
        <ol className="rule-steps">
          <li><strong>{tr("When")}</strong> {catalog.data?.triggers.find((t) => t.value === x.trigger)?.label ?? x.trigger}</li>
          {x.steps.map((s, i) => (
            <li key={i}>
              {s.delayMinutes > 0 && <>{tr("wait")} {s.delayMinutes}  {tr("min, then")} </>}
              {s.condition ? <>{tr("if")} <code>{s.condition.field}</code> {OPS[s.condition.op]} {s.condition.value && <code>{s.condition.value}</code>}, </> : null}
              <strong>{ACTIONS[s.action].toLowerCase()}</strong> {who(s.config.userId)}: “{s.config.title}”
            </li>
          ))}
        </ol>
      </div>
      <div className="card-panel">
        <h2>{tr("Recent runs")}</h2>
        {x.runs?.length === 0 ? <p className="muted">{tr("Not triggered yet.")}</p> : (
          <table className="grid">
            <thead><tr><th>{tr("When")}</th><th>{tr("Step")}</th><th>{tr("Result")}</th><th>{tr("Detail")}</th></tr></thead>
            <tbody>{x.runs?.map((r) => <tr key={r.id}><td>{formatDateTime(r.status === 'scheduled' ? r.runAt : r.createdAt)}</td><td>{r.stepIndex + 1}</td><td><StatusBadge status={r.status === 'done' ? 'active' : r.status === 'failed' ? 'rejected' : 'draft'} label={r.status} /></td><td className="muted">{r.detail}</td></tr>)}</tbody>
          </table>
        )}
      </div>
      {editing && catalog.data && (
        <Drawer title={tr("Edit automation")} onClose={() => setEditing(false)}>
          <AutomationEditor automation={x} catalog={catalog.data} onCancel={() => setEditing(false)} onDone={() => (setEditing(false), notify(tr("Automation saved")), a.reload())} />
        </Drawer>
      )}
    </ViewFrame>
  );
}
