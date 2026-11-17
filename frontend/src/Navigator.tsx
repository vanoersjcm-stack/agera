import { type ReactNode, useState } from 'react';
import type { UserContext } from './context';
import { activeClients, useClients } from './directory';
import { isClientCategory } from './nexus/ThirdParties';
import { t, useLanguage } from './i18n';
import { NavTopic } from './SideNav';
import { navFor, type SuiteId, suitesFor } from './suites';

/** A path is offered only when the role's suites and menus include it. */
export function agenda(user: UserContext): string | null {
  return ['/symphony/agenda', '/nexus/agenda', '/retailpower/agenda'].find((p) => allowed(user, p)) ?? null;
}

export function allowed(user: UserContext, path: string): boolean {
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

/** Customer search: clients only (no staff or other relations), by their full company name. */
function Customers({ dossier }: { dossier: string }) {
  const clients = activeClients(useClients()).filter((c) => isClientCategory(c.entityCategory));
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const shown = q ? clients.filter((c) => c.name.toLowerCase().includes(q)).sort((a, b) => a.name.localeCompare(b.name)).slice(0, 10) : [];
  return (
    <Group label={t("Customers")}>
      <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("Search customers")} aria-label={t("Search customers")} />
      {!q ? <span className="nav-note">{t("Type a name to find a customer")}</span> : shown.length === 0 ? <span className="nav-note">{t("No customers found")}</span> : shown.map((c) => <Leaf key={c.clientId} href={`${dossier}/${c.clientId}`} label={c.name} />)}
    </Group>
  );
}

/** Cross-suite shortcuts in a flyout topic under the suite menu; every node follows the job role and edition. */
export function Navigator({ user }: { user: UserContext }) {
  useLanguage();
  if (user.scope === 'external' || user.jobRole === 'CLIENT_VIEWER') return null;

  const dossier = allowed(user, '/nexus/clients') ? '/nexus/clients' : allowed(user, '/symphony/clients') ? '/symphony/clients' : null;
  const actions = [
    allowed(user, '/nexus/exceptions') && <Leaf key="open" href="/nexus/exceptions" label={t("Open workflow items")} description={t("Exceptions that still need someone")} />,
    allowed(user, '/symphony/approvals') && <Leaf key="approvals" href="/symphony/approvals?show=pending" label={t("Status on approvals")} description={t("Approvals waiting for a decision")} />,
  ].filter(Boolean);
  if (actions.length === 0 && !dossier) return null;

  return (
    <NavTopic label={t("Navigator")} className="navigator">
      {actions.length > 0 && <Group label={t("Actions")}>{actions}</Group>}
      {dossier && <Customers dossier={dossier} />}
    </NavTopic>
  );
}

function Icon({ d }: { d: string }) {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={d} /></svg>;
}

const ICONS = {
  agenda: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
  thirdParties: 'M3 21V7l9-4 9 4v14M9 21v-6h6v6M8 10h.01M12 10h.01M16 10h.01',
  print: 'M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v8H6z',
};

/** Cross-cutting tools on the top bar: Agenda, Third parties and Print & Scan, as far as the role may open them. */
export function TopbarTools({ user }: { user: UserContext }) {
  useLanguage();
  if (user.scope === 'external' || user.jobRole === 'CLIENT_VIEWER') return null;
  const thirdParties = ['/symphony/third-parties', '/nexus/third-parties'].find((p) => allowed(user, p));
  const tools = [
    agenda(user) && { href: agenda(user)!, label: t("Agenda"), icon: ICONS.agenda },
    thirdParties && { href: thirdParties, label: t("Third parties"), icon: ICONS.thirdParties },
    allowed(user, '/nexus/print') && { href: '/nexus/print', label: t("Print & Scan"), icon: ICONS.print },
  ].filter((x): x is { href: string; label: string; icon: string } => !!x);
  if (tools.length === 0) return null;
  return (
    <nav className="topbar-tools" aria-label={t("Tools")}>
      {tools.map((tool) => (
        <a key={tool.href} className="topbar-tool" href={`#${tool.href}`} title={tool.label} aria-label={tool.label}><Icon d={tool.icon} /></a>
      ))}
    </nav>
  );
}
