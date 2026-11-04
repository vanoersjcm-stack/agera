import type { LicenseTier } from './api';
import type { UserContext } from './context';

export type SuiteId = 'symphony' | 'nexus' | 'retailpower';

export interface Suite {
  id: SuiteId;
  name: string;
  tagline: string;
  home: string;
}

export const SUITES: Suite[] = [
  { id: 'symphony', name: 'Symphony', tagline: 'HQ & Governance', home: '/symphony' },
  { id: 'nexus', name: 'Nexus', tagline: 'Commercial & Client Portal', home: '/nexus' },
  { id: 'retailpower', name: 'RetailPower', tagline: 'Field & Shelf Execution', home: '/retailpower' },
];

export interface NavItem {
  path: string;
  label: string;
  description: string;
}

export function navFor(suite: SuiteId, user: UserContext): NavItem[] {
  switch (suite) {
    case 'symphony':
      return [
        { path: '/symphony', label: 'Overview', description: 'Key figures across all suites' },
        { path: '/symphony/prognosis', label: 'Prognosis', description: 'Run-rate waterfall with what-if sliders' },
        { path: '/symphony/invoices', label: 'Invoices', description: 'Record invoices, mark them sent or paid' },
        { path: '/symphony/credit-control', label: 'Credit control', description: 'Emergency credit locks per client or organisation-wide' },
        { path: '/symphony/approvals', label: 'Approvals', description: 'Approval chains waiting for you and all requests' },
        { path: '/symphony/health', label: 'Account health', description: 'Health score and engagement per client' },
        { path: '/symphony/automations', label: 'Automations', description: 'When something happens, notify someone or open an exception' },
        { path: '/symphony/reports', label: 'Reports', description: 'KPI dashboard, CSV exports and the report builder' },
        { path: '/symphony/clients', label: 'Client dossiers', description: 'Open360: master data, contacts, contracts and stores per client' },
        { path: '/symphony/activity', label: 'Activity log', description: 'Who did what, and when' },
        ...(user.role === 'admin' || user.isPlatformAdmin
          ? [{ path: '/symphony/people', label: 'People & access', description: 'Invite colleagues and clients, roles, deactivate accounts' }]
          : []),
        ...(user.isPlatformAdmin
          ? [
              { path: '/symphony/organisations', label: 'Organisations', description: 'Your organisation and new organisations' },
              { path: '/symphony/integrations', label: 'Integrations', description: 'Integration keys for external portals' },
              { path: '/symphony/connections', label: 'External systems', description: 'ERP, e-mail, OCR, voice and e-signature: not connected yet' },
            ]
          : []),
      ];
    case 'nexus':
      return [
        { path: '/nexus', label: 'Overview', description: 'Contract value, client rooms and alerts' },
        { path: '/nexus/clients', label: 'Clients', description: 'Client companies, contacts and their deals' },
        { path: '/nexus/pipeline', label: 'Deal pipeline', description: 'Deals per stage; move them forward with one click' },
        { path: '/nexus/deals', label: 'Deals', description: 'Deal list with filters, owners and due dates' },
        { path: '/nexus/agreements', label: 'Agreements', description: 'Client agreements and approvals' },
        { path: '/nexus/client-rooms', label: 'Client rooms', description: 'Online rooms per client deal, with engagement' },
        { path: '/nexus/financial-plans', label: 'Financial plans', description: 'Plans, plan lines and approval' },
        { path: '/nexus/profit-loss', label: 'Profit & loss', description: 'Plan versus actual per period' },
        { path: '/nexus/price-lists', label: 'Price lists', description: 'Client and volume prices on top of the catalogue' },
        { path: '/nexus/templates', label: 'Document templates', description: 'Proposals and letters filled with client data' },
        { path: '/nexus/exceptions', label: 'Exceptions', description: 'Issues with an owner, severity and resolution' },
        { path: '/nexus/alerts', label: 'Alerts', description: 'Plan deviations, inactive rooms, non-compliant stores' },
      ];
    case 'retailpower':
      return [
        { path: '/retailpower', label: 'Overview', description: 'Visits, open work orders and store compliance' },
        { path: '/retailpower/work-orders', label: 'Work orders', description: 'Field tasks, assignment and status' },
        { path: '/retailpower/store-visits', label: 'Store visits', description: 'Plan visits, write reports, add photos' },
        { path: '/retailpower/stores', label: 'Stores', description: 'Store list and compliance' },
        { path: '/retailpower/calendar', label: 'Field calendar', description: 'Visits per rep per day, with capacity warnings' },
        { path: '/retailpower/audit-rounds', label: 'Audit rounds', description: 'Plan visits to many stores with one checklist' },
        { path: '/retailpower/orders', label: 'Field orders', description: 'Orders taken in stores, draft to delivery' },
        { path: '/retailpower/products', label: 'Products', description: 'Product catalogue and prices' },
        { path: '/retailpower/planograms', label: 'Planograms', description: 'Expected shelf layouts and facings' },
      ];
  }
}

export const PORTAL_NAV: NavItem[] = [
  { path: '/portal', label: 'Overview', description: 'What Agera shares with you' },
  { path: '/portal/rooms', label: 'My client rooms', description: 'Rooms Agera opened for your organisation' },
  { path: '/portal/agreements', label: 'My agreements', description: 'Agreements and their status' },
];

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
