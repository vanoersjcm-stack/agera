import { useEffect, useState } from 'react';
import { api, type DsrStatus } from './api';
import { EmptyState, ViewFrame } from './Layout';
import { type Route } from './router';

const POLL_MS = 30_000;

/** Polls DSR status (pull-based, no push channel). */
export function useDsrStatus(dsrId?: string): { status: DsrStatus | null; error: string | null } {
  const [status, setStatus] = useState<DsrStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    const load = () =>
      api.dsrStatus(dsrId).then(
        (s) => !cancelled && (setStatus(s), setError(null)),
        (e: Error) => !cancelled && setError(e.message),
      );
    void load();
    const timer = window.setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [dsrId]);
  return { status, error };
}

export function DsrSummary({ status }: { status: DsrStatus }) {
  const { summary } = status;
  return (
    <div className="kpis">
      <div><strong>{summary.activeDsrs}</strong> active DSRs</div>
      <div><strong>{summary.stakeholders}</strong> stakeholders</div>
      <div className="good"><strong>{summary.accepted}</strong> accepted</div>
      <div><strong>{summary.pending}</strong> pending</div>
      <div className="bad"><strong>{summary.rejected}</strong> rejected</div>
    </div>
  );
}

export function DsrView({ route }: { route: Route }) {
  const dsrId = route.params.get('dsrId') ?? undefined;
  const { status, error } = useDsrStatus(dsrId);
  return (
    <ViewFrame
      title="DSR activity"
      crumbs={[{ label: 'DSR activity', href: '#/dsr' }, ...(dsrId ? [{ label: `DSR ${dsrId.slice(0, 8)}` }] : [])]}
      actions={dsrId && <a href="#/dsr">Show all DSRs</a>}
    >
      {error && <p className="error">{error}</p>}
      {!status && !error && <p>Loading…</p>}
      {status && <DsrSummary status={status} />}
      {status?.dsrs.length === 0 && (
        <EmptyState
          title={dsrId ? 'No activity in this room yet' : `No DSR activity in the last ${status.windowDays} days`}
          action={<a className="button-link" href="#/rooms">View sales rooms</a>}
        >
          Stakeholder interactions (opened, zone viewed, briefing played, downloads, comments, terms) appear here as soon as they are recorded.
        </EmptyState>
      )}
      {status?.dsrs.map((dsr) => (
        <article key={dsr.dsrId} className="card">
          <h2>
            <a href={`#/dsr?dsrId=${dsr.dsrId}`}>DSR {dsr.dsrId.slice(0, 8)}</a>
            <small> {dsr.activityCount} activities · last {new Date(dsr.lastActivityAt).toLocaleString()}</small>
          </h2>
          <table className="grid">
            <thead>
              <tr>
                <th>Stakeholder</th>
                <th>Status</th>
                <th className="num">Activities</th>
                <th>Last activity</th>
              </tr>
            </thead>
            <tbody>
              {dsr.stakeholders.map((s) => (
                <tr key={s.email}>
                  <td>{s.email}</td>
                  <td><span className={`badge ${s.status}`}>{s.status}</span></td>
                  <td className="num">{s.activityCount}</td>
                  <td>{s.lastActivityType.replace('_', ' ')} · {new Date(s.lastActivityAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </article>
      ))}
    </ViewFrame>
  );
}
