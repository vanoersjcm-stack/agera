import { useState } from 'react';
import { api, type WorkOrderStatus } from '../api';
import { useUsers, userName } from '../directory';
import { formatDate, formatDateTime, VISIT_STATUS, WORK_ORDER_STATUS } from '../labels';
import { EmptyState, ViewFrame } from '../Layout';
import { navigate, type Route, withParams } from '../router';
import { useShell } from '../shell';
import { DetailList, ErrorText, FilterChips, includesText, Loading, SearchInput, StatusBadge, Tabs, useAction, useLoad } from '../ui';

const SUITE_CRUMB = { label: 'RetailPower', href: '#/retailpower' };
const LIST_CRUMB = { label: 'Work orders', href: '#/retailpower/work-orders' };

/** Mirrors ALLOWED_TRANSITIONS in the backend; COMPLETED and CANCELLED are final. */
const NEXT: Record<WorkOrderStatus, { status: WorkOrderStatus; label: string }[]> = {
  PENDING: [
    { status: 'IN_PROGRESS', label: 'Start' },
    { status: 'COMPLETED', label: 'Complete' },
    { status: 'CANCELLED', label: 'Cancel work order' },
  ],
  IN_PROGRESS: [
    { status: 'COMPLETED', label: 'Complete' },
    { status: 'PENDING', label: 'Back to pending' },
    { status: 'CANCELLED', label: 'Cancel work order' },
  ],
  COMPLETED: [],
  CANCELLED: [],
};

export function WorkOrdersView({ route }: { route: Route }) {
  const { openNew } = useShell();
  const users = useUsers();
  const status = route.params.get('status') ?? 'open';
  const q = route.params.get('q') ?? '';
  const { data, error } = useLoad(() => api.workOrders());
  const items = data?.items ?? [];
  const count = (s: WorkOrderStatus) => items.filter((w) => w.status === s).length;
  const filtered = items.filter(
    (w) =>
      (status === 'all' || (status === 'open' ? w.status === 'PENDING' || w.status === 'IN_PROGRESS' : w.status === status)) &&
      includesText([w.title, w.description, userName(users, w.assignedUserId, '')], q),
  );
  return (
    <ViewFrame
      title="Work orders"
      crumbs={[SUITE_CRUMB, { label: 'Work orders' }]}
      actions={<button className="primary" onClick={() => openNew('work_order')}>+ New work order</button>}
    >
      <div className="list-toolbar">
        <FilterChips
          value={status}
          onChange={(v) => navigate(withParams(route, { status: v === 'open' ? null : v }))}
          chips={[
            { value: 'open', label: 'Open', count: count('PENDING') + count('IN_PROGRESS') },
            { value: 'PENDING', label: 'Pending', count: count('PENDING') },
            { value: 'IN_PROGRESS', label: 'In progress', count: count('IN_PROGRESS') },
            { value: 'COMPLETED', label: 'Completed', count: count('COMPLETED') },
            { value: 'CANCELLED', label: 'Cancelled', count: count('CANCELLED') },
            { value: 'all', label: 'All', count: items.length },
          ]}
        />
        <SearchInput value={q} onChange={(v) => navigate(withParams(route, { q: v }))} placeholder="Filter by title or assignee" />
      </div>
      {!data && <Loading error={error} />}
      {data && filtered.length === 0 && (
        <EmptyState
          title={items.length === 0 ? 'No work orders yet' : 'No work orders match this filter'}
          action={<button className="primary" onClick={() => openNew('work_order')}>+ New work order</button>}
        >
          {items.length === 0 ? 'Work orders are field tasks that you can assign to a colleague and link to store visits.' : 'Try another status or clear the filter.'}
        </EmptyState>
      )}
      {filtered.length > 0 && (
        <table className="grid clickable">
          <thead>
            <tr>
              <th>Title</th>
              <th>Status</th>
              <th>Assigned to</th>
              <th>Last change</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((w) => (
              <tr key={w.id} onClick={() => navigate(`/retailpower/work-orders/${w.id}`)}>
                <td><a href={`#/retailpower/work-orders/${w.id}`}>{w.title}</a></td>
                <td><StatusBadge status={w.status} label={WORK_ORDER_STATUS[w.status]} /></td>
                <td>{userName(users, w.assignedUserId, 'Not assigned')}</td>
                <td>{formatDateTime(w.updatedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </ViewFrame>
  );
}

export function WorkOrderDossier({ id }: { id: string }) {
  const { openNew, notify } = useShell();
  const users = useUsers();
  const [tab, setTab] = useState('details');
  const order = useLoad(() => api.workOrder(id), [id]);
  const logs = useLoad(() => api.workOrderLogs(id), [id]);
  const visits = useLoad(() => api.visits(), [id]);
  const stores = useLoad(() => api.stores(), []);
  const action = useAction();
  const w = order.data;
  if (!w) {
    return (
      <ViewFrame title="Work order" crumbs={[SUITE_CRUMB, LIST_CRUMB, { label: 'Loading…' }]}>
        <Loading error={order.error} />
      </ViewFrame>
    );
  }
  const final = NEXT[w.status].length === 0;
  const linked = (visits.data?.items ?? []).filter((v) => v.workOrderId === id);
  const storeName = (storeId: string) => stores.data?.items.find((s) => s.id === storeId)?.name ?? 'Store';
  const refresh = () => (order.reload(), logs.reload());
  const setStatus = (status: WorkOrderStatus, label: string) =>
    void action.run(() => api.setWorkOrderStatus(id, status)).then((r) => r && (notify(`Work order: ${label.toLowerCase()}`), refresh()));
  const assign = (userId: string) =>
    void action.run(() => api.assignWorkOrder(id, userId || null)).then((r) => r && (notify(userId ? `Assigned to ${userName(users, userId)}` : 'Unassigned'), refresh()));

  return (
    <ViewFrame
      title={w.title}
      subtitle={<StatusBadge status={w.status} label={WORK_ORDER_STATUS[w.status]} />}
      crumbs={[SUITE_CRUMB, LIST_CRUMB, { label: w.title }]}
      actions={
        <>
          <label className="inline-field">
            Assigned to
            <select value={w.assignedUserId ?? ''} disabled={final || action.busy} onChange={(e) => assign(e.target.value)}>
              <option value="">Not assigned</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          </label>
          {NEXT[w.status].map((n) => (
            <button key={n.status} className={n.status === 'CANCELLED' ? 'secondary danger' : n.status === 'PENDING' ? 'secondary' : 'primary'} disabled={action.busy} onClick={() => setStatus(n.status, n.label)}>
              {n.label}
            </button>
          ))}
        </>
      }
    >
      <ErrorText error={action.error} />
      <Tabs
        tabs={[
          { id: 'details', label: 'Details' },
          { id: 'history', label: `History (${logs.data?.length ?? '…'})` },
          { id: 'visits', label: `Store visits (${visits.data ? linked.length : '…'})` },
        ]}
        active={tab}
        onChange={setTab}
      />
      {tab === 'details' && (
        <DetailList
          items={[
            ['Description', w.description || <span className="muted">No description</span>],
            ['Assigned to', userName(users, w.assignedUserId, 'Not assigned')],
            ['Created', formatDateTime(w.createdAt)],
            ['Last change', formatDateTime(w.updatedAt)],
            ['Completed', w.completedAt ? formatDateTime(w.completedAt) : '—'],
          ]}
        />
      )}
      {tab === 'history' && (
        <>
          {!logs.data && <Loading error={logs.error} />}
          <ol className="timeline">
            {logs.data?.map((l) => (
              <li key={l.id}>
                <time>{formatDateTime(l.createdAt)}</time>
                <span>
                  {l.previousStatus ? `${WORK_ORDER_STATUS[l.previousStatus]} → ${WORK_ORDER_STATUS[l.newStatus]}` : `Created as ${WORK_ORDER_STATUS[l.newStatus]}`}
                </span>
                <span className="muted">by {userName(users, l.changedByUserId)}</span>
              </li>
            ))}
          </ol>
        </>
      )}
      {tab === 'visits' && (
        <>
          {!final && (
            <div className="section-actions">
              <button className="primary" onClick={() => openNew('store_visit', { workOrderId: id })}>+ Plan store visit</button>
            </div>
          )}
          {visits.data && linked.length === 0 && <p className="muted">No store visits linked to this work order yet.</p>}
          {linked.length > 0 && (
            <table className="grid clickable">
              <thead>
                <tr>
                  <th>Store</th>
                  <th>Date</th>
                  <th>Status</th>
                  <th>Field representative</th>
                </tr>
              </thead>
              <tbody>
                {linked.map((v) => (
                  <tr key={v.id} onClick={() => navigate(`/retailpower/store-visits/${v.id}`)}>
                    <td><a href={`#/retailpower/store-visits/${v.id}`}>{storeName(v.storeId)}</a></td>
                    <td>{formatDate(v.visitDate)}</td>
                    <td><StatusBadge status={v.status} label={VISIT_STATUS[v.status]} /></td>
                    <td>{userName(users, v.fieldRepId)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </ViewFrame>
  );
}
