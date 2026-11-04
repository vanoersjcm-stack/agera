import { useState } from 'react';
import { api } from '../api';
import { ViewFrame } from '../Layout';
import { money } from '../nexus/Clients';
import { navigate, type Route, withParams } from '../router';
import { Loading, useLoad } from '../ui';
import { t } from '../i18n';

interface Bar {
  label: string;
  hint: string;
  value: number;
  start: number;
  kind: 'total' | 'up' | 'down' | 'actual';
  href?: string;
}

function Slider({ label, hint, value, max, onChange }: { label: string; hint: string; value: number; max: number; onChange: (v: number) => void }) {
  return (
    <label className="what-if">
      <span>{label} <strong>{value}%</strong></span>
      <input type="range" min={0} max={max} step={5} value={value} onChange={(e) => onChange(Number(e.target.value))} aria-label={label} />
      <small className="muted">{hint}</small>
    </label>
  );
}

export function PrognosisView({ route }: { route: Route }) {
  const year = Number(route.params.get('year')) || new Date().getFullYear();
  const { data, error } = useLoad(() => api.waterfall(year), [year]);
  const [expansionPct, setExpansionPct] = useState(100);
  const [churnPct, setChurnPct] = useState(100);
  const [pipelinePct, setPipelinePct] = useState(0);
  const crumbs = [{ label: t("Symphony"), href: '#/symphony' }, { label: t("Prognosis") }];
  if (!data) {
    return (
      <ViewFrame title={t("Run-rate prognosis")} crumbs={crumbs}>
        <Loading error={error} />
      </ViewFrame>
    );
  }
  const baseline = Number(data.baseline);
  const expansion = (Number(data.expansion) * expansionPct) / 100;
  const pipeline = (Number(data.openPipeline) * pipelinePct) / 100;
  const churn = (Number(data.churn) * churnPct) / 100;
  const prognosis = baseline + expansion + pipeline - churn;
  const actuals = Number(data.actuals);
  const adjusted = expansionPct !== 100 || churnPct !== 100 || pipelinePct !== 0;
  const bars: Bar[] = [
    { label: t("Baseline"), hint: t("Approved financial plans"), value: baseline, start: 0, kind: 'total', href: '#/nexus/financial-plans' },
    { label: t("+ Signed expansion"), hint: t("Annual value of active agreements"), value: expansion, start: baseline, kind: 'up', href: '#/nexus/agreements?status=active' },
    ...(pipelinePct > 0 ? [{ label: t("+ Pipeline won"), hint: `${pipelinePct}% of open deals`, value: pipeline, start: baseline + expansion, kind: 'up' as const, href: '#/nexus/pipeline' }] : []),
    { label: t("− Known churn"), hint: t("Agreements ending within 90 days"), value: churn, start: prognosis, kind: 'down', href: '#/nexus/agreements?status=active' },
    { label: adjusted ? t("Prognosis (what-if)") : t("Live prognosis"), hint: t("Baseline + expansion − churn"), value: prognosis, start: 0, kind: 'total' },
    { label: t("Invoiced actuals"), hint: `Paid invoices in ${year}, excl. VAT`, value: actuals, start: 0, kind: 'actual', href: '#/symphony/invoices?status=paid' },
  ];
  const max = Math.max(...bars.map((b) => b.start + b.value), 1);
  const pct = (v: number) => `${Math.max(0, (v / max) * 100)}%`;
  return (
    <ViewFrame
      title={t("Run-rate prognosis")}
      subtitle={`Fiscal year ${year} · all amounts in EUR`}
      crumbs={crumbs}
      actions={
        <label className="inline-select">
          {t("Year")}{' '}
          <select value={year} onChange={(e) => navigate(withParams(route, { year: e.target.value }))}>
            {[year - 2, year - 1, year, year + 1].map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </label>
      }
    >
      <div className="wf-columns">
        <a className="wf-card" href="#/nexus/financial-plans"><small>{t("Baseline target")}</small><strong>{money(baseline)}</strong><span>{t("Approved financial plans")}</span></a>
        <a className="wf-card up" href="#/nexus/agreements?status=active"><small>{t("(+) Signed expansion")}</small><strong>{money(expansion)}</strong><span>{pipelinePct > 0 ? `+ ${money(pipeline)} pipeline won` : `Open deal pipeline ${money(data.openPipeline)}`}</span></a>
        <a className="wf-card down" href="#/nexus/agreements?status=active"><small>{t("(−) Known churn")}</small><strong>{money(churn)}</strong><span>{t("Agreements ending within 90 days")}</span></a>
        <div className="wf-card live"><small>{adjusted ? t("Prognosis (what-if)") : t("Live prognosis run-rate")}</small><strong>{money(prognosis)}</strong><span>{t("Baseline + expansion − churn")}</span></div>
        <a className="wf-card" href="#/symphony/invoices?status=paid"><small>{t("Invoiced actuals")}</small><strong>{money(actuals)}</strong><span>{prognosis > 0 ? `${Math.round((actuals / prognosis) * 100)}% of prognosis` : t("Paid invoices")}</span></a>
      </div>
      <div className="card-panel">
        <h2>{t("Waterfall")}</h2>
        <div className="waterfall" role="list">
          {bars.map((b) => (
            <div key={b.label} className="wf-row" role="listitem">
              <div className="wf-label">
                {b.href ? <a href={b.href}>{b.label}</a> : <strong>{b.label}</strong>}
                <small className="muted">{b.hint}</small>
              </div>
              <div className="wf-track">
                <div className={`wf-bar wf-${b.kind}`} style={{ marginLeft: pct(b.start), width: pct(b.value) }} />
              </div>
              <div className="wf-value">{b.kind === 'down' ? '−' : ''}{money(b.value)}</div>
            </div>
          ))}
        </div>
      </div>
      <div className="card-panel">
        <h2>{t("What-if")}</h2>
        <p className="muted">{t("Adjust the assumptions; the waterfall recalculates instantly. Nothing is saved.")}</p>
        <div className="what-if-box what-if-grid">
          <Slider label={t("Signed expansion realised")} hint={t("Share of the annual value of active agreements that is realised")} value={expansionPct} max={150} onChange={setExpansionPct} />
          <Slider label={t("Churn exposure")} hint={t("How much of the known churn risk materialises")} value={churnPct} max={200} onChange={setChurnPct} />
          <Slider label={t("Open pipeline won")} hint={t("Share of open deals expected to close")} value={pipelinePct} max={100} onChange={setPipelinePct} />
        </div>
        {adjusted && <button className="secondary" onClick={() => (setExpansionPct(100), setChurnPct(100), setPipelinePct(0))}>{t("Reset to live figures")}</button>}
      </div>
    </ViewFrame>
  );
}
