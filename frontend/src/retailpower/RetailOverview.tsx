import { api } from '../api';
import { ViewFrame } from '../Layout';
import { useShell } from '../shell';
import { Loading, useLoad } from '../ui';
import { nonCompliantStores } from './Stores';
import { t } from '../i18n';

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
      title={t("RetailPower overview")}
      crumbs={[{ label: t("RetailPower") }]}
      actions={
        <>
          <button className="secondary" onClick={() => openNew('store_visit')}>{t("+ New store visit")}</button>
          <button className="primary" onClick={() => openNew('work_order')}>{t("+ New work order")}</button>
        </>
      }
    >
      {error && <Loading error={error} />}
      <div className="tiles">
        <Tile href="#/retailpower/work-orders" value={show(open)} label={t("Open work orders")} />
        <Tile href="#/retailpower/store-visits" value={show(upcoming)} label={t("Planned and ongoing store visits")} />
        <Tile href="#/retailpower/stores" value={show(stores.data?.total)} label={t("Stores")} />
        <Tile href="#/retailpower/stores?compliance=not_compliant" value={show(flagged)} label={t("Stores not compliant")} tone={flagged ? 'bad' : undefined} />
      </div>
    </ViewFrame>
  );
}
