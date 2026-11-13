import { useEffect, useState } from 'react';
import { api, type ReportDataset, type ReportDefinition, type ReportResult, type SavedReport } from '../api';
import { formatDate } from '../labels';
import { EmptyState, ViewFrame } from '../Layout';
import { money } from '../nexus/Clients';
import { useShell } from '../shell';
import { currentTier } from '../suites';
import { ErrorText, Loading, useAction, useLoad } from '../ui';
import { EnterpriseBadge } from './Automations';
import { t, tf, locale, numberLocale, live } from '../i18n';

const SUITE = live(() => ({ label: t("Symphony"), href: '#/symphony' }));

function Bars({ rows }: { rows: { label: string; value: number; hint?: string }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (rows.length === 0) return <p className="muted">{t("No data yet.")}</p>;
  return (
    <div className="bars">
      {rows.map((r) => (
        <div key={r.label} className="bar-row">
          <span className="bar-label">{r.label}</span>
          <span className="bar-track"><span className="bar-fill" style={{ width: `${(r.value / max) * 100}%` }} /></span>
          <span className="bar-value">{r.hint ?? r.value}</span>
        </div>
      ))}
    </div>
  );
}

export function ReportsView() {
  const { notify } = useShell();
  const kpis = useLoad(() => api.kpis(), []);
  const datasets = useLoad(() => api.reportDatasets(), []);
  const action = useAction();
  const enterprise = currentTier() === 'symphony';
  const k = kpis.data;
  return (
    <ViewFrame title={t("Reports")} subtitle={t("Standard KPIs and CSV exports for every edition")} crumbs={[SUITE, { label: t("Reports") }]}
      actions={enterprise ? <a className="button primary" href="#/symphony/report-builder">{t("Open report builder")}</a> : <span className="locked-action">{t("Report builder")} <EnterpriseBadge /></span>}>
      {!k && <Loading error={kpis.error} />}
      {k && (
        <>
          <div className="kpi-grid">
            <div className="kpi"><span>{t("Active clients")}</span><strong>{k.activeClients}</strong></div>
            <div className="kpi"><span>{t("Active agreement value / yr")}</span><strong>{money(k.activeAgreementValue)}</strong></div>
            <div className="kpi"><span>{t("Open pipeline")}</span><strong>{money(k.pipelineValue)}</strong><small>{k.openDeals}  {t("deals")}</small></div>
            <div className={`kpi${k.overdueInvoices ? ' warn' : ''}`}><span>{t("Overdue invoices")}</span><strong>{money(k.overdueAmount)}</strong><small>{k.overdueInvoices}  {t("invoices")}</small></div>
            <div className={`kpi${k.openExceptions ? ' warn' : ''}`}><span>{t("Open exceptions")}</span><strong>{k.openExceptions}</strong></div>
            <div className="kpi"><span>{t("Open work orders")}</span><strong>{k.openWorkOrders}</strong></div>
            <div className="kpi"><span>{t("Visits this month")}</span><strong>{k.visitsCompletedThisMonth} / {k.visitsThisMonth}</strong><small>{t("completed / planned")}</small></div>
          </div>
          <div className="two-col">
            <div className="card-panel"><h2>{t("Deals by stage")}</h2><Bars rows={k.dealsByStage.map((d) => ({ label: d.stage.replace(/_/g, ' '), value: Number(d.value), hint: `${money(d.value)} · ${d.count}` }))} /></div>
            <div className="card-panel"><h2>{t("Invoices by status")}</h2><Bars rows={k.invoicesByStatus.map((d) => ({ label: d.status, value: Number(d.value), hint: `${money(d.value)} · ${d.count}` }))} /></div>
          </div>
        </>
      )}
      <div className="card-panel">
        <h2>{t("CSV export")}</h2>
        <ErrorText error={action.error} />
        {!datasets.data && <Loading error={datasets.error} />}
        <div className="export-grid">
          {datasets.data?.map((d) => (
            <button key={d.key} className="secondary" disabled={action.busy} onClick={() => void action.run(() => api.exportDataset(d.key)).then(() => notify(tf("{name} exported", { name: d.label })))}>⭳ {d.label}</button>
          ))}
        </div>
      </div>
    </ViewFrame>
  );
}

const emptyDef = (ds?: ReportDataset): ReportDefinition => ({ dataset: ds?.key ?? '', columns: ds?.columns.slice(0, 3).map((c) => c.key) ?? [], filters: [], groupBy: null, aggregate: null, sort: null, limit: 500 });

function ResultTable({ result }: { result: ReportResult }) {
  const fmt = (v: unknown, type: string) => (v === null || v === undefined ? '—' : type === 'date' ? formatDate(String(v)) : type === 'number' ? Number(v).toLocaleString(numberLocale(), { maximumFractionDigits: 2 }) : String(v));
  if (result.rows.length === 0) return <EmptyState title={t("No rows")}>{t("Change the filters.")}</EmptyState>;
  return (
    <table className="grid">
      <thead><tr>{result.columns.map((c) => <th key={c.key} className={c.type === 'number' ? 'num' : undefined}>{c.label}</th>)}</tr></thead>
      <tbody>{result.rows.map((r, i) => <tr key={i}>{result.columns.map((c) => <td key={c.key} className={c.type === 'number' ? 'num' : undefined}>{fmt(r[c.key], c.type)}</td>)}</tr>)}</tbody>
    </table>
  );
}

function csvOf(result: ReportResult): string {
  const cell = (v: unknown) => { const s = v === null || v === undefined ? '' : String(v); return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return [result.columns.map((c) => cell(c.label)).join(','), ...result.rows.map((r) => result.columns.map((c) => cell(r[c.key])).join(','))].join('\r\n');
}

function downloadCsv(name: string, result: ReportResult) {
  const url = URL.createObjectURL(new Blob([csvOf(result)], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name.replace(/[^\w-]+/g, '-')}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export function ReportBuilderView() {
  const { notify } = useShell();
  const enterprise = currentTier() === 'symphony';
  const datasets = useLoad(() => api.reportDatasets(), []);
  const saved = useLoad(() => (enterprise ? api.savedReports() : Promise.resolve([] as SavedReport[])), []);
  const [tab, setTab] = useState<string>('builder');
  const [def, setDef] = useState<ReportDefinition | null>(null);
  const [result, setResult] = useState<ReportResult | null>(null);
  const [tabResult, setTabResult] = useState<ReportResult | null>(null);
  const [name, setName] = useState('');
  const action = useAction();
  useEffect(() => { if (datasets.data && !def) setDef(emptyDef(datasets.data[0])); }, [datasets.data, def]);
  const pinned = (saved.data ?? []).filter((s) => s.pinned);
  const active = pinned.find((s) => s.id === tab);
  useEffect(() => {
    setTabResult(null);
    if (active) void action.run(() => api.runReport(active.definition)).then((r) => r && setTabResult(r));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);
  const crumbs = [SUITE, { label: t("Reports"), href: '#/symphony/reports' }, { label: t("Report builder") }];
  if (!enterprise) {
    return (
      <ViewFrame title={t("Report builder")} crumbs={crumbs}>
        <EmptyState title={t("Custom reports are part of Agera Symphony")}>
          <p><EnterpriseBadge /></p>
          <p>{t("Agera Vanguard includes the standard KPI dashboard and CSV export of every list under")} <a href="#/symphony/reports">{t("Reports")}</a>{t(". Upgrading to the Enterprise edition unlocks the report builder and multi-tab cockpits, without moving any data.")}</p>
        </EmptyState>
      </ViewFrame>
    );
  }
  if (!datasets.data || !def) return <ViewFrame title={t("Report builder")} crumbs={crumbs}><Loading error={datasets.error} /></ViewFrame>;
  const ds = datasets.data.find((d) => d.key === def.dataset) ?? datasets.data[0];
  const set = (patch: Partial<ReportDefinition>) => (setDef({ ...def, ...patch }), setResult(null));
  const toggleCol = (k: string) => set({ columns: def.columns.includes(k) ? def.columns.filter((c) => c !== k) : [...def.columns, k] });
  const numeric = ds.columns.filter((c) => c.type === 'number');
  return (
    <ViewFrame title={t("Report builder")} subtitle={t("Build, save and pin your own reports; pinned reports become cockpit tabs")} crumbs={crumbs}>
      <div className="cockpit-tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'builder'} className={tab === 'builder' ? 'active' : undefined} onClick={() => setTab('builder')}>{t("Builder")}</button>
        {pinned.map((p) => <button key={p.id} role="tab" aria-selected={tab === p.id} className={tab === p.id ? 'active' : undefined} onClick={() => setTab(p.id)}>{p.name}</button>)}
      </div>
      <ErrorText error={action.error} />
      {active && (
        <div className="card-panel">
          <div className="panel-head">
            <h2>{active.name}</h2>
            <span className="panel-actions">
              {tabResult && <button className="secondary small" onClick={() => downloadCsv(active.name, tabResult)}>{t("⭳ CSV")}</button>}
              <button className="secondary small" onClick={() => (setDef(active.definition), setName(active.name), setTab('builder'))}>{t("Open in builder")}</button>
              <button className="secondary small" onClick={() => void action.run(() => api.updateSavedReport(active.id, { pinned: false })).then((r) => r && (setTab('builder'), saved.reload()))}>{t("Unpin")}</button>
            </span>
          </div>
          {tabResult ? <ResultTable result={tabResult} /> : <Loading />}
        </div>
      )}
      {tab === 'builder' && (
        <>
          <div className="card-panel report-builder">
            <label>{t("Source")}<select value={def.dataset} onChange={(e) => set(emptyDef(datasets.data!.find((d) => d.key === e.target.value)))}>{datasets.data.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}</select>
            </label>
            <div>
              <span className="builder-label">{t("Columns")}</span>
              <div className="placeholder-chips">{ds.columns.map((c) => <button key={c.key} type="button" className={`chip${def.columns.includes(c.key) ? ' on' : ''}`} disabled={!!def.groupBy} onClick={() => toggleCol(c.key)}>{c.label}</button>)}</div>
            </div>
            <div>
              <span className="builder-label">{t("Filters")}</span>
              {def.filters.map((f, i) => (
                <div key={i} className="step-row">
                  <select aria-label={t("Filter column")} value={f.column} onChange={(e) => set({ filters: def.filters.map((x, j) => (j === i ? { ...x, column: e.target.value } : x)) })}>{ds.columns.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}</select>
                  <select aria-label={t("Filter operator")} value={f.op} onChange={(e) => set({ filters: def.filters.map((x, j) => (j === i ? { ...x, op: e.target.value as typeof f.op } : x)) })}>
                    <option value="equals">{t("equals")}</option><option value="not_equals">{t("does not equal")}</option><option value="contains">{t("contains")}</option><option value="gt">{t("greater than")}</option><option value="lt">{t("less than")}</option>
                  </select>
                  <input aria-label={t("Filter value")} value={f.value} onChange={(e) => set({ filters: def.filters.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)) })} />
                  <button type="button" className="link-button danger" onClick={() => set({ filters: def.filters.filter((_, j) => j !== i) })}>{t("Remove")}</button>
                </div>
              ))}
              <button type="button" className="secondary small" onClick={() => set({ filters: [...def.filters, { column: ds.columns[0].key, op: 'equals', value: '' }] })}>{t("+ Add filter")}</button>
            </div>
            <div className="step-row">
              <label>{t("Group by")}<select value={def.groupBy ?? ''} onChange={(e) => set({ groupBy: e.target.value || null, aggregate: e.target.value ? def.aggregate ?? { fn: 'count', column: null } : null, sort: null })}>
                  <option value="">{t("No grouping (list rows)")}</option>{ds.columns.filter((c) => c.type !== 'number').map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                </select>
              </label>
              {def.groupBy && (
                <label>{t("Total")}<select value={def.aggregate?.fn === 'count' ? 'count' : `${def.aggregate?.fn}:${def.aggregate?.column}`} onChange={(e) => { const [fn, column] = e.target.value.split(':'); set({ aggregate: { fn: fn as 'count', column: column ?? null } }); }}>
                    <option value="count">{t("Count of rows")}</option>
                    {numeric.flatMap((c) => (['sum', 'avg', 'min', 'max'] as const).map((fn) => <option key={`${fn}:${c.key}`} value={`${fn}:${c.key}`}>{fn === 'avg' ? t("Average") : fn[0].toUpperCase() + fn.slice(1)}  {t("of")} {c.label}</option>))}
                  </select>
                </label>
              )}
              {!def.groupBy && (
                <label>{t("Sort by")}<select value={def.sort ? `${def.sort.column}:${def.sort.direction}` : ''} onChange={(e) => { const [column, direction] = e.target.value.split(':'); set({ sort: column ? { column, direction: direction as 'asc' } : null }); }}>
                    <option value="">{t("Default")}</option>
                    {ds.columns.flatMap((c) => [<option key={`${c.key}:asc`} value={`${c.key}:asc`}>{c.label} ↑</option>, <option key={`${c.key}:desc`} value={`${c.key}:desc`}>{c.label} ↓</option>])}
                  </select>
                </label>
              )}
            </div>
            <div className="step-row">
              <button className="primary" disabled={action.busy} onClick={() => void action.run(() => api.runReport(def)).then((r) => r && setResult(r))}>{t("Run report")}</button>
              {result && <button className="secondary" onClick={() => downloadCsv(name || ds.label, result)}>{t("⭳ CSV")}</button>}
              <input aria-label={t("Report name")} placeholder={t("Name to save as")} value={name} onChange={(e) => setName(e.target.value)} />
              <button className="secondary" disabled={!name.trim() || action.busy} onClick={() => void action.run(() => api.saveReport(name.trim(), def, false)).then((r) => r && (notify(t("Report saved")), saved.reload()))}>{t("Save")}</button>
              <button className="secondary" disabled={!name.trim() || action.busy} onClick={() => void action.run(() => api.saveReport(name.trim(), def, true)).then((r) => r && (notify(t("Report pinned as a cockpit tab")), saved.reload()))}>Save & pin as tab</button>
            </div>
          </div>
          {result && <div className="card-panel"><h2>{result.rows.length}  {t("rows")}</h2><ResultTable result={result} /></div>}
          {(saved.data?.length ?? 0) > 0 && (
            <div className="card-panel">
              <h2>{t("Saved reports")}</h2>
              <table className="grid">
                <thead><tr><th>{t("Report")}</th><th>{t("Source")}</th><th>{t("Updated")}</th><th /></tr></thead>
                <tbody>
                  {saved.data!.map((s) => (
                    <tr key={s.id}>
                      <td>{s.name} {s.pinned && <small className="muted">{t("(cockpit tab)")}</small>}</td>
                      <td>{datasets.data!.find((d) => d.key === s.definition.dataset)?.label}</td>
                      <td>{formatDate(s.updatedAt)}</td>
                      <td className="row-actions">
                        <button className="link-button" onClick={() => (setDef(s.definition), setName(s.name), setResult(null))}>{t("Open")}</button>
                        <button className="link-button" onClick={() => void action.run(() => api.updateSavedReport(s.id, { pinned: !s.pinned })).then((r) => r && saved.reload())}>{s.pinned ? t("Unpin") : t("Pin as tab")}</button>
                        <button className="link-button danger" onClick={() => window.confirm(tf("Delete {name}?", { name: s.name })) && void action.run(() => api.deleteSavedReport(s.id)).then((r) => r !== undefined && saved.reload())}>{t("Delete")}</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </ViewFrame>
  );
}
