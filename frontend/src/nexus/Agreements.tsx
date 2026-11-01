import { api, type AgreementStatus } from '../api';
import { clientName, useClients } from '../directory';
import { AGREEMENT_STATUS, formatDate, ROOM_STATUS } from '../labels';
import { EmptyState, ViewFrame } from '../Layout';
import { navigate, type Route, withParams } from '../router';
import { useShell } from '../shell';
import { useState } from 'react';
import { myEmail } from './RoomActivity';
import { DetailList, ErrorText, FilterChips, includesText, Loading, SearchInput, StatusBadge, useAction, useLoad } from '../ui';

const NEXT: Record<AgreementStatus, { status: AgreementStatus; label: string; confirm?: string }[]> = {
  pending_approval: [
    { status: 'active', label: 'Approve & activate' },
    { status: 'expired', label: 'Mark expired', confirm: 'Mark this agreement as expired? This cannot be undone.' },
  ],
  active: [{ status: 'expired', label: 'Mark expired', confirm: 'Mark this agreement as expired? This cannot be undone.' }],
  expired: [],
};

function crumbs(external: boolean) {
  return external
    ? { suite: { label: 'Client portal', href: '#/portal' }, list: { label: 'My agreements', href: '#/portal/agreements' } }
    : { suite: { label: 'Nexus', href: '#/nexus' }, list: { label: 'Agreements', href: '#/nexus/agreements' } };
}

export function AgreementsView({ route, external }: { route: Route; external: boolean }) {
  const { openNew } = useShell();
  const clients = useClients(!external);
  const status = route.params.get('status') ?? 'all';
  const q = route.params.get('q') ?? '';
  const { data, error } = useLoad(() => api.agreements());
  const items = data ?? [];
  const c = crumbs(external);
  const base = external ? '/portal/agreements' : '/nexus/agreements';
  const count = (s: AgreementStatus) => items.filter((a) => a.status === s).length;
  const filtered = items.filter((a) => (status === 'all' || a.status === status) && includesText([a.title, external ? '' : clientName(clients, a.clientId)], q));
  return (
    <ViewFrame
      title={external ? 'My agreements' : 'Agreements'}
      crumbs={[c.suite, { label: c.list.label }]}
      actions={!external && <button className="primary" onClick={() => openNew('agreement')}>+ New agreement</button>}
    >
      <div className="list-toolbar">
        <FilterChips
          value={status}
          onChange={(v) => navigate(withParams(route, { status: v === 'all' ? null : v }))}
          chips={[
            { value: 'all', label: 'All', count: items.length },
            { value: 'pending_approval', label: 'Awaiting approval', count: count('pending_approval') },
            { value: 'active', label: 'Active', count: count('active') },
            { value: 'expired', label: 'Expired', count: count('expired') },
          ]}
        />
        <SearchInput value={q} onChange={(v) => navigate(withParams(route, { q: v }))} placeholder={external ? 'Filter by title' : 'Filter by title or client'} />
      </div>
      {!data && <Loading error={error} />}
      {data && filtered.length === 0 && (
        <EmptyState
          title={items.length === 0 ? (external ? 'No agreements shared with you yet' : 'No agreements yet') : 'No agreements match this filter'}
          action={!external && <button className="primary" onClick={() => openNew('agreement')}>+ New agreement</button>}
        >
          {items.length === 0 && external ? 'As soon as Agera shares an agreement with your organisation, it appears here.' : undefined}
        </EmptyState>
      )}
      {filtered.length > 0 && (
        <table className="grid clickable">
          <thead>
            <tr>
              <th>Title</th>
              {!external && <th>Client</th>}
              <th>Status</th>
              <th>Created</th>
              <th>Document</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((a) => (
              <tr key={a.id} onClick={() => navigate(`${base}/${a.id}`)}>
                <td><a href={`#${base}/${a.id}`}>{a.title}</a></td>
                {!external && <td>{clientName(clients, a.clientId)}</td>}
                <td><StatusBadge status={a.status} label={AGREEMENT_STATUS[a.status]} /></td>
                <td>{formatDate(a.createdAt)}</td>
                <td><a href={a.documentUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>Open document</a></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </ViewFrame>
  );
}

/** Client decision on an agreement awaiting approval, recorded as terms_accepted / terms_rejected in the linked room. */
function ClientDecision({ agreementId, title, roomId }: { agreementId: string; title: string; roomId: string | null }) {
  const { notify } = useShell();
  const [reason, setReason] = useState('');
  const activities = useLoad(() => (roomId ? api.activities(roomId) : Promise.resolve([])), [roomId]);
  const { busy, error, run } = useAction();
  if (!roomId) return <p className="callout">To accept or reject this agreement, please contact your Agera account manager.</p>;
  const decision = activities.data?.find(
    (a) => (a.activityType === 'terms_accepted' || a.activityType === 'terms_rejected') && a.details.agreementId === agreementId && a.stakeholderEmail === myEmail(),
  );
  const decide = (activityType: 'terms_accepted' | 'terms_rejected') =>
    void run(() =>
      api.recordActivity({ dsrId: roomId, stakeholderEmail: myEmail(), activityType, details: { agreementId, agreementTitle: title, reason: reason.trim() } }),
    ).then((r) => r && (notify(activityType === 'terms_accepted' ? 'You accepted the agreement' : 'You rejected the agreement'), activities.reload()));
  return (
    <div className="card-panel decision">
      <h2>Your decision</h2>
      {decision && (
        <p className={decision.activityType === 'terms_accepted' ? 'good' : 'bad'}>
          You {decision.activityType === 'terms_accepted' ? 'accepted' : 'rejected'} this agreement on {formatDate(decision.createdAt)}. Agera will process your decision.
        </p>
      )}
      <label className="field-label" htmlFor="decision-reason">Comment or reason (optional)</label>
      <textarea id="decision-reason" rows={3} maxLength={2000} value={reason} onChange={(e) => setReason(e.target.value)} />
      <div className="form-actions start">
        <button className="primary" disabled={busy} onClick={() => decide('terms_accepted')}>Accept</button>
        <button className="secondary danger" disabled={busy} onClick={() => decide('terms_rejected')}>Reject</button>
      </div>
      <ErrorText error={error} />
    </div>
  );
}

export function AgreementDossier({ id, external }: { id: string; external: boolean }) {
  const { openNew, notify } = useShell();
  const clients = useClients(!external);
  const agreement = useLoad(() => api.agreement(id), [id]);
  const rooms = useLoad(() => api.rooms(), [id]);
  const action = useAction();
  const c = crumbs(external);
  const a = agreement.data;
  if (!a) {
    return (
      <ViewFrame title="Agreement" crumbs={[c.suite, c.list, { label: 'Loading…' }]}>
        <Loading error={agreement.error} />
      </ViewFrame>
    );
  }
  const linked = (rooms.data ?? []).filter((r) => r.agreementId === id);
  const roomBase = external ? '/portal/rooms' : '/nexus/client-rooms';
  const setStatus = (status: AgreementStatus, label: string, confirm?: string) => {
    if (confirm && !window.confirm(confirm)) return;
    void action.run(() => api.setAgreementStatus(id, status)).then((r) => r && (notify(`Agreement: ${label.toLowerCase()}`), agreement.reload()));
  };
  return (
    <ViewFrame
      title={a.title}
      subtitle={<StatusBadge status={a.status} label={AGREEMENT_STATUS[a.status]} />}
      crumbs={[c.suite, c.list, { label: a.title }]}
      actions={
        <>
          <a className="button-link" href={a.documentUrl} target="_blank" rel="noreferrer">Open document</a>
          {!external &&
            NEXT[a.status].map((n) => (
              <button key={n.status} className={n.status === 'active' ? 'primary' : 'secondary'} disabled={action.busy} onClick={() => setStatus(n.status, n.label, n.confirm)}>
                {n.label}
              </button>
            ))}
        </>
      }
    >
      {!external && a.status !== 'expired' && (
        <ol className="stepper compact">
          <li className={a.status === 'pending_approval' ? 'current' : 'done'}><span className="step-index">1</span>Awaiting approval</li>
          <li className={a.status === 'active' ? 'current' : undefined}><span className="step-index">2</span>Active</li>
          <li><span className="step-index">3</span>Expired</li>
        </ol>
      )}
      <ErrorText error={action.error} />
      {external && a.status === 'pending_approval' && rooms.data && (
        <ClientDecision agreementId={id} title={a.title} roomId={rooms.data.find((r) => r.agreementId === id && r.status === 'active')?.id ?? null} />
      )}
      <DetailList
        items={[
          ...(external ? [] : ([['Client', clientName(clients, a.clientId)]] as [string, string][])),
          ['Status', AGREEMENT_STATUS[a.status]],
          ['Created', formatDate(a.createdAt)],
          ['Last change', formatDate(a.updatedAt)],
        ]}
      />
      <h2 className="section-title">Client rooms for this agreement</h2>
      {!external && a.status !== 'expired' && (
        <div className="section-actions">
          <button className="secondary" onClick={() => openNew('client_room', { clientId: a.clientId, agreementId: id })}>+ Open client room</button>
        </div>
      )}
      {rooms.data && linked.length === 0 && <p className="muted">No client room is linked to this agreement.</p>}
      {linked.length > 0 && (
        <ul className="link-list">
          {linked.map((r) => (
            <li key={r.id}>
              <a href={`#${roomBase}/${r.id}`}>{r.roomName}</a> <StatusBadge status={r.status} label={ROOM_STATUS[r.status]} />
            </li>
          ))}
        </ul>
      )}
    </ViewFrame>
  );
}
