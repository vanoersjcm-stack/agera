import { useEffect, useState } from 'react';
import { type Agreement, api, type SalesRoom } from './api';
import { EmptyState, ViewFrame } from './Layout';

export function useRoomsAndAgreements() {
  const [rooms, setRooms] = useState<SalesRoom[] | null>(null);
  const [agreements, setAgreements] = useState<Agreement[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.rooms().then(setRooms, (e: Error) => setError(e.message));
    api.agreements().then(setAgreements, (e: Error) => setError(e.message));
  }, []);
  return { rooms, agreements, error };
}

const label = (s: string) => s.replace(/_/g, ' ');

export function SalesRoomsView({ external }: { external: boolean }) {
  const { rooms, agreements, error } = useRoomsAndAgreements();
  const title = external ? 'My sales rooms' : 'Sales rooms & agreements';
  return (
    <ViewFrame title={title} crumbs={[{ label: title }]}>
      {error && <p className="error">{error}</p>}
      {!error && (!rooms || !agreements) && <p>Loading…</p>}
      {rooms && agreements && rooms.length === 0 && agreements.length === 0 && (
        <EmptyState title={external ? 'Nothing shared with you yet' : 'No sales rooms or agreements yet'}>
          {external
            ? 'As soon as Agera opens a sales room or shares an agreement with your organisation, it appears here.'
            : 'Create rooms and agreements through the API (POST /api/v1/dsrs, POST /api/v1/agreements) or import them with the seed script.'}
        </EmptyState>
      )}
      {rooms && rooms.length > 0 && (
        <article className="card">
          <h2>Sales rooms <small>{rooms.length}</small></h2>
          <table className="grid">
            <thead>
              <tr>
                <th>Room</th>
                <th>Status</th>
                <th>Opened</th>
                {!external && <th>Activity</th>}
              </tr>
            </thead>
            <tbody>
              {rooms.map((r) => (
                <tr key={r.id}>
                  <td>{r.roomName}</td>
                  <td><span className={`badge ${r.status}`}>{r.status}</span></td>
                  <td>{new Date(r.createdAt).toLocaleDateString()}</td>
                  {!external && <td><a href={`#/dsr?dsrId=${r.id}`}>View activity</a></td>}
                </tr>
              ))}
            </tbody>
          </table>
        </article>
      )}
      {agreements && agreements.length > 0 && (
        <article className="card">
          <h2>Agreements <small>{agreements.length}</small></h2>
          <table className="grid">
            <thead>
              <tr>
                <th>Title</th>
                <th>Status</th>
                <th>Document</th>
              </tr>
            </thead>
            <tbody>
              {agreements.map((a) => (
                <tr key={a.id}>
                  <td>{a.title}</td>
                  <td><span className={`badge ${a.status}`}>{label(a.status)}</span></td>
                  <td><a href={a.documentUrl} target="_blank" rel="noreferrer">Open</a></td>
                </tr>
              ))}
            </tbody>
          </table>
        </article>
      )}
      {rooms && agreements && rooms.length > 0 && agreements.length === 0 && (
        <p className="empty">No agreements {external ? 'shared with you' : 'recorded'} yet.</p>
      )}
    </ViewFrame>
  );
}
