import { ApprovalPanel } from '../symphony/Workflow';
import { type FormEvent, useState } from 'react';
import { api, type Category, type LineCategory, type LineItem, type PlanStatus } from '../api';
import { formatAmount, varianceTone } from '../format';
import { CATEGORY, formatDate, LINE_CATEGORY, PLAN_STATUS } from '../labels';
import { IdmsBadge, IdmsControl } from '../Idms';
import { EmptyState, ViewFrame } from '../Layout';
import { navigate, type Route, withParams } from '../router';
import { useShell } from '../shell';
import { DetailList, ErrorText, Field, FilterChips, includesText, Loading, SearchInput, StatusBadge, useAction, useLoad } from '../ui';
import { t as tr, locale, live } from '../i18n';

const SUITE_CRUMB = live(() => ({ label: tr("Nexus"), href: '#/nexus' }));
const LIST_CRUMB = live(() => ({ label: tr("Financial plans"), href: '#/nexus/financial-plans' }));

function planClient(metadata: Record<string, unknown>): string {
  return typeof metadata.companyName === 'string' ? metadata.companyName : '—';
}

export function FinancialPlansView({ route }: { route: Route }) {
  const { openNew } = useShell();
  const status = route.params.get('status') ?? 'all';
  const q = route.params.get('q') ?? '';
  const { data, error } = useLoad(() => api.models());
  const items = data ?? [];
  const count = (s: PlanStatus) => items.filter((m) => m.status === s).length;
  const filtered = items.filter((m) => (status === 'all' || m.status === status) && includesText([m.modelName, planClient(m.metadata)], q));
  return (
    <ViewFrame title={tr("Financial plans")} crumbs={[SUITE_CRUMB, { label: tr("Financial plans") }]} actions={<button className="primary" onClick={() => openNew('financial_plan')}>{tr("+ New financial plan")}</button>}>
      <div className="list-toolbar">
        <FilterChips
          value={status}
          onChange={(v) => navigate(withParams(route, { status: v === 'all' ? null : v }))}
          chips={[
            { value: 'all', label: tr("All"), count: items.length },
            { value: 'draft', label: tr("Draft"), count: count('draft') },
            { value: 'approved', label: tr("Approved"), count: count('approved') },
            { value: 'archived', label: tr("Archived"), count: count('archived') },
          ]}
        />
        <SearchInput value={q} onChange={(v) => navigate(withParams(route, { q: v }))} placeholder={tr("Filter by plan or client")} />
      </div>
      {!data && <Loading error={error} />}
      {data && filtered.length === 0 && (
        <EmptyState title={items.length === 0 ? tr("No financial plans yet") : tr("No plans match this filter")} action={<button className="primary" onClick={() => openNew('financial_plan')}>{tr("+ New financial plan")}</button>}>
          {items.length === 0 ? tr("A financial plan holds the expected revenue and costs per period, for example for one client contract.") : undefined}
        </EmptyState>
      )}
      {filtered.length > 0 && (
        <table className="grid clickable">
          <thead>
            <tr>
              <th>{tr("Plan")}</th>
              <th>{tr("Client")}</th>
              <th>{tr("Fiscal year")}</th>
              <th>{tr("Status")}</th>
              <th>{tr("Lifecycle")}</th>
              <th>{tr("Last change")}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((m) => (
              <tr key={m.id} onClick={() => navigate(`/nexus/financial-plans/${m.id}`)}>
                <td><a href={`#/nexus/financial-plans/${m.id}`}>{m.modelName}</a></td>
                <td>{planClient(m.metadata)}</td>
                <td>{m.fiscalYear}</td>
                <td><StatusBadge status={m.status} label={PLAN_STATUS[m.status]} /></td>
                <td><IdmsBadge status={m.idmsStatus} /></td>
                <td>{formatDate(m.updatedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </ViewFrame>
  );
}

const PERIODS = (year: number) => [
  ...[1, 2, 3, 4].map((q) => ({ value: `${year}-Q${q}`, label: `Q${q} ${year}` })),
  ...Array.from({ length: 12 }, (_, i) => ({
    value: `${year}-${String(i + 1).padStart(2, '0')}`,
    label: new Date(year, i, 1).toLocaleDateString(locale(), { month: 'long', year: 'numeric' }),
  })),
];

function periodLabel(code: string): string {
  const q = /^(\d{4})-Q([1-4])$/.exec(code);
  if (q) return `Q${q[2]} ${q[1]}`;
  const m = /^(\d{4})-(\d{2})$/.exec(code);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, 1).toLocaleDateString(locale(), { month: 'short', year: 'numeric' }) : code;
}

/** Accepts "1.234,56", "1,234.56" or "1234.56" and returns a plain decimal string. */
function normaliseAmount(input: string): string {
  const s = input.replace(/[€\s]/g, '');
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma > lastDot) return s.replace(/\./g, '').replace(',', '.');
  return s.replace(/,/g, '');
}

function LineCategoryCell({ line, editable, onSaved }: { line: LineItem; editable: boolean; onSaved: () => void }) {
  const { busy, run } = useAction();
  if (!editable) return <>{LINE_CATEGORY[line.lineCategory]}</>;
  return (
    <select aria-label={tr("Line category")} value={line.lineCategory} disabled={busy} onChange={(e) => void run(() => api.updateLineItem(line.id, { lineCategory: e.target.value as LineCategory })).then((r) => r && onSaved())}>
      {(Object.keys(LINE_CATEGORY) as LineCategory[]).map((c) => <option key={c} value={c}>{LINE_CATEGORY[c]}</option>)}
    </select>
  );
}

function AddLineForm({ modelId, year, onDone, onCancel }: { modelId: string; year: number; onDone: () => void; onCancel: () => void }) {
  const [category, setCategory] = useState<Category>('revenue');
  const [lineCategory, setLineCategory] = useState<LineCategory>('existing_contract');
  const [description, setDescription] = useState('');
  const [period, setPeriod] = useState(`${year}-Q1`);
  const [projected, setProjected] = useState('');
  const [actual, setActual] = useState('');
  const { busy, error, run } = useAction();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(() =>
      api.createLineItem(modelId, {
        category,
        lineCategory,
        subcategory: description.trim() || undefined,
        periodCode: period,
        projectedAmount: normaliseAmount(projected),
        actualAmount: actual.trim() ? normaliseAmount(actual) : null,
      }),
    ).then((r) => r && onDone());
  };
  return (
    <form className="card-panel inline-form" onSubmit={submit}>
      <h3>{tr("New plan line")}</h3>
      <div className="field-row">
        <Field label={tr("Category")}>
          <select value={category} onChange={(e) => setCategory(e.target.value as Category)}>
            {(Object.keys(CATEGORY) as Category[]).map((c) => (
              <option key={c} value={c}>{CATEGORY[c]}</option>
            ))}
          </select>
        </Field>
        <Field label={tr("Period")}>
          <select value={period} onChange={(e) => setPeriod(e.target.value)}>
            {PERIODS(year).map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
        </Field>
      </div>
      <Field label={tr("Line category")} hint={tr("Recurring baseline from existing contracts, or expansion pipeline")}>
        <select value={lineCategory} onChange={(e) => setLineCategory(e.target.value as LineCategory)}>
          {(Object.keys(LINE_CATEGORY) as LineCategory[]).map((c) => <option key={c} value={c}>{LINE_CATEGORY[c]}</option>)}
        </select>
      </Field>
      <Field label={tr("Description")} hint={tr("Optional, e.g. the project or cost type")}>
        <input maxLength={100} value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <div className="field-row">
        <Field label={tr("Planned amount (EUR)")}>
          <input required inputMode="decimal" value={projected} onChange={(e) => setProjected(e.target.value)} placeholder="0,00" />
        </Field>
        <Field label={tr("Actual amount (EUR)")} hint={tr("Optional; fill in when known")}>
          <input inputMode="decimal" value={actual} onChange={(e) => setActual(e.target.value)} placeholder="—" />
        </Field>
      </div>
      <ErrorText error={error} />
      <div className="form-actions start">
        <button type="button" className="secondary" onClick={onCancel}>{tr("Cancel")}</button>
        <button type="submit" className="primary" disabled={busy}>{busy ? tr("Saving…") : tr("Add line")}</button>
      </div>
    </form>
  );
}

function ActualCell({ line, editable, onSaved }: { line: LineItem; editable: boolean; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(line.actualAmount ?? '');
  const { busy, error, run } = useAction();
  if (!editing) {
    return (
      <span>
        {formatAmount(line.actualAmount, line.currency)}{' '}
        {editable && <button className="link-button" onClick={() => setEditing(true)}>{line.actualAmount === null ? tr("Record actual") : tr("Edit")}</button>}
      </span>
    );
  }
  return (
    <form
      className="inline-edit"
      onSubmit={(e) => {
        e.preventDefault();
        void run(() => api.updateLineItem(line.id, { actualAmount: value.trim() ? normaliseAmount(value) : null })).then((r) => r && (setEditing(false), onSaved()));
      }}
    >
      <input autoFocus inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} aria-label={tr("Actual amount")} />
      <button className="primary small" disabled={busy}>{tr("Save")}</button>
      <button type="button" className="link-button" onClick={() => setEditing(false)}>{tr("Cancel")}</button>
      {error && <span className="error">{error}</span>}
    </form>
  );
}

export function PlanDossier({ id }: { id: string }) {
  const { notify } = useShell();
  const plan = useLoad(() => api.model(id), [id]);
  const lines = useLoad(() => api.lineItems(id), [id]);
  const [adding, setAdding] = useState(false);
  const action = useAction();
  const m = plan.data;
  if (!m) {
    return (
      <ViewFrame title={tr("Financial plan")} crumbs={[SUITE_CRUMB, LIST_CRUMB, { label: tr("Loading…") }]}>
        <Loading error={plan.error} />
      </ViewFrame>
    );
  }
  const editable = m.status !== 'archived';
  const setStatus = (status: PlanStatus, message: string, confirm?: string) => {
    if (confirm && !window.confirm(confirm)) return;
    void action.run(() => api.setModelStatus(id, status)).then((r) => r && (notify(message), plan.reload()));
  };
  const totals = (lines.data ?? []).reduce<Record<string, { projected: number; actual: number; currency: string }>>((acc, l) => {
    const t = (acc[l.category] ??= { projected: 0, actual: 0, currency: l.currency });
    t.projected += Number(l.projectedAmount);
    t.actual += Number(l.actualAmount ?? 0);
    return acc;
  }, {});
  return (
    <ViewFrame
      title={m.modelName}
      subtitle={<><StatusBadge status={m.status} label={PLAN_STATUS[m.status]} /> <IdmsControl kind="financial_models" id={id} status={m.idmsStatus} onChanged={plan.reload} /></>}
      crumbs={[SUITE_CRUMB, LIST_CRUMB, { label: m.modelName }]}
      actions={
        <>
          {m.status === 'approved' && <a className="button-link" href={`#/symphony/profit-loss?modelId=${id}`}>View in Profit &amp; loss</a>}
          {m.status !== 'archived' && (
            <button className="secondary" disabled={action.busy} onClick={() => setStatus('archived', 'Plan archived', 'Archive this plan? It no longer counts in Profit & loss and Alerts.')}>
              {tr("Archive")}</button>
          )}
          {m.status === 'draft' && (
            <button className="primary" disabled={action.busy} onClick={() => setStatus('approved', 'Plan approved')}>{tr("Approve plan ✓")}</button>
          )}
          {m.status === 'archived' && (
            <button className="secondary" disabled={action.busy} onClick={() => setStatus('draft', 'Plan restored as draft')}>{tr("Restore as draft")}</button>
          )}
        </>
      }
    >
      <ol className="stepper compact">
        <li className={m.status === 'draft' ? 'current' : 'done'}><span className="step-index">1</span>{tr("Draft")}</li>
        <li className={m.status === 'approved' ? 'current' : m.status === 'archived' ? 'done' : undefined}><span className="step-index">2</span>{tr("Approved")}</li>
        <li className={m.status === 'archived' ? 'current' : undefined}><span className="step-index">3</span>{tr("Archived")}</li>
      </ol>
      <ErrorText error={action.error} />
      <ApprovalPanel entityType="financial_plan" entityId={id} canRequest={m.status === 'draft'} onChanged={plan.reload} />
      <DetailList items={[['Client', planClient(m.metadata)], ['Fiscal year', String(m.fiscalYear)], ['Created', formatDate(m.createdAt)]]} />
      <p className="muted">Only approved plans count in Profit &amp; loss and Alerts.</p>
      <div className="section-head">
        <h2 className="section-title">{tr("Plan lines (")}{lines.data?.length ?? '…'})</h2>
        {editable && !adding && <button className="primary" onClick={() => setAdding(true)}>{tr("+ Line")}</button>}
      </div>
      {adding && <AddLineForm modelId={id} year={m.fiscalYear} onCancel={() => setAdding(false)} onDone={() => (setAdding(false), notify(tr("Plan line added")), lines.reload())} />}
      {!lines.data && <Loading error={lines.error} />}
      {lines.data?.length === 0 && !adding && <p className="muted">{tr("No plan lines yet. Add the expected revenue and costs per period.")}</p>}
      {lines.data && lines.data.length > 0 && (
        <table className="grid">
          <thead>
            <tr>
              <th>{tr("Period")}</th>
              <th>{tr("Category")}</th>
              <th>{tr("Line category")}</th>
              <th>{tr("Description")}</th>
              <th className="num">{tr("Planned")}</th>
              <th className="num">{tr("Actual")}</th>
              <th className="num">{tr("Difference")}</th>
            </tr>
          </thead>
          <tbody>
            {lines.data.map((l) => (
              <tr key={l.id}>
                <td>{periodLabel(l.periodCode)}</td>
                <td>{CATEGORY[l.category]}</td>
                <td><LineCategoryCell line={l} editable={editable} onSaved={lines.reload} /></td>
                <td>{l.subcategory ?? '—'}</td>
                <td className="num">{formatAmount(l.projectedAmount, l.currency)}</td>
                <td className="num"><ActualCell line={l} editable={editable} onSaved={lines.reload} /></td>
                <td className={`num ${varianceTone(l.category, l.variance)}`}>{formatAmount(l.variance, l.currency)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            {Object.entries(totals).map(([cat, t]) => (
              <tr key={cat}>
                <td>{tr("Total")}</td>
                <td>{CATEGORY[cat as Category]}</td>
                <td />
                <td />
                <td className="num">{formatAmount(String(t.projected), t.currency)}</td>
                <td className="num">{formatAmount(String(t.actual), t.currency)}</td>
                <td />
              </tr>
            ))}
          </tfoot>
        </table>
      )}
    </ViewFrame>
  );
}

export { periodLabel };
