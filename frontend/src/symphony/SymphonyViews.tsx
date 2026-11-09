import { useState } from 'react';
import { api, type ApiKey, type AuditChainCheck, type LicenseTier, type Tenant } from '../api';
import { useUsers, userName } from '../directory';
import { auditActionLabel, formatDate, formatDateTime } from '../labels';
import { EmptyState, ViewFrame } from '../Layout';
import { navigate, type Route, withParams } from '../router';
import { editionName } from '../suites';
import { useShell } from '../shell';
import { DetailList, ErrorText, Loading, useAction, useLoad } from '../ui';
import { locale, t as tr, tf } from '../i18n';

const SUITE_CRUMB = { label: tr("Symphony"), href: '#/symphony' };

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
    <ViewFrame title={tr("Overview")} crumbs={[{ label: tr("Symphony") }]} subtitle={tr("Key figures across Nexus and RetailPower")}>
      <div className="tiles">
        <Tile href="#/nexus/alerts" value={n(alertCount)} label={tr("Open alerts")} tone={alertCount ? 'bad' : undefined} />
        <Tile href="#/nexus/agreements?status=pending_approval" value={n(agreements.data?.filter((a) => a.status === 'pending_approval').length)} label={tr("Agreements awaiting approval")} />
        <Tile href="#/retailpower/work-orders" value={n(workOrders.data?.items.filter((w) => w.status === 'PENDING' || w.status === 'IN_PROGRESS').length)} label={tr("Open work orders")} />
        <Tile href="#/retailpower/store-visits" value={n(visits.data?.items.filter((v) => v.status === 'PLANNED' || v.status === 'IN_PROGRESS').length)} label={tr("Planned and ongoing store visits")} />
      </div>
      <div className="section-head">
        <h2 className="section-title">{tr("Recent activity")}</h2>
        <a href="#/symphony/activity">{tr("View full activity log")}</a>
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
  const [chain, setChain] = useState<AuditChainCheck | null>(null);
  const check = useAction();
  const verify = () => void check.run(() => api.verifyAuditChain()).then((r) => r && setChain(r));
  return (
    <ViewFrame
      title={tr("Activity log")}
      crumbs={[SUITE_CRUMB, { label: tr("Activity log") }]}
      subtitle={tr("Every change in this organisation, newest first. Entries can't be changed or deleted: each one is sealed with a SHA-256 fingerprint linked to the previous entry.")}
      actions={<button className="secondary" disabled={check.busy} onClick={verify}>{check.busy ? tr("Checking…") : tr("Check chain")}</button>}
    >
      <ErrorText error={check.error} />
      {chain && (chain.intact
        ? <p className="callout good">{tr("Chain intact: all")} {chain.checked.toLocaleString(locale())} {tr("entries match their fingerprints.")}</p>
        : <p className="callout bad">{tr("Chain broken at entry")} #{chain.firstBrokenSeq} {tr("of")} {chain.checked.toLocaleString(locale())}. {tr("An entry was changed outside Agera. Contact your platform administrator.")}</p>)}
      {!data && <Loading error={error} />}
      {data?.items.length === 0 && <EmptyState title={tr("No activity recorded yet")} />}
      {data && data.items.length > 0 && (
        <>
          <table className="grid">
            <thead>
              <tr>
                <th>{tr("When")}</th>
                <th>{tr("Who")}</th>
                <th>{tr("What")}</th>
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
            <button className="secondary" disabled={page <= 1} onClick={() => navigate(withParams(route, { page: page > 2 ? String(page - 1) : null }))}>{tr("← Newer")}</button>
            <span>{tr("Page")} {page}  {tr("of")} {pages}</span>
            <button className="secondary" disabled={page >= pages} onClick={() => navigate(withParams(route, { page: String(page + 1) }))}>{tr("Older →")}</button>
          </div>
        </>
      )}
    </ViewFrame>
  );
}

export function OrganisationsView({ route }: { route: Route }) {
  const { openNew } = useShell();
  const { data, error } = useLoad(() => api.tenant());
  const all = useLoad(() => api.tenants(), []);
  const created = route.params.get('created');
  return (
    <ViewFrame title={tr("Organisations")} crumbs={[SUITE_CRUMB, { label: tr("Organisations") }]} actions={<button className="primary" onClick={() => openNew('organisation')}>{tr("+ New organisation")}</button>}>
      {created && <p className="callout good">{tr("Organisation “")}{created}{tr("” was created. Its users get access when they sign in with an e-mail address at its domain.")}</p>}
      <h2 className="section-title">{tr("Your organisation")}</h2>
      {!data && <Loading error={error} />}
      {data && (
        <DetailList
          items={[
            ['Name', data.name],
            ['E-mail domain', data.domain],
            ['Edition', editionName(data.licenseTier)],
            ['Seats', data.maxSeats ? `${data.activeSeats ?? '?'} of ${data.maxSeats} in use` : `${data.activeSeats ?? '?'} in use (unlimited)`],
            ['Created', formatDate(data.createdAt)],
          ]}
        />
      )}
      <h2 className="section-title">{tr("Editions")}</h2>
      <p className="muted">{tr("Vanguard is the mid-market edition (up to 50 seats); Symphony is the Enterprise edition. Changing the edition re-brands the interface and applies its limits immediately, without moving any data.")}</p>
      {all.data && <EditionTable tenants={all.data} currentId={data?.id} onChanged={all.reload} />}
    </ViewFrame>
  );
}

function EditionTable({ tenants, currentId, onChanged }: { tenants: Tenant[]; currentId?: string; onChanged: () => void }) {
  const { notify } = useShell();
  const { busy, error, run } = useAction();
  const change = (t: Tenant, licenseTier: LicenseTier) => {
    if (!window.confirm(tf("Switch {name} to {edition}?", { name: t.name, edition: editionName(licenseTier) }))) return;
    void run(() => api.setLicense(t.id, { licenseTier })).then((r) => {
      if (!r) return;
      if (t.id === currentId) window.location.reload();
      else (notify(tf("{name} is now on {edition}", { name: t.name, edition: editionName(licenseTier) })), onChanged());
    });
  };
  return (
    <>
      <ErrorText error={error} />
      <table className="grid">
        <thead><tr><th>{tr("Organisation")}</th><th>{tr("Edition")}</th><th>{tr("Seat limit")}</th><th /></tr></thead>
        <tbody>
          {tenants.map((t) => (
            <tr key={t.id}>
              <td>{t.name}<div className="muted small">{t.domain}</div></td>
              <td>{t.licenseTier === 'vanguard' ? tr("Vanguard") : tr("Symphony (Enterprise)")}</td>
              <td>{t.maxSeats ?? tr("Unlimited")}</td>
              <td>
                <button className="secondary small" disabled={busy} onClick={() => change(t, t.licenseTier === 'vanguard' ? 'symphony' : 'vanguard')}>
                  {t.licenseTier === 'vanguard' ? tr("Upgrade to Symphony") : tr("Switch to Vanguard")}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function KeyRow({ apiKey, onRevoked }: { apiKey: ApiKey; onRevoked: () => void }) {
  const { notify } = useShell();
  const { busy, error, run } = useAction();
  const expired = apiKey.expiresAt !== null && new Date(apiKey.expiresAt) < new Date();
  const revoke = () =>
    window.confirm(tf("Revoke “{name}”? Systems using this key lose access immediately.", { name: apiKey.name })) &&
    void run(() => api.revokeApiKey(apiKey.id)).then((r) => r !== undefined && (notify(tf("Integration key “{name}” revoked", { name: apiKey.name })), onRevoked()));
  return (
    <tr>
      <td>{apiKey.name}</td>
      <td><code>{apiKey.keyPrefix}…</code></td>
      <td>{formatDate(apiKey.createdAt)}</td>
      <td>{apiKey.expiresAt ? <span className={expired ? 'bad' : undefined}>{formatDate(apiKey.expiresAt)}{expired ? tr(" (expired)") : ''}</span> : tr("No expiry")}</td>
      <td>
        <button className="secondary danger small" disabled={busy} onClick={revoke}>{tr("Revoke")}</button>
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
      title={tr("Integrations")}
      crumbs={[SUITE_CRUMB, { label: tr("Integrations") }]}
      subtitle={tr("Integration keys let external portals read work orders, store visits and reports of this organisation")}
      actions={<button className="primary" onClick={() => openNew('integration_key')}>{tr("+ New integration key")}</button>}
    >
      {!data && <Loading error={error} />}
      {data?.items.length === 0 && (
        <EmptyState title={tr("No integration keys yet")} action={<button className="primary" onClick={() => openNew('integration_key')}>{tr("+ New integration key")}</button>}>
          {tr("Create a key for each external portal or system that needs read access.")}</EmptyState>
      )}
      {data && data.items.length > 0 && (
        <table className="grid">
          <thead>
            <tr>
              <th>{tr("Name")}</th>
              <th>{tr("Key starts with")}</th>
              <th>{tr("Created")}</th>
              <th>{tr("Expires")}</th>
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
