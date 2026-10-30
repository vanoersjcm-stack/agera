import { api, type Category, type PnlAggregate } from '../api';
import { formatAmount, formatPercent, varianceTone } from '../format';
import { CATEGORY } from '../labels';
import { EmptyState, ViewFrame } from '../Layout';
import { navigate, type Route, withParams } from '../router';
import { Loading, useLoad } from '../ui';
import { periodLabel } from './FinancialPlans';

function Row({ row, label }: { row: PnlAggregate; label: string }) {
  const tone = varianceTone(row.category, row.variance);
  return (
    <tr>
      <td>{label}</td>
      <td>{CATEGORY[row.category as Category]}</td>
      <td className="num">{formatAmount(row.projected, row.currency)}</td>
      <td className="num">{formatAmount(row.actual, row.currency)}</td>
      <td className={`num ${tone}`}>
        {formatAmount(row.variance, row.currency)} <small>{formatPercent(row.variancePercent)}</small>
      </td>
    </tr>
  );
}

function periodOptions(): { value: string; label: string }[] {
  const year = new Date().getFullYear();
  return [year - 1, year, year + 1].flatMap((y) => [
    { value: String(y), label: `Full year ${y}` },
    ...[1, 2, 3, 4].map((q) => ({ value: `${y}-Q${q}`, label: `Q${q} ${y}` })),
  ]);
}

/** Plan versus actual per period and category, for approved plans. */
export function ProfitLossView({ route }: { route: Route }) {
  const modelId = route.params.get('modelId') ?? '';
  const period = route.params.get('period') ?? '';
  const models = useLoad(() => api.models());
  const pnl = useLoad(() => api.pnl({ modelId, period }), [modelId, period]);
  const approved = (models.data ?? []).filter((m) => m.status === 'approved');
  const options = periodOptions();
  if (period && !options.some((o) => o.value === period)) options.unshift({ value: period, label: periodLabel(period) });
  const filtered = !!(modelId || period);
  return (
    <ViewFrame title="Profit & loss" crumbs={[{ label: 'Nexus', href: '#/nexus' }, { label: 'Profit & loss' }]}>
      <div className="filters">
        <label>
          Financial plan
          <select value={modelId} onChange={(e) => navigate(withParams(route, { modelId: e.target.value }))}>
            <option value="">All approved plans</option>
            {approved.map((m) => (
              <option key={m.id} value={m.id}>{m.modelName} ({m.fiscalYear})</option>
            ))}
          </select>
        </label>
        <label>
          Period
          <select value={period} onChange={(e) => navigate(withParams(route, { period: e.target.value }))}>
            <option value="">All periods</option>
            {options.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>
        {filtered && <button className="secondary align-end" onClick={() => navigate('/nexus/profit-loss')}>Clear filters</button>}
      </div>
      {!pnl.data && <Loading error={pnl.error} />}
      {pnl.data && pnl.data.rows.length === 0 && (
        <EmptyState
          title={filtered ? 'No plan lines for this selection' : 'No approved financial plans yet'}
          action={<a className="button-link" href="#/nexus/financial-plans">Go to financial plans</a>}
        >
          {filtered ? 'Try another plan or period.' : 'Approve a financial plan with plan lines to see it here.'}
        </EmptyState>
      )}
      {pnl.data && pnl.data.rows.length > 0 && (
        <table className="grid">
          <thead>
            <tr>
              <th>Period</th>
              <th>Category</th>
              <th className="num">Plan</th>
              <th className="num">Actual</th>
              <th className="num">Difference</th>
            </tr>
          </thead>
          <tbody>
            {pnl.data.rows.map((row) => (
              <Row key={`${row.periodCode}-${row.category}-${row.currency}`} row={row} label={row.periodCode ? periodLabel(row.periodCode) : ''} />
            ))}
          </tbody>
          <tfoot>
            {pnl.data.totals.map((row) => (
              <Row key={`total-${row.category}-${row.currency}`} row={row} label="Total" />
            ))}
          </tfoot>
        </table>
      )}
      <p className="hint">Difference = actual − plan, only for lines that already have an actual amount.</p>
    </ViewFrame>
  );
}
