import { keycloak, userRoles } from './auth';
import type { UserRole } from './api';
import { ROLE } from './labels';

export type Scope = 'internal' | 'external';

export interface UserContext {
  scope: Scope;
  role: UserRole | 'client';
  /** Plain-language role shown in the user menu, e.g. "Administrator" or "Client contact". */
  roleLabel: string;
  isPlatformAdmin: boolean;
  clientId: string | null;
}

/** Derived from the token only: External_Client users get the client portal, everyone else is internal. */
export function userContext(): UserContext {
  const roles = userRoles();
  const clientId = (keycloak.tokenParsed?.client_id as string | undefined) ?? null;
  if (roles.includes('External_Client')) {
    return { scope: 'external', role: 'client', roleLabel: 'Client contact', isPlatformAdmin: false, clientId };
  }
  const role: UserRole = roles.includes('platform-admin') ? 'platform-admin' : roles.includes('admin') ? 'admin' : 'user';
  return { scope: 'internal', role, roleLabel: ROLE[role], isPlatformAdmin: role === 'platform-admin', clientId: null };
}

export function displayName(): string {
  const t = keycloak.tokenParsed as { name?: string; given_name?: string; family_name?: string; email?: string } | undefined;
  return t?.name || [t?.given_name, t?.family_name].filter(Boolean).join(' ') || t?.email || 'Signed-in user';
}
