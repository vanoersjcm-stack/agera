import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, type SearchHit, type Tenant, switchOrganisation, viewingOrganisation } from './api';
import { AssistantTip, useAssistant } from './Assistant';
import { keycloak } from './auth';
import { displayName, type UserContext, userContext } from './context';
import { EmptyState, ViewFrame } from './Layout';
import { NEW_ITEMS, NewDrawer } from './NewForms';
import { AgreementDossier, AgreementsView } from './nexus/Agreements';
import { AlertsView } from './nexus/Alerts';
import { ClientRoomDossier, ClientRoomsView } from './nexus/ClientRooms';
import { ClientDossier, ClientsView } from './nexus/Clients';
import { FinancialPlansView, PlanDossier } from './nexus/FinancialPlans';
import { NexusOverview } from './nexus/NexusOverview';
import { ProfitLossView } from './nexus/ProfitLoss';
import { PortalOverview } from './portal/PortalOverview';
import { RetailOverview } from './retailpower/RetailOverview';
import { StoreDossier, StoresView } from './retailpower/Stores';
import { StoreVisitsView, VisitDossier } from './retailpower/StoreVisits';
import { WorkOrderDossier, WorkOrdersView } from './retailpower/WorkOrders';
import { navigate, type Route, useRoute } from './router';
import { type NewDefaults, type NewKind, ShellContext } from './shell';
import { LEGACY_ROUTES, lastSuite, type NavItem, navFor, PORTAL_NAV, rememberSuite, SUITES, type Suite, type SuiteId } from './suites';
import { PeopleView } from './symphony/People';
import { ActivityLogView, IntegrationsView, OrganisationsView, SymphonyOverview } from './symphony/SymphonyViews';

function NotAvailable({ path }: { path: string }) {
  return (
    <ViewFrame title="Page not available">
      <EmptyState title="This page does not exist or is not available for your account" action={<a className="button-link" href="#/">Go to the start page</a>}>
        The address <code>#{path}</code> could not be opened.
      </EmptyState>
    </ViewFrame>
  );
}

function InternalView({ route, user }: { route: Route; user: UserContext }) {
  const [suite, section, id] = route.segments;
  const key = `${suite}/${section ?? ''}`;
  switch (key) {
    case 'symphony/':
      return <SymphonyOverview />;
    case 'symphony/activity':
      return <ActivityLogView route={route} />;
    case 'symphony/people':
      return user.role === 'admin' || user.isPlatformAdmin ? <PeopleView route={route} user={user} /> : <NotAvailable path={route.path} />;
    case 'symphony/organisations':
      return user.isPlatformAdmin ? <OrganisationsView route={route} /> : <NotAvailable path={route.path} />;
    case 'symphony/integrations':
      return user.isPlatformAdmin ? <IntegrationsView route={route} /> : <NotAvailable path={route.path} />;
    case 'nexus/':
      return <NexusOverview />;
    case 'nexus/clients':
      return id ? <ClientDossier id={id} route={route} /> : <ClientsView route={route} />;
    case 'nexus/agreements':
      return id ? <AgreementDossier id={id} external={false} /> : <AgreementsView route={route} external={false} />;
    case 'nexus/client-rooms':
      return id ? <ClientRoomDossier id={id} route={route} external={false} /> : <ClientRoomsView route={route} external={false} />;
    case 'nexus/financial-plans':
      return id ? <PlanDossier id={id} /> : <FinancialPlansView route={route} />;
    case 'nexus/profit-loss':
      return <ProfitLossView route={route} />;
    case 'nexus/alerts':
      return <AlertsView route={route} />;
    case 'retailpower/':
      return <RetailOverview />;
    case 'retailpower/work-orders':
      return id ? <WorkOrderDossier id={id} /> : <WorkOrdersView route={route} />;
    case 'retailpower/store-visits':
      return id ? <VisitDossier id={id} /> : <StoreVisitsView route={route} />;
    case 'retailpower/stores':
      return id ? <StoreDossier id={id} /> : <StoresView route={route} />;
    default:
      return <NotAvailable path={route.path} />;
  }
}

function PortalView({ route }: { route: Route }) {
  const [, section, id] = route.segments;
  switch (section ?? '') {
    case '':
      return <PortalOverview />;
    case 'rooms':
      return id ? <ClientRoomDossier id={id} route={route} external /> : <ClientRoomsView route={route} external />;
    case 'agreements':
      return id ? <AgreementDossier id={id} external /> : <AgreementsView route={route} external />;
    default:
      return <NotAvailable path={route.path} />;
  }
}

/** Closes a dropdown when clicking outside of it or pressing Escape. */
function useDropdown() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return { open, setOpen, ref };
}

function WaffleMenu({ active }: { active: Suite }) {
  const { open, setOpen, ref } = useDropdown();
  return (
    <div className="dropdown" ref={ref}>
      <button className={`waffle-button${open ? ' open' : ''}`} aria-haspopup="menu" aria-expanded={open} aria-label="Switch suite" title="Switch suite" onClick={() => setOpen(!open)}>
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden><g fill="currentColor">{[3, 9, 15].flatMap((x) => [3, 9, 15].map((y) => <rect key={`${x}-${y}`} x={x - 1.5} y={y - 1.5} width="3" height="3" rx="0.8" />))}</g></svg>
      </button>
      {open && (
        <div className="waffle-panel" role="menu">
          <div className="waffle-head">
            <span>Agera suites</span>
            <span className="waffle-hint">1 click</span>
          </div>
          <div className="waffle-grid">
            {SUITES.map((s) => (
              <a key={s.id} role="menuitem" href={`#${s.home}`} className={`waffle-card ${s.id}${s.id === active.id ? ' current' : ''}`} onClick={() => setOpen(false)}>
                <strong>Agera {s.name}</strong>
                {s.tagline}
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

interface PageHit {
  route: string;
  title: string;
  subtitle: string;
}

function pageHits(user: UserContext, q: string): PageHit[] {
  const n = q.trim().toLowerCase();
  if (n.length < 2) return [];
  return SUITES.flatMap((s) =>
    navFor(s.id, user)
      .filter((i) => `${s.name} ${i.label} ${i.description}`.toLowerCase().includes(n))
      .map((i) => ({ route: i.path, title: `${s.name} › ${i.label}`, subtitle: i.description })),
  ).slice(0, 4);
}

function SearchPalette({ user }: { user: UserContext }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    const term = q.trim();
    setSelected(0);
    if (term.length < 2) {
      setHits([]);
      return;
    }
    setSearching(true);
    const timer = window.setTimeout(() => {
      api.search(term).then(
        (r) => (setHits(r), setSearching(false)),
        () => (setHits([]), setSearching(false)),
      );
    }, 250);
    return () => window.clearTimeout(timer);
  }, [q]);

  const close = () => (setOpen(false), setQ(''));
  const pages = pageHits(user, q);
  const results = [
    ...pages.map((p) => ({ ...p, type: 'Page' })),
    ...hits.map((h) => ({ route: h.route, title: h.title, subtitle: h.subtitle, type: SEARCH_TYPE[h.entityType] ?? '' })),
  ];
  const go = (route: string) => (close(), navigate(route));

  return (
    <>
      <button className="search-trigger" onClick={() => setOpen(true)} title="Search (Ctrl K)">
        <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden><circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" strokeWidth="1.6" /><path d="M11 11l3.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
        <span className="search-label">Search…</span>
        <kbd>Ctrl K</kbd>
      </button>
      {open && (
        <div className="palette-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
          <div className="palette" role="dialog" aria-label="Search">
            <input
              autoFocus
              type="search"
              value={q}
              placeholder="Search clients, stores, work orders, agreements, client rooms or pages…"
              aria-label="Search"
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') close();
                if (e.key === 'ArrowDown') (e.preventDefault(), setSelected((i) => Math.min(i + 1, results.length - 1)));
                if (e.key === 'ArrowUp') (e.preventDefault(), setSelected((i) => Math.max(i - 1, 0)));
                if (e.key === 'Enter' && results[selected]) go(results[selected].route);
              }}
            />
            <div className="palette-results" role="listbox">
              {q.trim().length < 2 && <p className="muted menu-note">Type at least two letters. Use ↑ ↓ and Enter to open a result.</p>}
              {results.map((r, i) => (
                <button key={r.route} role="option" aria-selected={i === selected} className={i === selected ? 'selected' : undefined} onMouseEnter={() => setSelected(i)} onClick={() => go(r.route)}>
                  <strong>{r.title}{r.type && <em className="palette-type">{r.type}</em>}</strong>
                  <span>{r.subtitle}</span>
                </button>
              ))}
              {q.trim().length >= 2 && results.length === 0 && <p className="muted menu-note">{searching ? 'Searching…' : 'Nothing found'}</p>}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

const SEARCH_TYPE: Record<string, string> = {
  client: 'Client',
  store: 'Store',
  work_order: 'Work order',
  agreement: 'Agreement',
  client_room: 'Client room',
  digital_sales_room: 'Client room',
};

function NewMenu({ suite, user, onPick }: { suite: SuiteId; user: UserContext; onPick: (kind: NewKind) => void }) {
  const { open, setOpen, ref } = useDropdown();
  const items = NEW_ITEMS.filter((i) => !i.platformAdminOnly || user.isPlatformAdmin);
  const current = SUITES.find((s) => s.id === suite)!.name;
  const groups = [current, ...['Nexus', 'RetailPower', 'Symphony'].filter((g) => g !== current)];
  return (
    <div className="dropdown" ref={ref}>
      <button className="new-button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        + New
      </button>
      {open && (
        <div className="menu new-menu" role="menu">
          {groups.map((g) => {
            const groupItems = items.filter((i) => i.group === g);
            if (groupItems.length === 0) return null;
            return (
              <div key={g} className="menu-group">
                <span className="menu-heading">{g}{g === current ? ' (current)' : ''}</span>
                {groupItems.map((i) => (
                  <button key={i.kind} role="menuitem" onClick={() => (setOpen(false), onPick(i.kind))}>
                    {i.label}
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function UserMenu({ user, tenant, tipsOn, onToggleTips }: { user: UserContext; tenant: Tenant | null; tipsOn: boolean; onToggleTips: () => void }) {
  const { open, setOpen, ref } = useDropdown();
  const name = displayName();
  const email = keycloak.tokenParsed?.email as string | undefined;
  return (
    <div className="dropdown" ref={ref}>
      <button className="user-button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="avatar" aria-hidden>{initials(name)}</span>
        <span className="user-meta">
          <span className="user-name">{name}</span>
          <small>{user.roleLabel}</small>
        </span>
      </button>
      {open && (
        <div className="menu user-menu" role="menu">
          <div className="menu-profile">
            <strong>{name}</strong>
            {email && <span>{email}</span>}
            <span>{user.roleLabel} · {tenant?.name ?? '…'}</span>
          </div>
          <button role="menuitem" onClick={onToggleTips}>{tipsOn ? 'Hide page tips' : 'Show page tips'}</button>
          <button role="menuitem" onClick={() => void keycloak.logout({ redirectUri: window.location.origin + '/' })}>Log out</button>
        </div>
      )}
    </div>
  );
}

function initials(name: string): string {
  const parts = name.split(/[\s.@]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() || '?';
}

function SideNav({ items, path, heading }: { items: NavItem[]; path: string; heading: string }) {
  const active = items
    .filter((i) => path === i.path || path.startsWith(`${i.path}/`))
    .sort((a, b) => b.path.length - a.path.length)[0];
  return (
    <nav className="sidenav" aria-label={`${heading} navigation`}>
      <span className="sidenav-heading">{heading}</span>
      {items.map((i) => (
        <a key={i.path} href={`#${i.path}`} className={i === active ? 'active' : undefined} title={i.description} aria-current={i === active ? 'page' : undefined}>
          {i.label}
        </a>
      ))}
    </nav>
  );
}

/** Resolves start page and old bookmarks; returns null when the current route can be shown as is. */
function redirectFor(route: Route, external: boolean): string | null {
  const legacy = LEGACY_ROUTES[route.path];
  if (legacy) return external ? legacy.external : legacy.internal;
  if (route.path === '/') return external ? '/portal' : lastSuite().home;
  if (external && route.segments[0] !== 'portal') return '/portal';
  return null;
}

function OrgBadge({ user, tenant }: { user: UserContext; tenant: Tenant | null }) {
  const [tenants, setTenants] = useState<Tenant[] | null>(null);
  useEffect(() => {
    if (user.isPlatformAdmin) api.tenants().then(setTenants, () => setTenants(null));
  }, [user.isPlatformAdmin]);
  if (!user.isPlatformAdmin || !tenant || !tenants || tenants.length < 2) {
    return <span className="org-badge" title="Organisation you are working in">{tenant?.name ?? '…'}</span>;
  }
  return (
    <select
      className="org-badge org-switch"
      aria-label="Switch organisation"
      title="Platform administrators can view other organisations (read-only)"
      value={tenant.id}
      onChange={(e) => switchOrganisation(e.target.value)}
    >
      {tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
    </select>
  );
}

export function App() {
  const route = useRoute();
  const user = useMemo(userContext, []);
  const external = user.scope === 'external';
  const assistant = useAssistant();
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [creating, setCreating] = useState<{ kind: NewKind; defaults: NewDefaults } | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    api.tenant().then((t) => {
      if (!t.readOnly && viewingOrganisation()) sessionStorage.removeItem('agera.viewOrganisation');
      setTenant(t);
    }, () => setTenant(null));
    // Records the caller's current roles for the user list (GET /users); internal users only.
    if (!external) api.me().catch(() => undefined);
  }, [external]);

  const redirect = redirectFor(route, external);
  useEffect(() => {
    if (redirect) window.location.replace(`#${redirect}`);
  }, [redirect]);

  const suite = SUITES.find((s) => s.id === route.segments[0]) ?? lastSuite();
  useEffect(() => {
    if (!external && SUITES.some((s) => s.id === route.segments[0])) rememberSuite(route.segments[0] as SuiteId);
  }, [external, route.segments]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 4000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => setCreating(null), [route.path]);

  const openNew = useCallback((kind: NewKind, defaults: NewDefaults = {}) => setCreating({ kind, defaults }), []);
  const shell = useMemo(() => ({ openNew, notify: setToast }), [openNew]);

  if (redirect) return null;

  return (
    <ShellContext.Provider value={shell}>
      <div className={`shell suite-${external ? 'portal' : suite.id}`}>
        <header className="topbar">
          {external ? (
            <span className="brand">Agera · Client portal</span>
          ) : (
            <>
              <WaffleMenu active={suite} />
              <div className="suite-indicator">
                <span className="suite-title">Agera {suite.name}</span>
                <span className="suite-tag">{suite.tagline}</span>
              </div>
              <nav className="suite-nav" aria-label="Suites">
                {SUITES.map((s) => (
                  <a key={s.id} href={`#${s.home}`} className={s.id === suite.id ? 'active' : undefined}>
                    <span className={`suite-dot dot-${s.id}`} aria-hidden />
                    {s.name}
                  </a>
                ))}
              </nav>
            </>
          )}
          <span className="topbar-spacer" />
          {!external && <SearchPalette user={user} />}
          <UserMenu user={user} tenant={tenant} tipsOn={assistant.enabled} onToggleTips={assistant.toggle} />
        </header>
        <div className="actionbar">
          <div className="actionbar-crumbs">
            <strong>Agera</strong>
            <span className="sep" aria-hidden>›</span>
            <span id="actionbar-crumbs" className="crumbs-slot" data-fallback={external ? 'Client portal' : suite.name} />
          </div>
          <div className="actionbar-actions">
            <OrgBadge user={user} tenant={tenant} />
            {!external && !tenant?.readOnly && <NewMenu suite={suite.id} user={user} onPick={(kind) => openNew(kind)} />}
          </div>
        </div>
        <div className="workspace">
          {external ? (
            <SideNav items={PORTAL_NAV} path={route.path} heading="Client portal" />
          ) : (
            <SideNav items={navFor(suite.id, user)} path={route.path} heading={`${suite.name} · ${suite.tagline}`} />
          )}
          <main>
            {tenant?.readOnly && (
              <p className="callout readonly-banner">
                You are viewing <strong>{tenant.name}</strong> read-only. Changes are only possible in your own organisation.{' '}
                <button className="link-button" onClick={() => switchOrganisation(null)}>Back to my organisation</button>
              </p>
            )}
            <AssistantTip path={route.path} assistant={assistant} />
            {external ? <PortalView route={route} /> : <InternalView route={route} user={user} />}
          </main>
        </div>
        {creating && (
          <NewDrawer
            kind={creating.kind}
            defaults={creating.defaults}
            onClose={() => setCreating(null)}
            onSwitch={(kind) => setCreating({ kind, defaults: {} })}
            notify={setToast}
          />
        )}
        {toast && <div className="toast" role="status">{toast}</div>}
      </div>
    </ShellContext.Provider>
  );
}
