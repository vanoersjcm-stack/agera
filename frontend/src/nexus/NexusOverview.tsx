import { api } from '../api';
import { formatAmount } from '../format';
import { ViewFrame } from '../Layout';
import { useShell } from '../shell';
import { Loading, useLoad } from '../ui';

function Tile({ href, value, label, tone }: { href: string; value: string; label: string; tone?: string }) {
  return (
    <a className={`tile ${tone ?? ''}`} href={href}>
      <strong>{value}</strong>
      <span>{label}</span>
    </a>
  );
}

export function NexusOverview() {
  const { openNew } = useShell();
  const pnl = useLoad(() => api.pnl({}));
  const rooms = useLoad(() => api.rooms());
  const agreements = useLoad(() => api.agreements());
  const engagement = useLoad(() => api.engagement());
  const alerts = useLoad(() => api.alerts());
  const error = pnl.error ?? rooms.error ?? agreements.error ?? alerts.error;
  const revenue = pnl.data?.totals.find((t) => t.category === 'revenue');
  const activeRooms = rooms.data?.filter((r) => r.status === 'active').length;
  const awaiting = agreements.data?.filter((a) => a.status === 'pending_approval').length;
  const alertCount = alerts.data?.anomalies.length;
  return (
    <ViewFrame
      title="Nexus overview"
      crumbs={[{ label: 'Nexus' }]}
      actions={
        <>
          <button className="secondary" onClick={() => openNew('client_room')}>+ New client room</button>
          <button className="primary" onClick={() => openNew('agreement')}>+ New agreement</button>
        </>
      }
    >
      {error && <Loading error={error} />}
      <div className="tiles">
        <Tile href="#/nexus/profit-loss" value={revenue ? formatAmount(revenue.projected, revenue.currency) : '—'} label="Planned revenue (approved plans)" />
        <Tile href="#/nexus/agreements?status=pending_approval" value={awaiting === undefined ? '—' : String(awaiting)} label="Agreements awaiting approval" tone={awaiting ? 'warn' : undefined} />
        <Tile href="#/nexus/client-rooms" value={activeRooms === undefined ? '—' : String(activeRooms)} label="Active client rooms" />
        <Tile href="#/nexus/client-rooms" value={engagement.data ? String(engagement.data.summary.stakeholders) : '—'} label={`Client contacts active (last ${engagement.data?.windowDays ?? 30} days)`} />
        <Tile href="#/nexus/alerts" value={alertCount === undefined ? '—' : String(alertCount)} label="Open alerts" tone={alertCount ? 'bad' : undefined} />
      </div>
    </ViewFrame>
  );
}
