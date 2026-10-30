import { api, type ApiKey } from '../api';
import { useUsers, userName } from '../directory';
import { auditActionLabel, formatDate, formatDateTime } from '../labels';
import { EmptyState, ViewFrame } from '../Layout';
import { navigate, type Route, withParams } from '../router';
import { useShell } from '../shell';
import { DetailList, ErrorText, Loading, useAction, useLoad } from '../ui';

const SUITE_CRUMB = { label: 'Symphony', href: '#/symphony' };

function Tile({ href, value, label, tone }: { href: string; value: string; label: string; tone?: string }) {
  return (
    <a className={`tile ${tone ?? ''}`} href={href}>
      <strong>{value}</strong>
      <span>{label}</span>
    </a>
  );
}

export function SymphonyOverview() {
  const workOrders = useLoad(() => api.workOrders());
  const visits = useLoad(() => api.visits());
  const agreements = useLoad(() => api.agreements());
  const alerts = useLoad(() => api.alerts());
  const activity = useLoad(() => api.auditLogs(1, 8));
  const users = useUsers();
  const n = (v: number | undefined) => (v === undefined ? '—' : String(v));
  const alertCount = alerts.data?.anomalies.length;
  return (
    <ViewFrame title="Overview" crumbs={[{ label: 'Symphony' }]} subtitle="Key figures across Nexus and RetailPower">
      <div className="tiles">
        <Tile href="#/nexus/alerts" value={n(alertCount)} label="Open alerts" tone={alertCount ? 'bad' : undefined} />
        <Tile href="#/nexus/agreements?status=pending_approval" value={n(agreements.data?.filter((a) => a.status === 'pending_approval').length)} label="Agreements awaiting approval" />
        <Tile href="#/retailpower/work-orders" value={n(workOrders.data?.items.filter((w) => w.status === 'PENDING' || w.status === 'IN_PROGRESS').length)} label="Open work orders" />
        <Tile href="#/retailpower/store-visits" value={n(visits.data?.items.filter((v) => v.status === 'PLANNED' || v.status === 'IN_PROGRESS').length)} label="Planned and ongoing store visits" />
      </div>
      <div className="section-head">
        <h2 className="section-title">Recent activity</h2>
        <a href="#/symphony/activity">View full activity log</a>
      </div>
      {!activity.data && <Loading error={activity.error} />}
      {activity.data && (
        <ol className="timeline">
          {activity.data.items.map((a) => (
            <li key={a.id}>
              <time>{formatDateTime(a.createdAt)}</time>
              <span>{auditActionLabel(a.action)}</span>
              <span className="muted">{userName(users, a.userId, 'System')}</span>
            </li>
          ))}
        </ol>
      )}
    </ViewFrame>
  );
}

const PAGE_SIZE = 50;

export function ActivityLogView({ route }: { route: Route }) {
  const users = useUsers();
  const page = Math.max(1, Number(route.params.get('page') ?? '1') || 1);
  const { data, error } = useLoad(() => api.auditLogs(page, PAGE_SIZE), [page]);
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;
  return (
    <ViewFrame title="Activity log" crumbs={[SUITE_CRUMB, { label: 'Activity log' }]} subtitle="Every change in this organisation, newest first">
      {!data && <Loading error={error} />}
      {data?.items.length === 0 && <EmptyState title="No activity recorded yet" />}
      {data && data.items.length > 0 && (
        <>
          <table className="grid">
            <thead>
              <tr>
                <th>When</th>
                <th>Who</th>
                <th>What</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((a) => (
                <tr key={a.id}>
                  <td>{formatDateTime(a.createdAt)}</td>
                  <td>{userName(users, a.userId, 'System')}</td>
                  <td>{auditActionLabel(a.action)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="pager">
            <button className="secondary" disabled={page <= 1} onClick={() => navigate(withParams(route, { page: page > 2 ? String(page - 1) : null }))}>← Newer</button>
            <span>Page {page} of {pages}</span>
            <button className="secondary" disabled={page >= pages} onClick={() => navigate(withParams(route, { page: String(page + 1) }))}>Older →</button>
          </div>
        </>
      )}
    </ViewFrame>
  );
}

export function OrganisationsView({ route }: { route: Route }) {
  const { openNew } = useShell();
  const { data, error } = useLoad(() => api.tenant());
  const created = route.params.get('created');
  return (
    <ViewFrame title="Organisations" crumbs={[SUITE_CRUMB, { label: 'Organisations' }]} actions={<button className="primary" onClick={() => openNew('organisation')}>+ New organisation</button>}>
      {created && <p className="callout good">Organisation “{created}” was created. Its users get access when they sign in with an e-mail address at its domain.</p>}
      <h2 className="section-title">Your organisation</h2>
      {!data && <Loading error={error} />}
      {data && <DetailList items={[['Name', data.name], ['E-mail domain', data.domain], ['Created', formatDate(data.createdAt)]]} />}
    </ViewFrame>
  );
}

function KeyRow({ apiKey, onRevoked }: { apiKey: ApiKey; onRevoked: () => void }) {
  const { notify } = useShell();
  const { busy, error, run } = useAction();
  const expired = apiKey.expiresAt !== null && new Date(apiKey.expiresAt) < new Date();
  const revoke = () =>
    window.confirm(`Revoke “${apiKey.name}”? Systems using this key lose access immediately.`) &&
    void run(() => api.revokeApiKey(apiKey.id)).then((r) => r !== undefined && (notify(`Integration key “${apiKey.name}” revoked`), onRevoked()));
  return (
    <tr>
      <td>{apiKey.name}</td>
      <td><code>{apiKey.keyPrefix}…</code></td>
      <td>{formatDate(apiKey.createdAt)}</td>
      <td>{apiKey.expiresAt ? <span className={expired ? 'bad' : undefined}>{formatDate(apiKey.expiresAt)}{expired ? ' (expired)' : ''}</span> : 'No expiry'}</td>
      <td>
        <button className="secondary danger small" disabled={busy} onClick={revoke}>Revoke</button>
        {error && <span className="error">{error}</span>}
      </td>
    </tr>
  );
}

export function IntegrationsView({ route }: { route: Route }) {
  const { openNew } = useShell();
  const created = route.params.get('created');
  const { data, error, reload } = useLoad(() => api.apiKeys(), [created]);
  return (
    <ViewFrame
      title="Integrations"
      crumbs={[SUITE_CRUMB, { label: 'Integrations' }]}
      subtitle="Integration keys let external portals read work orders, store visits and reports of this organisation"
      actions={<button className="primary" onClick={() => openNew('integration_key')}>+ New integration key</button>}
    >
      {!data && <Loading error={error} />}
      {data?.items.length === 0 && (
        <EmptyState title="No integration keys yet" action={<button className="primary" onClick={() => openNew('integration_key')}>+ New integration key</button>}>
          Create a key for each external portal or system that needs read access.
        </EmptyState>
      )}
      {data && data.items.length > 0 && (
        <table className="grid">
          <thead>
            <tr>
              <th>Name</th>
              <th>Key starts with</th>
              <th>Created</th>
              <th>Expires</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.items.map((k) => (
              <KeyRow key={k.id} apiKey={k} onRevoked={reload} />
            ))}
          </tbody>
        </table>
      )}
      <ErrorText error={null} />
    </ViewFrame>
  );
}
