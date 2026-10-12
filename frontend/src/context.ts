import { keycloak, userRoles } from './auth';

export type Scope = 'internal' | 'external';

export interface UserContext {
  scope: Scope;
  /** Topbar context indicator, e.g. `[INTERN PLATFORM ADMIN]` or `[CLIENT DSR PORTAL]`. */
  label: string;
  clientId: string | null;
}

/** Derived from the token only: External_Client users are the client portal, everyone else is internal. */
export function userContext(): UserContext {
  const roles = userRoles();
  const clientId = (keycloak.tokenParsed?.client_id as string | undefined) ?? null;
  if (roles.includes('External_Client')) {
    return { scope: 'external', label: '[CLIENT DSR PORTAL]', clientId };
  }
  const label = roles.includes('platform-admin')
    ? '[INTERN PLATFORM ADMIN]'
    : roles.includes('admin')
      ? '[INTERN ADMIN]'
      : '[INTERN TEAM]';
  return { scope: 'internal', label, clientId: null };
}
