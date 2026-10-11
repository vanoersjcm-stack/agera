import { useEffect, useState } from 'react';
import { type Anomalies, api } from './api';

const POLL_MS = 60_000;

const LABELS: Record<string, string> = {
  financial_variance: 'P&L variance',
  dsr_stagnation: 'DSR stagnation',
};

/** Operational anomaly alerts, polled from the API (pull-based, nothing is pushed). */
export function AnomaliesView() {
  const [data, setData] = useState<Anomalies | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      api.anomalies().then(
        (result) => !cancelled && (setData(result), setError(null)),
        (e: Error) => !cancelled && setError(e.message),
      );
    void load();
    const timer = window.setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  if (error) return <p className="error">{error}</p>;
  if (!data) return <p>Loading…</p>;

  const counts = data.anomalies.reduce<Record<string, number>>((acc, a) => ({ ...acc, [a.anomalyType]: (acc[a.anomalyType] ?? 0) + 1 }), {});

  return (
    <section>
      <h1>Operational anomalies</h1>
      <div className="kpis">
        <div className="bad"><strong>{counts.financial_variance ?? 0}</strong> P&amp;L variances &gt; 10%</div>
        <div className="bad"><strong>{counts.dsr_stagnation ?? 0}</strong> DSRs inactive &gt; 7 days</div>
      </div>
      {data.anomalies.length === 0 ? (
        <p>No anomalies.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Type</th>
              <th>Description</th>
              <th>Since</th>
              <th>Open</th>
            </tr>
          </thead>
          <tbody>
            {data.anomalies.map((a) => (
              <tr key={`${a.anomalyType}:${a.sourceId}`}>
                <td>{LABELS[a.anomalyType] ?? a.anomalyType}</td>
                <td>{a.description}</td>
                <td>{new Date(a.observedAt).toLocaleString()}</td>
                <td>
                  {a.anomalyType === 'dsr_stagnation' ? (
                    <a href={`#/dsr?dsrId=${a.sourceId}`}>DSR</a>
                  ) : (
                    <a href={`#/financials?modelId=${String(a.details.modelId)}&period=${String(a.details.periodCode)}`}>P&amp;L</a>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="muted">Updated {new Date(data.generatedAt).toLocaleTimeString()}</p>
    </section>
  );
}
