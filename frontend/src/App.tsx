import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, type Client, type SearchHit, type Tenant, switchOrganisation, viewingOrganisation, type UserProfile, type LicenseTier } from './api';
import { AssistantTip, useAssistant } from './Assistant';
import { keycloak } from './auth';
import { displayName, type UserContext, userContext } from './context';
import { EmptyState, ViewFrame } from './Layout';
import { NEW_ITEMS, NewDrawer } from './NewForms';
import { DocIcon } from './DocumentCreate';
import { AgreementDossier, AgreementsView } from './nexus/Agreements';
import { AlertsView } from './nexus/Alerts';
import { FeedbackView, PortalSurveysView, SurveyDossier, SurveysView } from './nexus/Surveys';
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
import { AuditRoundDossier, AuditRoundsView, FieldCalendarView, FieldOrderDossier, FieldOrdersView, PlanogramDossier, PlanogramsView, ProductsView } from './retailpower/Field';
import { DealDossier, DealsView, PipelineBoard } from './vanguard/Pipeline';
import { navigate, type Route, useRoute } from './router';
import { type NewDefaults, type NewKind, ShellContext } from './shell';
import { editionName, LEGACY_ROUTES, lastSuite, type NavItem, navFor, PORTAL_NAV, previewTier, rememberSuite, setActiveTier, setPreviewTier, SUITES, type Suite, type SuiteId, suiteName } from './suites';
import { CREDIT_HOLDS_CHANGED, CreditControlView } from './symphony/CreditControl';
import { InvoicesView } from './symphony/Invoices';
import { PeopleView } from './symphony/People';
import { PrognosisView } from './symphony/Prognosis';
import { setClientFilter, useClientFilter } from './clientFilter';
import { PriceListDossier, PriceListsView, TemplatesView } from './nexus/Commercial';
import { AutomationDossier, AutomationsView } from './symphony/Automations';
import { ReportBuilderView, ReportsView } from './symphony/Reports';
import { IntegrationsView as ExternalSystemsView } from './symphony/Integrations';
import { GoldenThreadTour, startTour } from './tour';
import { getTheme, setTheme } from './theme';
import { getLanguage, setLanguage, t, useLanguage, t as tr, tf } from './i18n';
import { OfficeEditorHost } from './office';
import { startOfflineSync, useOfflineQueue } from './offlineQueue';
import { ApprovalDossier, ApprovalsView, ExceptionDossier, ExceptionsView, HealthView, NotificationBell } from './symphony/Workflow';
import { ActivityLogView, IntegrationsView, OrganisationsView, SymphonyOverview } from './symphony/SymphonyViews';

function NotAvailable({ path }: { path: string }) {
  return (
    <ViewFrame title={tr("Page not available")}>
      <EmptyState title={tr("This page does not exist or is not available for your account")} action={<a className="button-link" href="#/">{tr("Go to the start page")}</a>}>
        {tr("The address")} <code>#{path}</code>  {tr("could not be opened.")}</EmptyState>
    </ViewFrame>
  );
}

function InternalView({ route, user }: { route: Route; user: UserContext }) {
  const [suite, section, id] = route.segments;
  const key = `${suite}/${section ?? ''}`;
  switch (key) {
    case 'symphony/':
      return <SymphonyOverview />;
    case 'symphony/approvals':
      return id ? <ApprovalDossier id={id} /> : <ApprovalsView route={route} />;
    case 'symphony/health':
      return <HealthView />;
    case 'symphony/feedback':
      return <FeedbackView />;
    case 'symphony/automations':
      return id ? <AutomationDossier id={id} /> : <AutomationsView startNew={route.params.get('new') === '1'} />;
    case 'symphony/reports':
      return <ReportsView />;
    case 'symphony/report-builder':
      return <ReportBuilderView />;
    case 'symphony/connections':
      return <ExternalSystemsView />;
    case 'nexus/price-lists':
      return id ? <PriceListDossier id={id} /> : <PriceListsView route={route} />;
    case 'nexus/templates':
      return <TemplatesView />;
    case 'nexus/exceptions':
      return id ? <ExceptionDossier id={id} /> : <ExceptionsView route={route} />;
    case 'symphony/credit-control':
      return <CreditControlView route={route} user={user} />;
    case 'symphony/prognosis':
      return <PrognosisView route={route} />;
    case 'symphony/invoices':
      return <InvoicesView route={route} />;
    case 'symphony/clients':
      return id ? <ClientDossier id={id} route={route} /> : <ClientsView route={route} />;
    case 'symphony/activity':
      return <ActivityLogView route={route} />;
    case 'symphony/people':
      return user.role === 'admin' || user.isPlatformAdmin ? <PeopleView route={route} user={user} /> : <NotAvailable path={route.path} />;
    case 'symphony/organisations':
      return user.isPlatformAdmin ? <OrganisationsView route={route} /> : <NotAvailable path={route.path} />;
    case 'symphony/integrations':
      return user.isPlatformAdmin ? <IntegrationsView route={route} /> : <NotAvailable path={route.path} />;
    case 'nexus/pipeline':
      return <PipelineBoard />;
    case 'nexus/deals':
      return id ? <DealDossier id={id} /> : <DealsView route={route} />;
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
    case 'nexus/surveys':
      return id ? <SurveyDossier id={id} route={route} /> : <SurveysView route={route} />;
    case 'retailpower/':
      return <RetailOverview />;
    case 'retailpower/work-orders':
      return id ? <WorkOrderDossier id={id} /> : <WorkOrdersView route={route} />;
    case 'retailpower/store-visits':
      return id ? <VisitDossier id={id} /> : <StoreVisitsView route={route} />;
    case 'retailpower/stores':
      return id ? <StoreDossier id={id} /> : <StoresView route={route} />;
    case 'retailpower/products':
      return <ProductsView route={route} />;
    case 'retailpower/planograms':
      return id ? <PlanogramDossier id={id} /> : <PlanogramsView />;
    case 'retailpower/orders':
      return id ? <FieldOrderDossier id={id} /> : <FieldOrdersView route={route} />;
    case 'retailpower/audit-rounds':
      return id ? <AuditRoundDossier id={id} /> : <AuditRoundsView />;
    case 'retailpower/calendar':
      return <FieldCalendarView route={route} />;
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
    case 'surveys':
      return <PortalSurveysView id={id} />;
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

function WaffleMenu({ active, tier }: { active: Suite; tier: LicenseTier }) {
  const { open, setOpen, ref } = useDropdown();
  return (
    <div className="dropdown" ref={ref}>
      <button className={`waffle-button${open ? ' open' : ''}`} aria-haspopup="menu" aria-expanded={open} aria-label={tr("Switch suite")} title={tr("Switch suite")} onClick={() => setOpen(!open)}>
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden><g fill="currentColor">{[3, 9, 15].flatMap((x) => [3, 9, 15].map((y) => <rect key={`${x}-${y}`} x={x - 1.5} y={y - 1.5} width="3" height="3" rx="0.8" />))}</g></svg>
      </button>
      {open && (
        <div className="waffle-panel" role="menu">
          <div className="waffle-head">
            <span>{tr("Agera suites")}</span>
            <span className="waffle-hint">{tr("1 click")}</span>
          </div>
          <div className="waffle-grid">
            {SUITES.map((s) => (
              <a key={s.id} role="menuitem" href={`#${s.home}`} className={`waffle-card ${s.id}${s.id === active.id ? ' current' : ''}`} onClick={() => setOpen(false)}>
                <strong>{tr("Agera")} {suiteName(s, tier)}</strong>
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

function pageHits(user: UserContext, tier: LicenseTier, q: string): PageHit[] {
  const n = q.trim().toLowerCase();
  if (n.length < 2) return [];
  return SUITES.flatMap((s) =>
    navFor(s.id, user)
      .filter((i) => `${suiteName(s, tier)} ${i.label} ${i.description}`.toLowerCase().includes(n))
      .map((i) => ({ route: i.path, title: `${suiteName(s, tier)} › ${i.label}`, subtitle: i.description })),
  ).slice(0, 4);
}

function SearchPalette({ user, tier }: { user: UserContext; tier: LicenseTier }) {
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
  const pages = pageHits(user, tier, q);
  const results = [
    ...pages.map((p) => ({ ...p, type: 'Page' })),
    ...hits.map((h) => ({ route: h.route, title: h.title, subtitle: h.subtitle, type: SEARCH_TYPE[h.entityType] ?? '' })),
  ];
  const go = (route: string) => (close(), navigate(route));

  return (
    <>
      <button className="search-trigger" onClick={() => setOpen(true)} title={tr("Search (Ctrl K)")}>
        <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden><circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" strokeWidth="1.6" /><path d="M11 11l3.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
        <span className="search-label">{tr("Search…")}</span>
        <kbd>{tr("Ctrl K")}</kbd>
      </button>
      {open && (
        <div className="palette-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
          <div className="palette" role="dialog" aria-label={tr("Search")}>
            <input
              autoFocus
              type="search"
              value={q}
              placeholder={tr("Search clients, stores, work orders, agreements, client rooms or pages…")}
              aria-label={tr("Search")}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') close();
                if (e.key === 'ArrowDown') (e.preventDefault(), setSelected((i) => Math.min(i + 1, results.length - 1)));
                if (e.key === 'ArrowUp') (e.preventDefault(), setSelected((i) => Math.max(i - 1, 0)));
                if (e.key === 'Enter' && results[selected]) go(results[selected].route);
              }}
            />
            <div className="palette-results" role="listbox">
              {q.trim().length < 2 && <p className="muted menu-note">{tr("Type at least two letters. Use ↑ ↓ and Enter to open a result.")}</p>}
              {results.map((r, i) => (
                <button key={r.route} role="option" aria-selected={i === selected} className={i === selected ? 'selected' : undefined} onMouseEnter={() => setSelected(i)} onClick={() => go(r.route)}>
                  <strong>{r.title}{r.type && <em className="palette-type">{r.type}</em>}</strong>
                  <span>{r.subtitle}</span>
                </button>
              ))}
              {q.trim().length >= 2 && results.length === 0 && <p className="muted menu-note">{searching ? tr("Searching…") : tr("Nothing found")}</p>}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

const SEARCH_TYPE: Record<string, string> = {
  client: tr("Client"),
  store: tr("Store"),
  work_order: tr("Work order"),
  agreement: tr("Agreement"),
  client_room: tr("Client room"),
  digital_sales_room: tr("Client room"),
};

function NewMenu({ suite, user, tier, onPick }: { suite: SuiteId; user: UserContext; tier: LicenseTier; onPick: (kind: NewKind) => void }) {
  const { open, setOpen, ref } = useDropdown();
  const current = SUITES.find((s) => s.id === suite)!.name as 'Nexus' | 'RetailPower' | 'Symphony';
  const allowed = NEW_ITEMS.filter((i) => (!i.platformAdminOnly || user.isPlatformAdmin) && (!i.adminOnly || user.role === 'admin' || user.isPlatformAdmin));
  const docs = current === 'RetailPower' ? [] : allowed.filter((i) => i.group === 'Document');
  const items = allowed.filter((i) => i.group === current || i.also?.includes(current));
  const heading = current === 'Symphony' && tier === 'vanguard' ? tr("Vanguard") : current;
  const item = (i: (typeof NEW_ITEMS)[number]) => (
    <button key={i.kind} role="menuitem" className={i.icon ? 'menu-doc' : undefined} onClick={() => (setOpen(false), onPick(i.kind))}>
      {i.icon ? <><strong><DocIcon kind={i.icon} /> {i.label}</strong>{i.hint && <span>{i.hint}</span>}</> : i.label}
    </button>
  );
  return (
    <div className="dropdown" ref={ref}>
      <button className="new-button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        {tr("+ New")}</button>
      {open && (
        <div className="menu new-menu" role="menu">
          {docs.length > 0 && (
            <div className="menu-group">
              <span className="menu-heading">{tr("Make new document")}</span>
              {docs.map(item)}
            </div>
          )}
          <div className="menu-group">
            <span className="menu-heading">{heading}</span>
            {items.map(item)}
          </div>
        </div>
      )}
    </div>
  );
}

function UserMenu({ user, tenant, tier, tipsOn, onToggleTips }: { user: UserContext; tenant: Tenant | null; tier: LicenseTier; tipsOn: boolean; onToggleTips: () => void }) {
  const { open, setOpen, ref } = useDropdown();
  const name = displayName();
  const email = keycloak.tokenParsed?.email as string | undefined;
  const [profile, setProfile] = useState<UserProfile | null>(null);
  useEffect(() => {
    api.me().then(setProfile, () => setProfile(null));
  }, []);
  const subtitle = [profile?.title, profile?.zone].filter(Boolean).join(' · ');
  return (
    <div className="dropdown" ref={ref}>
      <button className="user-button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="avatar" aria-hidden>{initials(name)}</span>
        <span className="user-meta">
          <span className="user-name">{name}</span>
          <small>{profile?.title ?? user.roleLabel}</small>
        </span>
      </button>
      {open && (
        <div className="menu user-menu" role="menu">
          <div className="menu-profile">
            <strong>{name}</strong>
            {email && <span>{email}</span>}
            {subtitle && <span>{subtitle}</span>}
            <span>{user.roleLabel} · {tenant?.name ?? '…'}</span>
            <span>{editionName(tier)}</span>
          </div>
          {user.isPlatformAdmin && (
            <button role="menuitem" onClick={() => setPreviewTier(tier === 'vanguard' ? 'symphony' : 'vanguard')}>
              {tier === 'vanguard' ? tr("View as Enterprise (Symphony)") : tr("View as Vanguard")}
            </button>
          )}
          {user.isPlatformAdmin && previewTier() && <button role="menuitem" onClick={() => setPreviewTier(null)}>{tr("Stop edition preview")}</button>}
          <button role="menuitem" onClick={() => (setOpen(false), startTour())}>{t('Take the Golden Thread tour')}</button>
          <button role="menuitem" onClick={() => (setOpen(false), setTheme(getTheme() === 'dark' ? 'light' : 'dark'))}>{getTheme() === 'dark' ? tr("Appearance: dark → light") : tr("Appearance: light → dark")}</button>
          <button role="menuitem" onClick={() => setLanguage(getLanguage() === 'nl' ? 'en' : 'nl')}>{getLanguage() === 'nl' ? tr("Language: Nederlands → English") : tr("Language: English → Nederlands")}</button>
          <button role="menuitem" onClick={onToggleTips}>{t(tipsOn ? 'Hide page tips' : 'Show page tips')}</button>
          <button role="menuitem" onClick={() => void keycloak.logout({ redirectUri: window.location.origin + '/' })}>{t('Log out')}</button>
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
  useLanguage();
  const active = items
    .filter((i) => path === i.path || path.startsWith(`${i.path}/`))
    .sort((a, b) => b.path.length - a.path.length)[0];
  return (
    <nav className="sidenav" aria-label={`${heading} navigation`}>
      <span className="sidenav-heading">{heading}</span>
      {items.map((i) => (
        <a key={i.path} href={`#${i.path}`} className={i === active ? 'active' : undefined} title={i.description} aria-current={i === active ? 'page' : undefined}>
          {t(i.label)}
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

/** Red pill in the action bar while any credit lock is active; admins get a one-click way to set one. */
function suiteBadge(id: SuiteId, tier: LicenseTier): string {
  if (id === 'nexus') return 'CLIENT PORTAL';
  if (id === 'retailpower') return 'FIELDCARE AUDITS';
  return tier === 'vanguard' ? 'MID-MARKET EDITION' : 'HQ CORE';
}

function shortCode(name: string): string {
  const words = name.replace(/[^\p{L}\p{N} ]/gu, '').split(/\s+/).filter(Boolean);
  return (words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? '?').slice(0, 2)).toUpperCase();
}

/** Quick switch between client dossiers; shows the client of the open dossier. */
function ClientPill() {
  const [clients, setClients] = useState<Client[] | null>(null);
  const [open, setOpen] = useState(false);
  const filter = useClientFilter();
  useEffect(() => void api.clients().then(setClients, () => setClients([])), []);
  if (!clients || clients.length === 0) return null;
  return (
    <div className={`client-pill${filter ? ' filtered' : ''}`}>
      <button aria-haspopup="menu" aria-expanded={open} title={filter ? tf("Lists filtered on {name}", { name: filter.name }) : tr("Filter all lists on one client")} onClick={() => setOpen(!open)} onBlur={() => setTimeout(() => setOpen(false), 200)}>
        [{filter ? shortCode(filter.name) : tr("All clients")} ▾]
      </button>
      {open && (
        <div className="menu" role="menu">
          <button role="menuitem" className={!filter ? 'selected' : undefined} onMouseDown={() => setClientFilter(null)}>{tr("All clients")}</button>
          {clients.filter((c) => c.status === 'active').map((c) => (
            <div key={c.id} className={`client-pill-row${c.id === filter?.id ? ' selected' : ''}`}>
              <button role="menuitem" onMouseDown={() => setClientFilter({ id: c.id, name: c.name })} title={tr("Filter all lists on this client")}>
                <code>{shortCode(c.name)}</code> {c.name}
              </button>
              <a href={`#/nexus/clients/${c.id}`} onMouseDown={() => navigate(`/nexus/clients/${c.id}`)} className="small">{tr("dossier")}</a>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Live connection status of the Agera backend and database (no external ERP is connected). */
function StatusPill() {
  const [ok, setOk] = useState<boolean | null>(null);
  useEffect(() => {
    const check = () => void api.health().then((h) => setOk(h.status === 'ok'), () => setOk(false));
    check();
    const t = window.setInterval(check, 60000);
    return () => window.clearInterval(t);
  }, []);
  if (ok === null) return null;
  return (
    <span className={`status-pill${ok ? '' : ' down'}`} title={tr("Status of the Agera database. No ERP system is connected.")}>
      <span className="dot" aria-hidden /> {ok ? tr("Database connected") : tr("Database unreachable")}
    </span>
  );
}

function OfflinePill() {
  const count = useOfflineQueue();
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const sync = () => setOnline(navigator.onLine);
    window.addEventListener('online', sync);
    window.addEventListener('offline', sync);
    return () => (window.removeEventListener('online', sync), window.removeEventListener('offline', sync));
  }, []);
  if (online && count === 0) return null;
  const label = online ? tr("Syncing queued visit reports…") : `${tr("Offline mode")}: ${count} ${count === 1 ? tr("visit report queued") : tr("visit reports queued")}`;
  return <span className="offline-pill" role="status">{label}</span>;
}

function CreditPill({ user }: { user: UserContext }) {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    const load = () => void api.creditHolds().then((h) => setCount(h.length), () => setCount(null));
    load();
    window.addEventListener(CREDIT_HOLDS_CHANGED, load);
    window.addEventListener('hashchange', load);
    return () => (window.removeEventListener(CREDIT_HOLDS_CHANGED, load), window.removeEventListener('hashchange', load));
  }, []);
  if (count === null) return null;
  if (count > 0) {
    return (
      <a className="credit-pill locked" href="#/symphony/credit-control" title={tr("Agreements cannot be activated for locked clients")}>
        <span className="pulse" aria-hidden />  {tr("Credit lock active")}{count > 1 ? ` (${count})` : ''}
      </a>
    );
  }
  if (!(user.role === 'admin' || user.isPlatformAdmin)) return null;
  return (
    <a className="credit-pill" href="#/symphony/credit-control?lock=" title={tr("Emergency credit lock")}>
      {tr("Credit lock")}</a>
  );
}

function OrgBadge({ user, tenant }: { user: UserContext; tenant: Tenant | null }) {
  const [tenants, setTenants] = useState<Tenant[] | null>(null);
  useEffect(() => {
    if (user.isPlatformAdmin) api.tenants().then(setTenants, () => setTenants(null));
  }, [user.isPlatformAdmin]);
  if (!user.isPlatformAdmin || !tenant || !tenants || tenants.length < 2) {
    return <span className="org-badge" title={tr("Organisation you are working in")}>{tenant?.name ?? '…'}</span>;
  }
  return (
    <select
      className="org-badge org-switch"
      aria-label={tr("Switch organisation")}
      title={tr("Platform administrators can view other organisations (read-only)")}
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
  useEffect(() => startOfflineSync((n) => setToast(`${n} ${tr("queued visit items synced")}`)), []);

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
  const preview = user.isPlatformAdmin ? previewTier() : null;
  const tier: LicenseTier = preview ?? tenant?.licenseTier ?? 'symphony';
  setActiveTier(tier);
  const brand = suiteName(suite, tier);
  useEffect(() => {
    if (!external && SUITES.some((s) => s.id === route.segments[0])) rememberSuite(route.segments[0] as SuiteId);
  }, [external, route.segments]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 4000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => setCreating(null), [route.path]);

  const openNew = useCallback((kind: NewKind, defaults: NewDefaults = {}) => {
    if (kind === 'automation') return navigate('/symphony/automations?new=1');
    if (kind === 'user_invite') return navigate('/symphony/people?invite=1');
    setCreating({ kind, defaults });
  }, []);
  const shell = useMemo(() => ({ openNew, notify: setToast }), [openNew]);

  if (redirect) return null;

  return (
    <ShellContext.Provider value={shell}>
      <div className={`shell suite-${external ? 'portal' : suite.id} tier-${tier}`}>
        <header className="topbar">
          {external ? (
            <span className="brand">{tr("Agera · Client portal")}</span>
          ) : (
            <>
              <WaffleMenu active={suite} tier={tier} />
              <div className="suite-indicator">
                <span className="suite-title">{tr("Agera")} {brand}</span>
                <span className="suite-tag">{suiteBadge(suite.id, tier)}</span>
              </div>
              <nav className="suite-nav" aria-label={tr("Suites")}>
                {SUITES.map((s) => (
                  <a key={s.id} href={`#${s.home}`} className={s.id === suite.id ? 'active' : undefined}>
                    <span className={`suite-dot dot-${s.id}`} aria-hidden />
                    {suiteName(s, tier)}
                  </a>
                ))}
              </nav>
            </>
          )}
          <span className="topbar-spacer" />
          {!external && <SearchPalette user={user} tier={tier} />}
          {!external && <OfflinePill />}
          {!external && <CreditPill user={user} />}
          {!external && <NotificationBell />}
          {!external && <GoldenThreadTour />}
          <UserMenu user={user} tenant={tenant} tier={tier} tipsOn={assistant.enabled} onToggleTips={assistant.toggle} />
        </header>
        <div className="actionbar">
          <div className="actionbar-crumbs">
            <strong>{tr("Agera Platform")}</strong>
            <span className="sep" aria-hidden>›</span>
            <span id="actionbar-crumbs" className="crumbs-slot" data-fallback={external ? 'Client portal' : brand} />
          </div>
          <div className="actionbar-actions">
            {!external && <ClientPill />}
            <StatusPill />
            <OrgBadge user={user} tenant={tenant} />
            {!external && !tenant?.readOnly && <NewMenu suite={suite.id} user={user} tier={tier} onPick={(kind) => openNew(kind)} />}
          </div>
        </div>
        <div className="workspace">
          {external ? (
            <SideNav items={PORTAL_NAV} path={route.path} heading={tr("Client portal")} />
          ) : (
            <SideNav items={navFor(suite.id, user)} path={route.path} heading={`${brand} · ${suite.tagline}`} />
          )}
          <main>
            {preview && preview !== tenant?.licenseTier && (
              <p className="callout readonly-banner">
                {tr("Previewing the interface of")} <strong>{editionName(preview)}</strong>{tr(". Server-side limits still follow this organisation’s real edition.")}{' '}
                <button className="link-button" onClick={() => setPreviewTier(null)}>{tr("Stop preview")}</button>
              </p>
            )}
            {tenant?.readOnly && (
              <p className="callout readonly-banner">
                {tr("You are viewing")} <strong>{tenant.name}</strong>  {tr("read-only. Changes are only possible in your own organisation.")}{' '}
                <button className="link-button" onClick={() => switchOrganisation(null)}>{tr("Back to my organisation")}</button>
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
        {!external && <OfficeEditorHost />}
        {toast && <div className="toast" role="status">{toast}</div>}
      </div>
    </ShellContext.Provider>
  );
}
