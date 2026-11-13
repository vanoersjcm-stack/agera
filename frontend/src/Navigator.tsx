import { type ReactNode, useEffect, useState } from 'react';
import { keycloak } from './auth';
import type { UserContext } from './context';
import { activeClients, type ClientRef, useClients } from './directory';
import { t, useLanguage } from './i18n';
import { useShell } from './shell';
import { NavTopic } from './SideNav';
import { navFor, readOnlySuite, type SuiteId, suitesFor } from './suites';

const VIEWS_EVENT = 'agera:client-views';

interface ClientView { name: string; count: number; last: number }

function viewsKey(): string {
  return `agera.clientViews.${(keycloak.tokenParsed?.sub as string | undefined) ?? 'anonymous'}`;
}

function readViews(): Record<string, ClientView> {
  try {
    return JSON.parse(localStorage.getItem(viewsKey()) ?? '{}') as Record<string, ClientView>;
  } catch {
    return {};
  }
}

/** Counts a client dossier view for the current user (Navigator › Customers shows the top 10). */
export function recordClientView(clientId: string, name: string): void {
  const views = readViews();
  views[clientId] = { name, count: (views[clientId]?.count ?? 0) + 1, last: Date.now() };
  localStorage.setItem(viewsKey(), JSON.stringify(views));
  window.dispatchEvent(new Event(VIEWS_EVENT));
}

/** Most-viewed first; topped up alphabetically so a new user still sees ten customers. */
function topCustomers(clients: ClientRef[], views: Record<string, ClientView>): ClientRef[] {
  const viewed = clients
    .filter((c) => views[c.clientId])
    .sort((a, b) => views[b.clientId].count - views[a.clientId].count || views[b.clientId].last - views[a.clientId].last);
  const rest = clients.filter((c) => !views[c.clientId]).sort((a, b) => a.name.localeCompare(b.name));
  return [...viewed, ...rest].slice(0, 10);
}

/** A path is offered only when the role's suites and menus include it. */
function allowed(user: UserContext, path: string): boolean {
  const suite = path.split('?')[0].split('/')[1] as SuiteId;
  const base = path.split('?')[0];
  return suitesFor(user).some((s) => s.id === suite) && navFor(suite, user).some((i) => i.path === base);
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="nav-flyout-group" role="group" aria-label={label}>
      <div className="nav-flyout-title">{label}</div>
      {children}
    </div>
  );
}

function Leaf({ href, label, description }: { href: string; label: string; description?: string }) {
  return (
    <a className="flyout-link" href={`#${href}`}>
      <strong>{label}</strong>
      {description && <span>{description}</span>}
    </a>
  );
}

function Customers({ dossier }: { dossier: string }) {
  const clients = activeClients(useClients());
  const [query, setQuery] = useState('');
  const [views, setViews] = useState(readViews);
  useEffect(() => {
    const sync = () => setViews(readViews());
    window.addEventListener(VIEWS_EVENT, sync);
    return () => window.removeEventListener(VIEWS_EVENT, sync);
  }, []);
  const q = query.trim().toLowerCase();
  const shown = q ? clients.filter((c) => c.name.toLowerCase().includes(q)).slice(0, 10) : topCustomers(clients, views);
  return (
    <Group label={q ? t("Customers") : `${t("Customers")} · ${t("Most viewed")}`}>
      <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("Search customers")} aria-label={t("Search customers")} />
      {shown.length === 0 ? <span className="nav-note">{t("No customers found")}</span> : shown.map((c) => <Leaf key={c.clientId} href={`${dossier}/${c.clientId}`} label={c.name} />)}
    </Group>
  );
}

/** Cross-suite shortcuts in a flyout topic under the suite menu; every node follows the job role and edition. */
export function Navigator({ user, readOnlyTenant }: { user: UserContext; readOnlyTenant: boolean }) {
  useLanguage();
  const { openNew } = useShell();
  if (user.scope === 'external' || user.jobRole === 'CLIENT_VIEWER') return null;

  const dossier = allowed(user, '/nexus/clients') ? '/nexus/clients' : allowed(user, '/symphony/clients') ? '/symphony/clients' : null;
  const actions = [
    allowed(user, '/nexus/exceptions') && <Leaf key="open" href="/nexus/exceptions" label={t("Open workflow items")} description={t("Exceptions that still need someone")} />,
    allowed(user, '/symphony/approvals') && <Leaf key="approvals" href="/symphony/approvals?show=pending" label={t("Status on approvals")} description={t("Approvals waiting for a decision")} />,
  ].filter(Boolean);
  const operational = allowed(user, '/symphony/reports') ? '/symphony/reports' : allowed(user, '/retailpower/back-office') ? '/retailpower/back-office' : null;
  const reports = [
    allowed(user, '/symphony/prognosis') && <Leaf key="fin" href="/symphony/prognosis" label={t("Financial")} description={t("Prognosis and run-rate")} />,
    operational && <Leaf key="ops" href={operational} label={t("Operational")} description={t("Visit, store and field results")} />,
  ].filter(Boolean);
  const documents = allowed(user, '/nexus/clients');
  const canCreate = documents && !readOnlyTenant && !readOnlySuite('nexus', user);

  const newDoc = (kind: Parameters<typeof openNew>[0], label: string) => (
    <button type="button" className="flyout-link" onClick={() => openNew(kind)}><strong>{label}</strong></button>
  );

  return (
    <NavTopic label={t("Navigator")} className="navigator">
      <div className="nav-flyout-cols">
        <div className="nav-flyout-col">
          {actions.length > 0 && <Group label={t("Actions")}>{actions}</Group>}
          {reports.length > 0 && <Group label={t("Reports")}>{reports}</Group>}
          {documents && (
            <Group label={t("Documents")}>
              {canCreate && (
                <>
                  {newDoc('doc_text', t("New Agera.text document"))}
                  {newDoc('doc_sheet', t("New Agera.calc document"))}
                  {newDoc('doc_slides', t("New Agera.slides document"))}
                  {newDoc('doc_mail', t("New Agera.email"))}
                </>
              )}
              <Leaf href="/nexus/drafts" label={t("Drafts")} description={t("Office documents not yet shared in a client room, newest first")} />
              {allowed(user, '/nexus/print') && <Leaf href="/nexus/print" label={t("Print & Scan")} description={t("Pull printing with a release code, and scans into the client's document vault")} />}
            </Group>
          )}
        </div>
        {dossier && <div className="nav-flyout-col"><Customers dossier={dossier} /></div>}
      </div>
    </NavTopic>
  );
}
