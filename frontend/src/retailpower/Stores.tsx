import { useState } from 'react';
import { api, type Alert } from '../api';
import { EditStoreDrawer } from '../EditForms';
import { useUsers, userName } from '../directory';
import { formatDate, STORE_STATUS, VISIT_STATUS } from '../labels';
import { EmptyState, ViewFrame } from '../Layout';
import { navigate, type Route, withParams } from '../router';
import { useShell } from '../shell';
import { DetailList, FilterChips, includesText, Loading, SearchInput, StatusBadge, useLoad } from '../ui';

const SUITE_CRUMB = { label: 'RetailPower', href: '#/retailpower' };
const LIST_CRUMB = { label: 'Stores', href: '#/retailpower/stores' };

/** Store compliance comes from the store-compliance alerts (latest visit report not compliant). */
export function nonCompliantStores(alerts: Alert[] | undefined): Map<string, Alert> {
  return new Map((alerts ?? []).filter((a) => a.anomalyType === 'store_compliance').map((a) => [a.sourceId, a]));
}

export function StoresView({ route }: { route: Route }) {
  const { openNew } = useShell();
  const compliance = route.params.get('compliance') ?? 'all';
  const q = route.params.get('q') ?? '';
  const stores = useLoad(() => api.stores());
  const alerts = useLoad(() => api.alerts());
  const flagged = nonCompliantStores(alerts.data?.anomalies);
  const items = stores.data?.items ?? [];
  const filtered = items.filter(
    (s) =>
      (compliance === 'all' || (compliance === 'not_compliant') === flagged.has(s.id)) &&
      includesText([s.name, s.storeCode, s.city, s.address], q),
  );
  return (
    <ViewFrame title="Stores" crumbs={[SUITE_CRUMB, { label: 'Stores' }]} actions={<button className="primary" onClick={() => openNew('store')}>+ New store</button>}>
      <div className="list-toolbar">
        <FilterChips
          value={compliance}
          onChange={(v) => navigate(withParams(route, { compliance: v === 'all' ? null : v }))}
          chips={[
            { value: 'all', label: 'All stores', count: items.length },
            { value: 'not_compliant', label: 'Not compliant', count: items.filter((s) => flagged.has(s.id)).length },
            { value: 'ok', label: 'No open issues', count: items.filter((s) => !flagged.has(s.id)).length },
          ]}
        />
        <SearchInput value={q} onChange={(v) => navigate(withParams(route, { q: v }))} placeholder="Filter by name, code or city" />
      </div>
      {!stores.data && <Loading error={stores.error} />}
      {stores.data && filtered.length === 0 && (
        <EmptyState title={items.length === 0 ? 'No stores yet' : 'No stores match this filter'} action={<button className="primary" onClick={() => openNew('store')}>+ New store</button>}>
          {items.length === 0 ? 'Add the stores your field team visits.' : 'Try another filter.'}
        </EmptyState>
      )}
      {filtered.length > 0 && (
        <table className="grid clickable">
          <thead>
            <tr>
              <th>Store</th>
              <th>Code</th>
              <th>City</th>
              <th>Compliance</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((s) => (
              <tr key={s.id} onClick={() => navigate(`/retailpower/stores/${s.id}`)}>
                <td><a href={`#/retailpower/stores/${s.id}`}>{s.name}</a></td>
                <td>{s.storeCode}</td>
                <td>{s.city ?? '—'}</td>
                <td>{flagged.has(s.id) ? <StatusBadge status="not_compliant" label="Not compliant" /> : <span className="muted">No open issues</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </ViewFrame>
  );
}

export function StoreDossier({ id }: { id: string }) {
  const { openNew, notify } = useShell();
  const [editing, setEditing] = useState(false);
  const users = useUsers();
  const stores = useLoad(() => api.stores(), [id]);
  const visits = useLoad(() => api.visits(id), [id]);
  const alerts = useLoad(() => api.alerts(), [id]);
  const store = stores.data?.items.find((s) => s.id === id);
  if (!stores.data || !store) {
    return (
      <ViewFrame title="Store" crumbs={[SUITE_CRUMB, LIST_CRUMB, { label: stores.data ? 'Not found' : 'Loading…' }]}>
        {stores.data ? <p className="error">This store does not exist.</p> : <Loading error={stores.error} />}
      </ViewFrame>
    );
  }
  const issue = nonCompliantStores(alerts.data?.anomalies).get(id);
  return (
    <ViewFrame
      title={store.name}
      subtitle={
        <>
          {store.status === 'closed' && <StatusBadge status="closed" label={STORE_STATUS.closed} />}
          {issue && <StatusBadge status="not_compliant" label="Not compliant" />}
        </>
      }
      crumbs={[SUITE_CRUMB, LIST_CRUMB, { label: store.name }]}
      actions={
        <>
          <button className="secondary" onClick={() => setEditing(true)}>Edit</button>
          {store.status === 'active' && <button className="primary" onClick={() => openNew('store_visit', { storeId: id })}>+ Plan store visit</button>}
        </>
      }
    >
      {issue && <p className="callout bad">Latest visit report: {issue.description}</p>}
      <DetailList
        items={[
          ['Store code', store.storeCode],
          ['Status', STORE_STATUS[store.status] ?? store.status],
          ['Address', [store.address, [store.postalCode, store.city].filter(Boolean).join(' '), store.country].filter(Boolean).join(', ') || '—'],
          ['Added', formatDate(store.createdAt)],
        ]}
      />
      <h2 className="section-title">Store visits</h2>
      {!visits.data && <Loading error={visits.error} />}
      {visits.data?.items.length === 0 && <p className="muted">No visits for this store yet.</p>}
      {visits.data && visits.data.items.length > 0 && (
        <table className="grid clickable">
          <thead>
            <tr>
              <th>Date</th>
              <th>Status</th>
              <th>Field representative</th>
            </tr>
          </thead>
          <tbody>
            {visits.data.items.map((v) => (
              <tr key={v.id} onClick={() => navigate(`/retailpower/store-visits/${v.id}`)}>
                <td><a href={`#/retailpower/store-visits/${v.id}`}>{formatDate(v.visitDate)}</a></td>
                <td><StatusBadge status={v.status} label={VISIT_STATUS[v.status]} /></td>
                <td>{userName(users, v.fieldRepId)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {editing && (
        <EditStoreDrawer
          record={store}
          onClose={() => setEditing(false)}
          onSaved={() => (setEditing(false), notify('Store updated'), stores.reload())}
        />
      )}
    </ViewFrame>
  );
}
