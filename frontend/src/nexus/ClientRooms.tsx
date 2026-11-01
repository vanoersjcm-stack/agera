import { api, type EngagementStatus, type RoomEngagement, type RoomStatus } from '../api';
import { clientName, useClients } from '../directory';
import { ACTIVITY_TYPE, AGREEMENT_STATUS, ENGAGEMENT_STATUS, formatDate, formatDateTime, ROOM_STATUS } from '../labels';
import { EmptyState, ViewFrame } from '../Layout';
import { navigate, type Route, withParams } from '../router';
import { useShell } from '../shell';
import { RoomActivityPanel, useRecordOpened } from './RoomActivity';
import { DetailList, ErrorText, FilterChips, includesText, Loading, SearchInput, StatusBadge, Tabs, useAction, useLoad } from '../ui';

function crumbs(external: boolean) {
  return external
    ? { suite: { label: 'Client portal', href: '#/portal' }, list: { label: 'My client rooms', href: '#/portal/rooms' } }
    : { suite: { label: 'Nexus', href: '#/nexus' }, list: { label: 'Client rooms', href: '#/nexus/client-rooms' } };
}

export function EngagementSummary({ status }: { status: EngagementStatus }) {
  const { summary } = status;
  return (
    <div className="kpis">
      <div><strong>{summary.stakeholders}</strong> client contacts active (last {status.windowDays} days)</div>
      <div className="good"><strong>{summary.accepted}</strong> accepted terms</div>
      <div><strong>{summary.pending}</strong> still deciding</div>
      <div className="bad"><strong>{summary.rejected}</strong> rejected terms</div>
    </div>
  );
}

function EngagementTable({ room }: { room: RoomEngagement }) {
  return (
    <table className="grid">
      <thead>
        <tr>
          <th>Client contact</th>
          <th>Status</th>
          <th className="num">Actions</th>
          <th>Last action</th>
        </tr>
      </thead>
      <tbody>
        {room.stakeholders.map((s) => (
          <tr key={s.email}>
            <td>{s.email}</td>
            <td><StatusBadge status={s.status} label={ENGAGEMENT_STATUS[s.status] ?? s.status} /></td>
            <td className="num">{s.activityCount}</td>
            <td>{ACTIVITY_TYPE[s.lastActivityType] ?? s.lastActivityType} · {formatDateTime(s.lastActivityAt)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function ClientRoomsView({ route, external }: { route: Route; external: boolean }) {
  const { openNew } = useShell();
  const clients = useClients(!external);
  const status = route.params.get('status') ?? (external ? 'all' : 'active');
  const q = route.params.get('q') ?? '';
  const rooms = useLoad(() => api.rooms());
  const engagement = useLoad(() => api.engagement());
  const c = crumbs(external);
  const base = external ? '/portal/rooms' : '/nexus/client-rooms';
  const items = rooms.data ?? [];
  const lastActivity = (id: string) => engagement.data?.dsrs.find((d) => d.dsrId === id);
  const count = (s: RoomStatus) => items.filter((r) => r.status === s).length;
  const filtered = items.filter((r) => (status === 'all' || r.status === status) && includesText([r.roomName, external ? '' : clientName(clients, r.clientId)], q));
  return (
    <ViewFrame
      title={external ? 'My client rooms' : 'Client rooms'}
      crumbs={[c.suite, { label: c.list.label }]}
      actions={!external && <button className="primary" onClick={() => openNew('client_room')}>+ New client room</button>}
    >
      {!external && engagement.data && <EngagementSummary status={engagement.data} />}
      <div className="list-toolbar">
        {!external && (
          <FilterChips
            value={status}
            onChange={(v) => navigate(withParams(route, { status: v === 'active' ? null : v }))}
            chips={[
              { value: 'active', label: 'Active', count: count('active') },
              { value: 'archived', label: 'Archived', count: count('archived') },
              { value: 'all', label: 'All', count: items.length },
            ]}
          />
        )}
        <SearchInput value={q} onChange={(v) => navigate(withParams(route, { q: v }))} placeholder={external ? 'Filter by room name' : 'Filter by room or client'} />
      </div>
      {!rooms.data && <Loading error={rooms.error} />}
      {rooms.data && filtered.length === 0 && (
        <EmptyState
          title={items.length === 0 ? (external ? 'No client rooms shared with you yet' : 'No client rooms yet') : 'No client rooms match this filter'}
          action={!external && <button className="primary" onClick={() => openNew('client_room')}>+ New client room</button>}
        >
          {items.length === 0 && (external ? 'As soon as Agera opens a room for your organisation, it appears here.' : 'A client room is an online space for one client deal; Nexus tracks what client contacts do in it.')}
        </EmptyState>
      )}
      {filtered.length > 0 && (
        <table className="grid clickable">
          <thead>
            <tr>
              <th>Room</th>
              {!external && <th>Client</th>}
              <th>Status</th>
              <th>Opened</th>
              <th>Last client activity</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => {
              const e = lastActivity(r.id);
              return (
                <tr key={r.id} onClick={() => navigate(`${base}/${r.id}`)}>
                  <td><a href={`#${base}/${r.id}`}>{r.roomName}</a></td>
                  {!external && <td>{clientName(clients, r.clientId)}</td>}
                  <td><StatusBadge status={r.status} label={ROOM_STATUS[r.status]} /></td>
                  <td>{formatDate(r.createdAt)}</td>
                  <td>{e ? formatDateTime(e.lastActivityAt) : <span className="muted">None yet</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </ViewFrame>
  );
}

export function ClientRoomDossier({ id, route, external }: { id: string; route: Route; external: boolean }) {
  const { notify } = useShell();
  const clients = useClients(!external);
  const tab = route.params.get('tab') ?? 'details';
  const room = useLoad(() => api.room(id), [id]);
  const engagement = useLoad(() => api.engagement(id), [id]);
  const agreement = useLoad(() => (room.data?.agreementId ? api.agreement(room.data.agreementId) : Promise.resolve(null)), [room.data?.agreementId]);
  const action = useAction();
  useRecordOpened(id, external);
  const c = crumbs(external);
  const r = room.data;
  if (!r) {
    return (
      <ViewFrame title="Client room" crumbs={[c.suite, c.list, { label: 'Loading…' }]}>
        <Loading error={room.error} />
      </ViewFrame>
    );
  }
  const stats = engagement.data?.dsrs.find((d) => d.dsrId === id);
  const agreementBase = external ? '/portal/agreements' : '/nexus/agreements';
  const toggle = () => {
    const next: RoomStatus = r.status === 'active' ? 'archived' : 'active';
    if (next === 'archived' && !window.confirm('Archive this client room? Client contacts can no longer open it.')) return;
    void action.run(() => api.setRoomStatus(id, next)).then((x) => x && (notify(next === 'archived' ? 'Client room archived' : 'Client room reactivated'), room.reload()));
  };
  return (
    <ViewFrame
      title={r.roomName}
      subtitle={<StatusBadge status={r.status} label={ROOM_STATUS[r.status]} />}
      crumbs={[c.suite, c.list, { label: r.roomName }]}
      actions={
        !external && (
          <button className={r.status === 'active' ? 'secondary' : 'primary'} disabled={action.busy} onClick={toggle}>
            {r.status === 'active' ? 'Archive room' : 'Reactivate room'}
          </button>
        )
      }
    >
      <ErrorText error={action.error} />
      <Tabs
        tabs={[
          { id: 'details', label: 'Details' },
          { id: 'engagement', label: `Engagement${stats ? ` (${stats.stakeholderCount})` : ''}` },
          { id: 'activity', label: 'Comments & activity' },
        ]}
        active={tab}
        onChange={(t) => navigate(withParams(route, { tab: t === 'details' ? null : t }))}
      />
      {tab === 'details' && (
        <DetailList
          items={[
            ...(external ? [] : ([['Client', clientName(clients, r.clientId)]] as [string, string][])),
            [
              'Agreement',
              agreement.data ? (
                <span>
                  <a href={`#${agreementBase}/${agreement.data.id}`}>{agreement.data.title}</a> · {AGREEMENT_STATUS[agreement.data.status]}
                </span>
              ) : (
                'None linked'
              ),
            ],
            ['Opened', formatDate(r.createdAt)],
            ['Last client activity', stats ? formatDateTime(stats.lastActivityAt) : 'None yet'],
          ]}
        />
      )}
      {tab === 'activity' && <RoomActivityPanel roomId={id} canComment={r.status === 'active'} />}
      {tab === 'engagement' && (
        <>
          {!engagement.data && <Loading error={engagement.error} />}
          {engagement.data && !stats && (
            <EmptyState title={`No client activity in the last ${engagement.data.windowDays} days`}>
              Opening the room, viewing sections, watching briefings, downloads, comments and accepting or rejecting terms appear here.
            </EmptyState>
          )}
          {stats && (
            <>
              <div className="kpis">
                {Object.entries(stats.activityCounts).map(([type, n]) => (
                  <div key={type}><strong>{n}</strong> {ACTIVITY_TYPE[type] ?? type}</div>
                ))}
              </div>
              <EngagementTable room={stats} />
            </>
          )}
        </>
      )}
    </ViewFrame>
  );
}
