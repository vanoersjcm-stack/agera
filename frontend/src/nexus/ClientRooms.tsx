import { matchesClient, useClientFilter } from '../clientFilter';
import { PortalSurveyCards } from './Surveys';
import { type FormEvent, useState } from 'react';
import { api, type EngagementStatus, type Milestone, type MilestoneOwnerSide, type RoomEngagement, type RoomStatus } from '../api';
import { clientName, useClients } from '../directory';
import { ACTIVITY_TYPE, AGREEMENT_STATUS, ENGAGEMENT_STATUS, formatDate, formatDateTime, ROOM_STATUS } from '../labels';
import { EmptyState, ViewFrame } from '../Layout';
import { navigate, type Route, withParams } from '../router';
import { useShell } from '../shell';
import { RoomActivityPanel, useRecordOpened } from './RoomActivity';
import { RoomDocumentsPanel } from './Documents';
import { DetailList, ErrorText, FilterChips, includesText, Loading, SearchInput, StatusBadge, Tabs, useAction, useLoad } from '../ui';
import { t as tr, tf } from '../i18n';

function crumbs(external: boolean) {
  return external
    ? { suite: { label: tr("Client portal"), href: '#/portal' }, list: { label: tr("My client rooms"), href: '#/portal/rooms' } }
    : { suite: { label: tr("Nexus"), href: '#/nexus' }, list: { label: tr("Client rooms"), href: '#/nexus/client-rooms' } };
}

export function EngagementSummary({ status }: { status: EngagementStatus }) {
  const { summary } = status;
  return (
    <div className="kpis">
      <div><strong>{summary.stakeholders}</strong>  {tr("client contacts active (last")} {status.windowDays}  {tr("days)")}</div>
      <div className="good"><strong>{summary.accepted}</strong>  {tr("accepted terms")}</div>
      <div><strong>{summary.pending}</strong>  {tr("still deciding")}</div>
      <div className="bad"><strong>{summary.rejected}</strong>  {tr("rejected terms")}</div>
    </div>
  );
}

function EngagementTable({ room }: { room: RoomEngagement }) {
  return (
    <table className="grid">
      <thead>
        <tr>
          <th>{tr("Client contact")}</th>
          <th>{tr("Status")}</th>
          <th className="num">{tr("Actions")}</th>
          <th>{tr("Last action")}</th>
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
  const clientFilter = useClientFilter();
  const filtered = items.filter((x) => matchesClient(clientFilter, x.clientId)).filter((r) => (status === 'all' || r.status === status) && includesText([r.roomName, external ? '' : clientName(clients, r.clientId)], q));
  return (
    <ViewFrame
      title={external ? tr("My client rooms") : tr("Client rooms")}
      crumbs={[c.suite, { label: c.list.label }]}
      actions={!external && <button className="primary" onClick={() => openNew('client_room')}>{tr("+ New client room")}</button>}
    >
      {!external && engagement.data && <EngagementSummary status={engagement.data} />}
      <div className="list-toolbar">
        {!external && (
          <FilterChips
            value={status}
            onChange={(v) => navigate(withParams(route, { status: v === 'active' ? null : v }))}
            chips={[
              { value: 'active', label: tr("Active"), count: count('active') },
              { value: 'archived', label: tr("Archived"), count: count('archived') },
              { value: 'all', label: tr("All"), count: items.length },
            ]}
          />
        )}
        <SearchInput value={q} onChange={(v) => navigate(withParams(route, { q: v }))} placeholder={external ? tr("Filter by room name") : tr("Filter by room or client")} />
      </div>
      {!rooms.data && <Loading error={rooms.error} />}
      {rooms.data && filtered.length === 0 && (
        <EmptyState
          title={items.length === 0 ? (external ? tr("No client rooms shared with you yet") : tr("No client rooms yet")) : tr("No client rooms match this filter")}
          action={!external && <button className="primary" onClick={() => openNew('client_room')}>{tr("+ New client room")}</button>}
        >
          {items.length === 0 && (external ? tr("As soon as Agera opens a room for your organisation, it appears here.") : tr("A client room is an online space for one client deal; Nexus tracks what client contacts do in it."))}
        </EmptyState>
      )}
      {filtered.length > 0 && (
        <table className="grid clickable">
          <thead>
            <tr>
              <th>{tr("Room")}</th>
              {!external && <th>{tr("Client")}</th>}
              <th>{tr("Status")}</th>
              <th>{tr("Opened")}</th>
              <th>{tr("Last client activity")}</th>
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
                  <td>{e ? formatDateTime(e.lastActivityAt) : <span className="muted">{tr("None yet")}</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </ViewFrame>
  );
}

/** Mutual action plan: steps for the Agera team and the client; client contacts tick off their own steps. */
function ActionPlanPanel({ roomId, external, active }: { roomId: string; external: boolean; active: boolean }) {
  const { notify } = useShell();
  const { data, error, reload } = useLoad(() => api.milestones(roomId), [roomId]);
  const [form, setForm] = useState({ title: '', ownerSide: 'internal' as MilestoneOwnerSide, dueDate: '' });
  const action = useAction();
  const steps = data ?? [];
  const done = steps.filter((m) => m.completed).length;
  const canTick = (m: Milestone) => active && (!external || m.ownerSide === 'client');
  const toggle = (m: Milestone) =>
    void action.run(() => api.updateMilestone(roomId, m.id, { completed: !m.completed })).then((r) => r && (notify(r.completed ? tr("Step completed") : tr("Step reopened")), reload()));
  const add = (e: FormEvent) => {
    e.preventDefault();
    void action
      .run(() => api.addMilestone(roomId, { title: form.title.trim(), ownerSide: form.ownerSide, dueDate: form.dueDate || null }))
      .then((r) => r && (setForm({ title: '', ownerSide: form.ownerSide, dueDate: '' }), notify(tr("Step added")), reload()));
  };
  const remove = (m: Milestone) => {
    if (!window.confirm(tf("Remove the step “{title}”?", { title: m.title }))) return;
    void action.run(() => api.deleteMilestone(roomId, m.id)).then((r) => r !== undefined && reload());
  };
  return (
    <div className="card-panel">
      <h2>{tr("Action plan")}</h2>
      <p className="muted">
        {external ? tr("The steps agreed with Agera. Tick off the steps marked “Your team” when they are done.") : tr("Steps agreed with the client. The client sees this plan in their portal and ticks off their own steps.")}
      </p>
      {!data && <Loading error={error} />}
      {data && steps.length === 0 && <p className="muted">{tr("No steps yet.")}</p>}
      {steps.length > 0 && (
        <>
          <div className="plan-progress" role="progressbar" aria-valuenow={done} aria-valuemax={steps.length} aria-label={`${done} of ${steps.length} steps done`}>
            <div style={{ width: `${(done / steps.length) * 100}%` }} />
          </div>
          <ul className="plan-list">
            {steps.map((m) => (
              <li key={m.id} className={`plan-item${m.completed ? ' done' : ''}`}>
                <input type="checkbox" checked={m.completed} disabled={!canTick(m) || action.busy} onChange={() => toggle(m)} aria-label={`Done: ${m.title}`} />
                <span className="plan-title">
                  {m.title}
                  <div className="muted small">
                    {m.dueDate ? tf("Due {date}", { date: formatDate(m.dueDate) }) : tr("No due date")}
                    {m.completed && m.completedAt ? ` · ${m.completedByName ? tf("done {when} by {name}", { when: formatDateTime(m.completedAt), name: m.completedByName }) : tf("done {when}", { when: formatDateTime(m.completedAt) })}` : ''}
                  </div>
                </span>
                <span className={`plan-side ${m.ownerSide}`}>{m.ownerSide === 'client' ? (external ? tr("Your team") : tr("Client")) : tr("Agera team")}</span>
                {!external && <button className="link-button danger" disabled={action.busy} onClick={() => remove(m)}>{tr("Remove")}</button>}
              </li>
            ))}
          </ul>
        </>
      )}
      <ErrorText error={action.error} />
      {!external && active && (
        <form className="inline-form" onSubmit={add}>
          <input required maxLength={200} placeholder={tr("New step, e.g. Legal review of the agreement")} aria-label={tr("New step")} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <select aria-label={tr("Who does this step")} value={form.ownerSide} onChange={(e) => setForm({ ...form, ownerSide: e.target.value as MilestoneOwnerSide })}>
            <option value="internal">{tr("Agera team")}</option>
            <option value="client">{tr("Client")}</option>
          </select>
          <input type="date" aria-label={tr("Due date")} value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} />
          <button className="primary" disabled={action.busy}>{tr("Add step")}</button>
        </form>
      )}
    </div>
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
      <ViewFrame title={tr("Client room")} crumbs={[c.suite, c.list, { label: tr("Loading…") }]}>
        <Loading error={room.error} />
      </ViewFrame>
    );
  }
  const stats = engagement.data?.dsrs.find((d) => d.dsrId === id);
  const agreementBase = external ? '/portal/agreements' : '/nexus/agreements';
  const toggle = () => {
    const next: RoomStatus = r.status === 'active' ? 'archived' : 'active';
    if (next === 'archived' && !window.confirm(tr("Archive this client room? Client contacts can no longer open it."))) return;
    void action.run(() => api.setRoomStatus(id, next)).then((x) => x && (notify(next === 'archived' ? tr("Client room archived") : tr("Client room reactivated")), room.reload()));
  };
  return (
    <ViewFrame
      title={r.roomName}
      subtitle={<>
        <StatusBadge status={r.status} label={ROOM_STATUS[r.status]} /> {!external && <span className="external-pill">{tr("External buyer facing")}</span>}
      </>}
      crumbs={[c.suite, c.list, { label: r.roomName }]}
      actions={
        !external && (
          <button className={r.status === 'active' ? 'secondary' : 'primary'} disabled={action.busy} onClick={toggle}>
            {r.status === 'active' ? tr("Archive room") : tr("Reactivate room")}
          </button>
        )
      }
    >
      <ErrorText error={action.error} />
      {external && <PortalSurveyCards roomId={r.id} />}
      <Tabs
        tabs={[
          { id: 'details', label: tr("Details") },
          { id: 'documents', label: tr("Documents") },
          { id: 'plan', label: tr("Action plan") },
          { id: 'engagement', label: `${tr("Engagement")}${stats ? ` (${stats.stakeholderCount})` : ''}` },
          { id: 'activity', label: tr("Comments & activity") },
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
      {tab === 'details' && (
        <div className="room-grid">
          <div className="room-col">
            <h3>{tr("Document vault")}</h3>
            {agreement.data && (
              <ul>
                <li>
                  <a href={agreement.data.documentUrl} target="_blank" rel="noreferrer">{agreement.data.title}</a>
                  <div className="muted small">{tr("Agreement document ·")} {AGREEMENT_STATUS[agreement.data.status]}</div>
                </li>
              </ul>
            )}
            <RoomDocumentsPanel roomId={id} external={external} active={r.status === 'active'} compact />
            <button className="link-button" onClick={() => navigate(withParams(route, { tab: 'documents' }))}>{external ? tr("All documents") : tr("Manage documents")}</button>
          </div>
          <div className="room-col">
            <h3>{tr("Mutual action plan")}</h3>
            <ActionPlanPanel roomId={id} external={external} active={r.status === 'active'} />
          </div>
          <div className="room-col signoff-card">
            <h3>{tr("Contract sign-off")}</h3>
            {agreement.data ? (
              <>
                <p><strong>{agreement.data.title}</strong></p>
                <p className="muted">{AGREEMENT_STATUS[agreement.data.status]}</p>
                <button className="primary" onClick={() => navigate(`${agreementBase}/${agreement.data!.id}`)}>
                  {external ? (agreement.data.status === 'pending_approval' ? tr("Review and sign") : tr("View agreement")) : tr("Open agreement")}
                </button>
              </>
            ) : (
              <p className="muted">{tr("No agreement is linked to this room.")}</p>
            )}
          </div>
        </div>
      )}
      {tab === 'documents' && <RoomDocumentsPanel roomId={id} external={external} active={r.status === 'active'} />}
      {tab === 'plan' && <ActionPlanPanel roomId={id} external={external} active={r.status === 'active'} />}
      {tab === 'activity' && <RoomActivityPanel roomId={id} canComment={r.status === 'active'} />}
      {tab === 'engagement' && (
        <>
          {!engagement.data && <Loading error={engagement.error} />}
          {engagement.data && !stats && (
            <EmptyState title={tf("No client activity in the last {n} days", { n: engagement.data.windowDays })}>
              {tr("Opening the room, viewing sections, watching briefings, downloads, comments and accepting or rejecting terms appear here.")}</EmptyState>
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
