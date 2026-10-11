import Keycloak from 'keycloak-js';

// Production: Keycloak sits behind the same proxy under /auth. Development: Keycloak on :8080.
const keycloakUrl =
  import.meta.env.VITE_KEYCLOAK_URL ?? (import.meta.env.DEV ? 'http://localhost:8080' : `${window.location.origin}/auth`);

export const keycloak = new Keycloak({ url: keycloakUrl, realm: 'agera', clientId: 'agera-frontend' });

export async function initAuth(): Promise<void> {
  await keycloak.init({ onLoad: 'login-required', pkceMethod: 'S256', checkLoginIframe: false });
}

export async function accessToken(): Promise<string> {
  await keycloak.updateToken(30);
  if (!keycloak.token) {
    throw new Error('Not logged in');
  }
  return keycloak.token;
}

export function userRoles(): string[] {
  return keycloak.tokenParsed?.realm_access?.roles ?? [];
}
