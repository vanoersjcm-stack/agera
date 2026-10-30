import { useEffect } from 'react';
import { type Alert, type AlertType, api } from '../api';
import { formatAmount } from '../format';
import { ALERT_TYPE, CATEGORY, COMPLIANCE, formatDateTime } from '../labels';
import { EmptyState, ViewFrame } from '../Layout';
import { navigate, type Route, withParams } from '../router';
import { FilterChips, Loading, useLoad } from '../ui';
import { periodLabel } from './FinancialPlans';

const POLL_MS = 60_000;

function describe(a: Alert): string {
  const d = a.details;
  switch (a.anomalyType) {
    case 'financial_variance':
      return `${CATEGORY[d.category as keyof typeof CATEGORY] ?? String(d.category)} ${periodLabel(String(d.periodCode))}: ${formatAmount(String(d.variance), String(d.currency ?? 'EUR'))} against plan`;
    case 'dsr_stagnation':
      return `No client activity in “${String(d.roomName ?? 'client room')}” since ${formatDateTime(a.observedAt)}`;
    case 'store_compliance':
      return `${String(d.storeName ?? d.storeCode ?? 'Store')}: ${COMPLIANCE[String(d.complianceStatus)] ?? String(d.complianceStatus ?? 'not compliant')}`;
  }
}

function openLink(a: Alert): { href: string; label: string } {
  switch (a.anomalyType) {
    case 'financial_variance':
      return { href: `#/nexus/financial-plans/${String(a.details.modelId)}`, label: 'Open plan' };
    case 'dsr_stagnation':
      return { href: `#/nexus/client-rooms/${a.sourceId}?tab=engagement`, label: 'Open client room' };
    case 'store_compliance':
      return { href: `#/retailpower/stores/${a.sourceId}`, label: 'Open store' };
  }
}

/** Alerts are evaluated live by the database on every request and polled here. */
export function AlertsView({ route }: { route: Route }) {
  const type = route.params.get('type') ?? 'all';
  const { data, error, reload } = useLoad(() => api.alerts());
  useEffect(() => {
    const timer = window.setInterval(reload, POLL_MS);
    return () => window.clearInterval(timer);
  }, [reload]);
  const items = data?.anomalies ?? [];
  const count = (t: AlertType) => items.filter((a) => a.anomalyType === t).length;
  const filtered = items.filter((a) => type === 'all' || a.anomalyType === type);
  return (
    <ViewFrame title="Alerts" crumbs={[{ label: 'Nexus', href: '#/nexus' }, { label: 'Alerts' }]}>
      <FilterChips
        value={type}
        onChange={(v) => navigate(withParams(route, { type: v === 'all' ? null : v }))}
        chips={[
          { value: 'all', label: 'All alerts', count: items.length },
          { value: 'financial_variance', label: ALERT_TYPE.financial_variance, count: count('financial_variance') },
          { value: 'dsr_stagnation', label: ALERT_TYPE.dsr_stagnation, count: count('dsr_stagnation') },
          { value: 'store_compliance', label: ALERT_TYPE.store_compliance, count: count('store_compliance') },
        ]}
      />
      {!data && <Loading error={error} />}
      {data && filtered.length === 0 && (
        <EmptyState title="No open alerts">
          All approved plan lines are within 10% of plan, every active client room had client activity in the last 7 days, and no store report is flagged.
        </EmptyState>
      )}
      {filtered.length > 0 && (
        <table className="grid">
          <thead>
            <tr>
              <th>Alert</th>
              <th>What happened</th>
              <th>Since</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {filtered.map((a) => {
              const link = openLink(a);
              return (
                <tr key={`${a.anomalyType}:${a.sourceId}`}>
                  <td><span className="badge tone-bad">{ALERT_TYPE[a.anomalyType]}</span></td>
                  <td>{describe(a)}</td>
                  <td>{formatDateTime(a.observedAt)}</td>
                  <td><a className="button-link" href={link.href}>{link.label}</a></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {data && <p className="muted">Updated {new Date(data.generatedAt).toLocaleTimeString()} · refreshes every minute</p>}
    </ViewFrame>
  );
}
