import { api } from '../api';
import { ViewFrame } from '../Layout';
import { useShell } from '../shell';
import { Loading, useLoad } from '../ui';
import { nonCompliantStores } from './Stores';

function Tile({ href, value, label, tone }: { href: string; value: string; label: string; tone?: string }) {
  return (
    <a className={`tile ${tone ?? ''}`} href={href}>
      <strong>{value}</strong>
      <span>{label}</span>
    </a>
  );
}

export function RetailOverview() {
  const { openNew } = useShell();
  const workOrders = useLoad(() => api.workOrders());
  const visits = useLoad(() => api.visits());
  const stores = useLoad(() => api.stores());
  const alerts = useLoad(() => api.alerts());
  const error = workOrders.error ?? visits.error ?? stores.error;
  const open = workOrders.data?.items.filter((w) => w.status === 'PENDING' || w.status === 'IN_PROGRESS').length;
  const upcoming = visits.data?.items.filter((v) => v.status === 'PLANNED' || v.status === 'IN_PROGRESS').length;
  const flagged = alerts.data ? nonCompliantStores(alerts.data.anomalies).size : undefined;
  const show = (n: number | undefined) => (n === undefined ? '—' : String(n));
  return (
    <ViewFrame
      title="RetailPower overview"
      crumbs={[{ label: 'RetailPower' }]}
      actions={
        <>
          <button className="secondary" onClick={() => openNew('store_visit')}>+ New store visit</button>
          <button className="primary" onClick={() => openNew('work_order')}>+ New work order</button>
        </>
      }
    >
      {error && <Loading error={error} />}
      <div className="tiles">
        <Tile href="#/retailpower/work-orders" value={show(open)} label="Open work orders" />
        <Tile href="#/retailpower/store-visits" value={show(upcoming)} label="Planned and ongoing store visits" />
        <Tile href="#/retailpower/stores" value={show(stores.data?.total)} label="Stores" />
        <Tile href="#/retailpower/stores?compliance=not_compliant" value={show(flagged)} label="Stores not compliant" tone={flagged ? 'bad' : undefined} />
      </div>
    </ViewFrame>
  );
}
