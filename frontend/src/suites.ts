import type { LicenseTier } from './api';
import type { UserContext } from './context';
import { t, live } from './i18n';

export type SuiteId = 'symphony' | 'nexus' | 'retailpower';

export interface Suite {
  id: SuiteId;
  name: string;
  tagline: string;
  home: string;
}

export const SUITES: Suite[] = live(() => ([
  { id: 'symphony', name: 'Symphony', tagline: t("HQ & Governance"), home: '/symphony' },
  { id: 'nexus', name: 'Nexus', tagline: t("Commercial & Client Portal"), home: '/nexus' },
  { id: 'retailpower', name: 'RetailPower', tagline: t("Field & Shelf Execution"), home: '/retailpower' },
]));

export interface NavItem {
  path: string;
  label: string;
  description: string;
}

/** Suites the user's job role may open; accounts with only a legacy role see all three. */
export function suitesFor(user: UserContext): Suite[] {
  if (user.jobRole === 'FIELD_REPRESENTATIVE') return SUITES.filter((s) => s.id === 'retailpower');
  return SUITES;
}

/** Suites the job role may only read; the backend refuses changes there. */
export function readOnlySuite(suite: SuiteId, user: UserContext): boolean {
  if (user.jobRole === 'HQ_ADMIN') return suite !== 'symphony';
  if (user.jobRole === 'ACCOUNT_MANAGER') return suite !== 'nexus';
  return false;
}

const MANAGER_HIDDEN = new Set(['/symphony/credit-control', '/symphony/automations', '/symphony/activity', '/symphony/retention']);

export function navFor(suite: SuiteId, user: UserContext): NavItem[] {
  const items = navItems(suite, user);
  return user.jobRole === 'ACCOUNT_MANAGER' ? items.filter((i) => !MANAGER_HIDDEN.has(i.path)) : items;
}

function navItems(suite: SuiteId, user: UserContext): NavItem[] {
  switch (suite) {
    case 'symphony':
      return [
        { path: '/symphony', label: t("Overview"), description: t("Key figures across all suites") },
        { path: '/symphony/prognosis', label: t("Prognosis"), description: t("Run-rate waterfall with what-if sliders") },
        { path: '/symphony/invoices', label: t("Invoices"), description: t("Record invoices, mark them sent or paid") },
        { path: '/symphony/credit-control', label: t("Credit control"), description: t("Emergency credit locks per client or organisation-wide") },
        { path: '/symphony/approvals', label: t("Approvals"), description: t("Approval chains waiting for you and all requests") },
        { path: '/symphony/health', label: t("Account health"), description: t("Health score and engagement per client") },
        { path: '/symphony/feedback', label: t("Customer feedback"), description: t("Client NPS and survey results across all accounts") },
        { path: '/symphony/automations', label: t("Automations"), description: t("When something happens, notify someone or open an exception") },
        { path: '/symphony/reports', label: t("Reports"), description: t("KPI dashboard, CSV exports and the report builder") },
        { path: '/symphony/clients', label: t("Client dossiers"), description: t("Open360: master data, contacts, contracts and stores per client") },
        { path: '/symphony/third-parties', label: t("Third parties"), description: t("Vendors, advisers, banks, landlords and other relations, with A–Z filter") },
        { path: '/symphony/activity', label: t("Activity log"), description: t("Who did what, and when") },
        { path: '/symphony/retention', label: t("Retention & erasure"), description: t("Document lifecycle, retention periods and GDPR erasure") },
        ...(user.role === 'admin' || user.isPlatformAdmin
          ? [{ path: '/symphony/people', label: t("People & access"), description: t("Invite colleagues and clients, roles, deactivate accounts") }]
          : []),
        ...(user.isPlatformAdmin || user.role === 'admin' || user.jobRole === 'ACCOUNT_MANAGER'
          ? [{ path: '/symphony/integrations', label: t("Integrations"), description: t("Integration keys for external portals and the party that uses each") }]
          : []),
        ...(user.isPlatformAdmin
          ? [
              { path: '/symphony/organisations', label: t("Organisations"), description: t("Your organisation and new organisations") },
              { path: '/symphony/connections', label: t("External systems"), description: t("ERP, e-mail, OCR, voice and e-signature: not connected yet") },
            ]
          : []),
      ];
    case 'nexus':
      return [
        { path: '/nexus', label: t("Overview"), description: t("Contract value, client rooms and alerts") },
        { path: '/nexus/clients', label: t("Clients"), description: t("Client companies, contacts and their deals") },
        { path: '/nexus/third-parties', label: t("Third parties"), description: t("Vendors, advisers, banks, landlords and other relations, with A–Z filter") },
        { path: '/nexus/pipeline', label: t("Deal pipeline"), description: t("Deals per stage; move them forward with one click") },
        { path: '/nexus/deals', label: t("Deals"), description: t("Deal list with filters, owners and due dates") },
        { path: '/nexus/agreements', label: t("Agreements"), description: t("Client agreements and approvals") },
        { path: '/nexus/client-rooms', label: t("Client rooms"), description: t("Online rooms per client deal, with engagement") },
        { path: '/nexus/financial-plans', label: t("Financial plans"), description: t("Plans, plan lines and approval") },
        { path: '/nexus/profit-loss', label: t("Profit & loss"), description: t("Plan versus actual per period") },
        { path: '/nexus/price-lists', label: t("Price lists"), description: t("Client and volume prices on top of the catalogue") },
        { path: '/nexus/templates', label: t("Document templates"), description: t("Proposals and letters filled with client data") },
        { path: '/nexus/exceptions', label: t("Exceptions"), description: t("Issues with an owner, severity and resolution") },
        { path: '/nexus/alerts', label: t("Alerts"), description: t("Plan deviations, inactive rooms, non-compliant stores") },
        { path: '/nexus/mail-merge', label: t("ManyMail"), description: t("Personalised e-mail to a group of clients from a template") },
        { path: '/nexus/print', label: t("Print & Scan"), description: t("Pull printing with a release code, and scans into the client's document vault") },
        { path: '/nexus/surveys', label: t("Surveys & feedback"), description: t("Design surveys, send them to clients and see the answers") },
      ];
    case 'retailpower':
      return [
        { path: '/retailpower', label: t("Overview"), description: t("Visits, open work orders and store compliance") },
        { path: '/retailpower/back-office', label: t("Back office"), description: t("Chain performance, KPIs across chains and the photo audit gallery") },
        { path: '/retailpower/crew', label: t("Crew directory"), description: t("Merchandisers by availability, contract, language and brand certification") },
        { path: '/retailpower/hours', label: t("Validated hours"), description: t("Clock in/out, coordinator sign-off and HR export") },
        { path: '/retailpower/fleet', label: t("Fleet, apparel & returns"), description: t("Vehicles with a four-photo check, apparel, RMA and stock-protection claims") },
        { path: '/retailpower/work-orders', label: t("Work orders"), description: t("Field tasks, assignment and status") },
        { path: '/retailpower/store-visits', label: t("Store visits"), description: t("Plan visits, write reports, add photos") },
        { path: '/retailpower/stores', label: t("Stores"), description: t("Store list and compliance") },
        { path: '/retailpower/calendar', label: t("Field calendar"), description: t("Visits per rep per day, with capacity warnings") },
        { path: '/retailpower/audit-rounds', label: t("Audit rounds"), description: t("Plan visits to many stores with one checklist") },
        { path: '/retailpower/orders', label: t("Field orders"), description: t("Orders taken in stores, draft to delivery") },
        { path: '/retailpower/products', label: t("Products"), description: t("Product catalogue and prices") },
        { path: '/retailpower/planograms', label: t("Planograms"), description: t("Expected shelf layouts and facings") },
        { path: '/retailpower/scan', label: t("Scan to vault"), description: t("Photograph or upload a signed form; it is stored with the client as a Draft document") },
      ];
  }
}

export const PORTAL_NAV: NavItem[] = live(() => ([
  { path: '/portal', label: t("Overview"), description: t("What Agera shares with you") },
  { path: '/portal/rooms', label: t("My client rooms"), description: t("Rooms Agera opened for your organisation") },
  { path: '/portal/agreements', label: t("My agreements"), description: t("Agreements and their status") },
  { path: '/portal/surveys', label: t("Surveys"), description: t("Questions from Agera about our service") },
]));

const SUITE_KEY = 'agera.suite';

export function rememberSuite(id: SuiteId): void {
  localStorage.setItem(SUITE_KEY, id);
}

export function lastSuite(): Suite {
  const id = localStorage.getItem(SUITE_KEY);
  return SUITES.find((s) => s.id === id) ?? SUITES[0];
}

/**
 * Vanguard is the mid-market edition (25–50 seats) of Symphony, not a separate suite: for a Vanguard
 * organisation the HQ suite is branded "Vanguard" and Symphony branding is suppressed.
 */
export function suiteName(suite: Suite, tier: LicenseTier): string {
  return suite.id === 'symphony' && tier === 'vanguard' ? 'Vanguard' : suite.name;
}

export function editionName(tier: LicenseTier): string {
  return tier === 'vanguard' ? 'Agera Vanguard (mid-market edition)' : 'Agera Symphony (Enterprise edition)';
}

const PREVIEW_KEY = 'agera.previewTier';
let activeTier: LicenseTier = 'symphony';

/** Platform admins can preview the interface of the other edition ("View as Vanguard / Enterprise"). */
export function previewTier(): LicenseTier | null {
  const v = sessionStorage.getItem(PREVIEW_KEY);
  return v === 'vanguard' || v === 'symphony' ? v : null;
}

export function setPreviewTier(tier: LicenseTier | null): void {
  if (tier) sessionStorage.setItem(PREVIEW_KEY, tier);
  else sessionStorage.removeItem(PREVIEW_KEY);
  window.location.reload();
}

export function setActiveTier(tier: LicenseTier): void {
  activeTier = tier;
}

/** Brand-aware label for breadcrumbs that name the HQ suite. */
export function brandLabel(label: string): string {
  return label === 'Symphony' && activeTier === 'vanguard' ? 'Vanguard' : label;
}

/** Old bookmarks from the first web app version. */
export const LEGACY_ROUTES: Record<string, { internal: string; external: string }> = {
  '/dashboard': { internal: '/nexus', external: '/portal' },
  '/vanguard': { internal: '/nexus/pipeline', external: '/portal' },
  '/vanguard/deals': { internal: '/nexus/deals', external: '/portal' },
  '/financials': { internal: '/nexus/profit-loss', external: '/portal' },
  '/dsr': { internal: '/nexus/client-rooms', external: '/portal/rooms' },
  '/rooms': { internal: '/nexus/client-rooms', external: '/portal/rooms' },
  '/anomalies': { internal: '/nexus/alerts', external: '/portal' },
};

/** Edition the screens are currently showing (the organisation's, or the platform-admin preview). */
export function currentTier(): LicenseTier {
  return activeTier;
}

export type TopicId = 'overview' | 'finance' | 'clients' | 'thirdparties' | 'workflow' | 'governance' | 'sales' | 'documents' | 'issues' | 'field' | 'stores' | 'people' | 'fleet';

export interface NavTopic {
  id: TopicId;
  label: string;
  items: NavItem[];
}

const TOPICS: Record<SuiteId, [TopicId, string, string[]][]> = {
  symphony: [
    ['overview', 'Overview', ['/symphony']],
    ['finance', 'Finance', ['/symphony/prognosis', '/symphony/invoices', '/symphony/credit-control', '/symphony/reports']],
    ['clients', 'Clients', ['/symphony/clients', '/symphony/health', '/symphony/feedback']],
    ['thirdparties', 'Third parties', ['/symphony/third-parties']],
    ['workflow', 'Workflow', ['/symphony/approvals', '/symphony/automations']],
    ['governance', 'Governance & admin', ['/symphony/activity', '/symphony/retention', '/symphony/people', '/symphony/organisations', '/symphony/integrations', '/symphony/connections']],
  ],
  nexus: [
    ['overview', 'Overview', ['/nexus']],
    ['clients', 'Clients', ['/nexus/clients', '/nexus/client-rooms', '/nexus/surveys']],
    ['thirdparties', 'Third parties', ['/nexus/third-parties']],
    ['sales', 'Sales', ['/nexus/pipeline', '/nexus/deals', '/nexus/agreements', '/nexus/price-lists']],
    ['finance', 'Finance', ['/nexus/financial-plans', '/nexus/profit-loss']],
    ['documents', 'Documents & mail', ['/nexus/templates', '/nexus/mail-merge', '/nexus/print']],
    ['issues', 'Issues', ['/nexus/exceptions', '/nexus/alerts']],
  ],
  retailpower: [
    ['overview', 'Overview', ['/retailpower', '/retailpower/back-office']],
    ['field', 'Field work', ['/retailpower/work-orders', '/retailpower/store-visits', '/retailpower/calendar', '/retailpower/audit-rounds', '/retailpower/scan']],
    ['stores', 'Stores & products', ['/retailpower/stores', '/retailpower/products', '/retailpower/planograms', '/retailpower/orders']],
    ['people', 'People', ['/retailpower/crew', '/retailpower/hours']],
    ['fleet', 'Fleet & returns', ['/retailpower/fleet']],
  ],
};

/** The suite menu grouped into topics; a topic the role has no items in is left out, unlisted items land in a last topic. */
export function topicsFor(suite: SuiteId, user: UserContext): NavTopic[] {
  const items = navFor(suite, user);
  const byPath = new Map(items.map((i) => [i.path, i]));
  const topics = TOPICS[suite].map(([id, label, paths]) => ({
    id,
    label: t(label),
    items: paths.map((p) => byPath.get(p)).filter((i): i is NavItem => !!i),
  }));
  const listed = new Set(TOPICS[suite].flatMap(([, , paths]) => paths));
  const rest = items.filter((i) => !listed.has(i.path));
  if (rest.length) topics[topics.length - 1].items.push(...rest);
  return topics.filter((tp) => tp.items.length > 0);
}
