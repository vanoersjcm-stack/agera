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
        { path: '/symphony/clients', label: 'Client dossiers', description: 'Open360: master data, contacts, contracts and stores per client' },
        { path: '/symphony/activity', label: 'Activity log', description: 'Who did what, and when' },
        ...(user.role === 'admin' || user.isPlatformAdmin
          ? [{ path: '/symphony/people', label: 'People & access', description: 'Invite colleagues and clients, roles, deactivate accounts' }]
          : []),
        ...(user.isPlatformAdmin
          ? [
              { path: '/symphony/organisations', label: 'Organisations', description: 'Your organisation and new organisations' },
              { path: '/symphony/integrations', label: 'Integrations', description: 'Integration keys for external portals' },
            ]
          : []),
      ];
    case 'nexus':
      return [
        { path: '/nexus', label: 'Overview', description: 'Contract value, client rooms and alerts' },
        { path: '/nexus/clients', label: 'Clients', description: 'Client companies, contacts and their deals' },
        { path: '/nexus/agreements', label: 'Agreements', description: 'Client agreements and approvals' },
        { path: '/nexus/client-rooms', label: 'Client rooms', description: 'Online rooms per client deal, with engagement' },
        { path: '/nexus/financial-plans', label: 'Financial plans', description: 'Plans, plan lines and approval' },
        { path: '/nexus/profit-loss', label: 'Profit & loss', description: 'Plan versus actual per period' },
        { path: '/nexus/alerts', label: 'Alerts', description: 'Plan deviations, inactive rooms, non-compliant stores' },
      ];
    case 'retailpower':
      return [
        { path: '/retailpower', label: 'Overview', description: 'Visits, open work orders and store compliance' },
        { path: '/retailpower/work-orders', label: 'Work orders', description: 'Field tasks, assignment and status' },
        { path: '/retailpower/store-visits', label: 'Store visits', description: 'Plan visits, write reports, add photos' },
        { path: '/retailpower/stores', label: 'Stores', description: 'Store list and compliance' },
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

/** Old bookmarks from the first web app version. */
export const LEGACY_ROUTES: Record<string, { internal: string; external: string }> = {
  '/dashboard': { internal: '/nexus', external: '/portal' },
  '/financials': { internal: '/nexus/profit-loss', external: '/portal' },
  '/dsr': { internal: '/nexus/client-rooms', external: '/portal/rooms' },
  '/rooms': { internal: '/nexus/client-rooms', external: '/portal/rooms' },
  '/anomalies': { internal: '/nexus/alerts', external: '/portal' },
};
