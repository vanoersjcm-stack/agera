import { useEffect, useState } from 'react';
import { type Anomalies, api, type DsrStatus, type Pnl, type SalesRoom } from './api';
import { formatAmount } from './format';
import { EmptyState, ViewFrame } from './Layout';
import { useRoomsAndAgreements } from './SalesRoomsView';

function Tile({ href, value, label, tone }: { href: string; value: string; label: string; tone?: string }) {
  return (
    <a className={`tile ${tone ?? ''}`} href={href}>
      <strong>{value}</strong>
      <span>{label}</span>
    </a>
  );
}

function InternalDashboard() {
  const [pnl, setPnl] = useState<Pnl | null>(null);
  const [rooms, setRooms] = useState<SalesRoom[] | null>(null);
  const [dsr, setDsr] = useState<DsrStatus | null>(null);
  const [anomalies, setAnomalies] = useState<Anomalies | null>(null);
  const [failed, setFailed] = useState(0);

  useEffect(() => {
    const fail = () => setFailed((n) => n + 1);
    api.pnl({}).then(setPnl, fail);
    api.rooms().then(setRooms, fail);
    api.dsrStatus().then(setDsr, fail);
    api.anomalies().then(setAnomalies, fail);
  }, []);

  const revenue = pnl?.totals.find((t) => t.category === 'revenue');
  const activeRooms = rooms?.filter((r) => r.status === 'active').length;
  const count = (type: string) => anomalies?.anomalies.filter((a) => a.anomalyType === type).length ?? 0;
  const loaded = pnl && rooms && dsr && anomalies;
  const empty = loaded && pnl.rows.length === 0 && rooms.length === 0 && dsr.dsrs.length === 0 && anomalies.anomalies.length === 0;

  return (
    <ViewFrame title="Dashboard">
      {failed > 0 && <p className="error">Some figures could not be loaded ({failed}). The tiles below show what is available.</p>}
      {!loaded && failed === 0 && <p>Loading…</p>}
      {empty ? (
        <EmptyState title="No data in this tenant yet">
          Import the Agera source files with <code>npm run seed:agera</code> (or <code>./deploy.sh seed-agera</code> on the server), or create
          financial models and sales rooms through the API.
        </EmptyState>
      ) : (
        <div className="tiles">
          <Tile
            href="#/financials"
            value={revenue ? formatAmount(revenue.projected, revenue.currency) : '—'}
            label="Projected revenue (approved models)"
          />
          <Tile href="#/rooms" value={activeRooms === undefined ? '—' : String(activeRooms)} label="Active sales rooms" />
          <Tile href="#/dsr" value={dsr ? String(dsr.summary.stakeholders) : '—'} label={`Engaged stakeholders (${dsr?.windowDays ?? '…'} days)`} />
          <Tile
            href="#/anomalies"
            value={anomalies ? String(anomalies.anomalies.length) : '—'}
            label={`Open anomalies · ${count('financial_variance')} P&L · ${count('dsr_stagnation')} DSR · ${count('store_compliance')} store`}
            tone={anomalies && anomalies.anomalies.length > 0 ? 'bad' : undefined}
          />
        </div>
      )}
    </ViewFrame>
  );
}

function ExternalDashboard() {
  const { rooms, agreements, error } = useRoomsAndAgreements();
  return (
    <ViewFrame title="Dashboard">
      {error && <p className="error">{error}</p>}
      {!error && (!rooms || !agreements) && <p>Loading…</p>}
      {rooms && agreements && rooms.length === 0 && agreements.length === 0 ? (
        <EmptyState title="Nothing shared with you yet">
          As soon as Agera opens a sales room or shares an agreement with your organisation, it appears here.
        </EmptyState>
      ) : (
        rooms &&
        agreements && (
          <div className="tiles">
            <Tile href="#/rooms" value={String(rooms.length)} label="Active sales rooms" />
            <Tile href="#/rooms" value={String(agreements.length)} label="Agreements" />
            {rooms.slice(0, 4).map((r) => (
              <Tile key={r.id} href="#/rooms" value={r.roomName} label={`Opened ${new Date(r.createdAt).toLocaleDateString()}`} tone="text" />
            ))}
          </div>
        )
      )}
    </ViewFrame>
  );
}

export function DashboardView({ external }: { external: boolean }) {
  return external ? <ExternalDashboard /> : <InternalDashboard />;
}
