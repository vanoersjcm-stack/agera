import { useEffect, useState } from 'react';
import { api, type FinancialModel, type Pnl, type PnlAggregate } from './api';
import { CATEGORY_LABELS, formatAmount, formatPercent, varianceTone } from './format';
import { EmptyState, ViewFrame } from './Layout';
import { navigate, type Route } from './router';

function AggregateRow({ row, label }: { row: PnlAggregate; label: string }) {
  const tone = varianceTone(row.category, row.variance);
  return (
    <tr className={row.periodCode === null ? 'total' : undefined}>
      <td>{label}</td>
      <td>{CATEGORY_LABELS[row.category]}</td>
      <td className="num">{formatAmount(row.projected, row.currency)}</td>
      <td className="num">{formatAmount(row.actual, row.currency)}</td>
      <td className={`num ${tone}`}>
        {formatAmount(row.variance, row.currency)} <small>{formatPercent(row.variancePercent)}</small>
      </td>
    </tr>
  );
}

/** Financial projection overview: projected vs. actual per period and category, with variance. */
export function FinancialsView({ route }: { route: Route }) {
  const modelId = route.params.get('modelId') ?? '';
  const period = route.params.get('period') ?? '';
  const [models, setModels] = useState<FinancialModel[]>([]);
  const [pnl, setPnl] = useState<Pnl | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.models().then(setModels, (e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    setError(null);
    api.pnl({ modelId, period }).then(setPnl, (e: Error) => setError(e.message));
  }, [modelId, period]);

  const update = (changes: Record<string, string>) => {
    const params = new URLSearchParams(route.params);
    for (const [key, value] of Object.entries(changes)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    navigate(`/financials${params.size ? `?${params}` : ''}`);
  };

  return (
    <ViewFrame
      title="Financial projections"
      crumbs={[{ label: 'Financials', href: '#/financials' }, ...(modelId || period ? [{ label: 'Filtered' }] : [])]}
    >
        <div className="filters">
          <label>
            Model
            <select value={modelId} onChange={(e) => update({ modelId: e.target.value })}>
              <option value="">All approved models</option>
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.modelName} ({m.fiscalYear}, {m.status})
                </option>
              ))}
            </select>
          </label>
          <label>
            Period
            <input
              placeholder="2026, 2026-Q1 or 2026-01"
              defaultValue={period}
              key={period}
              onKeyDown={(e) => e.key === 'Enter' && update({ period: e.currentTarget.value.trim() })}
              onBlur={(e) => e.currentTarget.value.trim() !== period && update({ period: e.currentTarget.value.trim() })}
            />
          </label>
        </div>
      {error && <p className="error">{error}</p>}
      {!pnl && !error && <p>Loading…</p>}
      {pnl && pnl.rows.length === 0 && !error && (
        <EmptyState
          title={modelId || period ? 'No line items for this selection' : 'No approved financial models yet'}
          action={(modelId || period) && <button className="secondary" onClick={() => navigate('/financials')}>Clear filters</button>}
        >
          {modelId || period
            ? 'Try another model or period, or clear the filters.'
            : 'Approved models with line items appear here. Import the client contracts with the seed script or create a model through the API.'}
        </EmptyState>
      )}
      {pnl && pnl.rows.length > 0 && (
        <table className="grid">
          <thead>
            <tr>
              <th>Period</th>
              <th>Category</th>
              <th className="num">Projected</th>
              <th className="num">Actual</th>
              <th className="num">Variance</th>
            </tr>
          </thead>
          <tbody>
            {pnl.rows.map((row) => (
              <AggregateRow key={`${row.periodCode}-${row.category}-${row.currency}`} row={row} label={row.periodCode ?? ''} />
            ))}
          </tbody>
          <tfoot>
            {pnl.totals.map((row) => (
              <AggregateRow key={`total-${row.category}-${row.currency}`} row={row} label="Total" />
            ))}
          </tfoot>
        </table>
      )}
      <p className="hint">Variance = actual − projected, counted only for lines that already have actuals.</p>
    </ViewFrame>
  );
}
