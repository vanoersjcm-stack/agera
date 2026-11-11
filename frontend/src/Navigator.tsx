import { type ReactNode, useEffect, useState } from 'react';
import { api, type ClientRecord } from './api';
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

function Node({ label, children, defaultOpen = false, onOpen }: { label: string; children: ReactNode; defaultOpen?: boolean; onOpen?: () => void }) {
  return (
    <details open={defaultOpen || undefined} onToggle={(e) => (e.currentTarget.open ? onOpen?.() : undefined)}>
      <summary>{label}</summary>
      <div className="nav-children">{children}</div>
    </details>
  );
}

function Leaf({ href, label, title }: { href: string; label: string; title?: string }) {
  return <a href={`#${href}`} title={title}>{label}</a>;
}

function CustomerNode({ client, dossier }: { client: ClientRef; dossier: string }) {
  const [record, setRecord] = useState<ClientRecord | null>(null);
  const base = `${dossier}/${client.clientId}`;
  const room = record?.rooms.find((r) => r.status === 'active') ?? record?.rooms[0];
  return (
    <Node label={client.name} onOpen={() => (record ? undefined : void api.client(client.clientId).then(setRecord, () => undefined))}>
      <Leaf href={room && dossier === '/nexus/clients' ? `/nexus/client-rooms/${room.id}?tab=plan` : `${base}?tab=rooms`} label={t("Actions")} title={t("Open action-plan milestones and tasks")} />
      <Leaf href={`${base}?tab=contacts`} label={t("Contacts")} />
      <span className="nav-disabled" title={t("Mail is not connected yet")} aria-disabled="true">{t("Mail")} · {t("not connected")}</span>
      <Leaf href={`${base}?tab=documents`} label={t("Documents")} />
      <Leaf href={`${base}?tab=agreements`} label={t("Contracts")} />
      <Leaf href={`${base}?tab=invoices`} label={t("Reports")} title={t("Financials & run-rate")} />
    </Node>
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
    <Node label={t("Customers")}>
      <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("Search customers")} aria-label={t("Search customers")} />
      {!q && <span className="nav-note">{t("Most viewed")}</span>}
      {shown.length === 0 ? <span className="nav-note">{t("No customers found")}</span> : shown.map((c) => <CustomerNode key={c.clientId} client={c} dossier={dossier} />)}
    </Node>
  );
}

/** Cross-suite tree in a flyout topic under the suite menu; every node follows the job role and edition. */
export function Navigator({ user, readOnlyTenant }: { user: UserContext; readOnlyTenant: boolean }) {
  useLanguage();
  const { openNew } = useShell();
  if (user.scope === 'external' || user.jobRole === 'CLIENT_VIEWER') return null;

  const dossier = allowed(user, '/nexus/clients') ? '/nexus/clients' : allowed(user, '/symphony/clients') ? '/symphony/clients' : null;
  const actions = [
    allowed(user, '/nexus/exceptions') && <Leaf key="open" href="/nexus/exceptions" label={t("Open workflow items")} />,
    allowed(user, '/symphony/approvals') && <Leaf key="approvals" href="/symphony/approvals?show=pending" label={t("Status on approvals")} />,
  ].filter(Boolean);
  const operational = allowed(user, '/symphony/reports') ? '/symphony/reports' : allowed(user, '/retailpower/back-office') ? '/retailpower/back-office' : null;
  const reports = [
    allowed(user, '/symphony/prognosis') && <Leaf key="fin" href="/symphony/prognosis" label={t("Financial")} />,
    operational && <Leaf key="ops" href={operational} label={t("Operational")} />,
  ].filter(Boolean);
  const documents = allowed(user, '/nexus/clients');
  const canCreate = documents && !readOnlyTenant && !readOnlySuite('nexus', user);

  return (
    <NavTopic label={t("Navigator")} className="navigator">
      <div className="nav-children">
        {actions.length > 0 && <Node label={t("Actions")}>{actions}</Node>}
        {dossier && <Customers dossier={dossier} />}
        {reports.length > 0 && <Node label={t("Reports")}>{reports}</Node>}
        {documents && (
          <Node label={t("Documents")}>
            {canCreate && (
              <>
                <button type="button" className="nav-link" onClick={() => openNew('doc_text')}>{t("New text document")}</button>
                <button type="button" className="nav-link" onClick={() => openNew('doc_sheet')}>{t("New spreadsheet")}</button>
                <button type="button" className="nav-link" onClick={() => openNew('doc_slides')}>{t("New presentation")}</button>
              </>
            )}
            <Leaf href="/nexus/drafts" label={t("Drafts")} title={t("Office documents not yet shared in a client room, newest first")} />
            {allowed(user, '/nexus/print') && <Leaf href="/nexus/print" label={t("Print & Scan")} title={t("Pull printing with a release code, and scans into the client's document vault")} />}
          </Node>
        )}
      </div>
    </NavTopic>
  );
}
