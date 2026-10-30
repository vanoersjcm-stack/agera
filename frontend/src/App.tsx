import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, type SearchHit, type Tenant } from './api';
import { AssistantTip, useAssistant } from './Assistant';
import { keycloak } from './auth';
import { displayName, type UserContext, userContext } from './context';
import { EmptyState, ViewFrame } from './Layout';
import { NEW_ITEMS, NewDrawer } from './NewForms';
import { AgreementDossier, AgreementsView } from './nexus/Agreements';
import { AlertsView } from './nexus/Alerts';
import { ClientRoomDossier, ClientRoomsView } from './nexus/ClientRooms';
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
    case 'symphony/organisations':
      return user.isPlatformAdmin ? <OrganisationsView route={route} /> : <NotAvailable path={route.path} />;
    case 'symphony/integrations':
      return user.isPlatformAdmin ? <IntegrationsView route={route} /> : <NotAvailable path={route.path} />;
    case 'nexus/':
      return <NexusOverview />;
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

function SuiteSwitcher({ active }: { active: Suite }) {
  const { open, setOpen, ref } = useDropdown();
  return (
    <div className="dropdown" ref={ref}>
      <button className="suite-button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="suite-grid" aria-hidden>▦</span> Agera <span className="suite-current">{active.name}</span> ▾
      </button>
      {open && (
        <div className="menu suite-menu" role="menu">
          {SUITES.map((s) => (
            <a key={s.id} role="menuitem" href={`#${s.home}`} className={s.id === active.id ? 'selected' : undefined} onClick={() => setOpen(false)}>
              <strong>{s.name}</strong>
              <span>{s.tagline}</span>
              {s.id === active.id && <span className="check" aria-label="current">✓</span>}
            </a>
          ))}
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

function SearchBox({ user }: { user: UserContext }) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        input.current?.focus();
      }
    };
    const onDown = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    window.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, []);

  useEffect(() => {
    const term = q.trim();
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

  const pages = pageHits(user, q);
  const results: PageHit[] = [...pages, ...hits.map((h) => ({ route: h.route, title: h.title, subtitle: h.subtitle }))];
  const go = (route: string) => {
    setOpen(false);
    setQ('');
    navigate(route);
  };

  return (
    <div className="search" ref={box}>
      <input
        ref={input}
        type="search"
        value={q}
        placeholder="Search stores, work orders, agreements, client rooms or pages…"
        aria-label="Search"
        onChange={(e) => (setQ(e.target.value), setOpen(true))}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && results[0]) go(results[0].route);
          if (e.key === 'Escape') (setOpen(false), input.current?.blur());
        }}
      />
      <kbd className="search-kbd" title="Keyboard shortcut">Ctrl K</kbd>
      {open && q.trim().length >= 2 && (
        <div className="menu search-results" role="listbox">
          {results.map((r) => (
            <button key={r.route} role="option" aria-selected={false} onClick={() => go(r.route)}>
              <strong>{r.title}</strong>
              <span>{r.subtitle}</span>
            </button>
          ))}
          {results.length === 0 && <p className="muted menu-note">{searching ? 'Searching…' : 'Nothing found'}</p>}
        </div>
      )}
    </div>
  );
}

function NewMenu({ suite, user, onPick }: { suite: SuiteId; user: UserContext; onPick: (kind: NewKind) => void }) {
  const { open, setOpen, ref } = useDropdown();
  const items = NEW_ITEMS.filter((i) => !i.platformAdminOnly || user.isPlatformAdmin);
  const current = SUITES.find((s) => s.id === suite)!.name;
  const groups = [current, ...['Nexus', 'RetailPower', 'Symphony'].filter((g) => g !== current)];
  return (
    <div className="dropdown" ref={ref}>
      <button className="new-button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        + New ▾
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
        <span className="avatar" aria-hidden>{name.slice(0, 1).toUpperCase()}</span>
        <span className="user-name">{name}</span> ▾
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

export function App() {
  const route = useRoute();
  const user = useMemo(userContext, []);
  const external = user.scope === 'external';
  const assistant = useAssistant();
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [creating, setCreating] = useState<{ kind: NewKind; defaults: NewDefaults } | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    api.tenant().then(setTenant, () => setTenant(null));
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
          {external ? <span className="brand">Agera · Client portal</span> : <SuiteSwitcher active={suite} />}
          <span className="org-badge" title="Organisation you are working in">{tenant?.name ?? '…'}</span>
          {!external && <SearchBox user={user} />}
          {!external && <NewMenu suite={suite.id} user={user} onPick={(kind) => openNew(kind)} />}
          <span className="topbar-spacer" />
          <UserMenu user={user} tenant={tenant} tipsOn={assistant.enabled} onToggleTips={assistant.toggle} />
        </header>
        <div className="workspace">
          {external ? (
            <SideNav items={PORTAL_NAV} path={route.path} heading="Client portal" />
          ) : (
            <SideNav items={navFor(suite.id, user)} path={route.path} heading={`${suite.name} · ${suite.tagline}`} />
          )}
          <main>
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
