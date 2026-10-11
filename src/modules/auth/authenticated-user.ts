export interface AuthenticatedUser {
  keycloakId: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  roles: string[];
  tenantIdClaim: string | null;
  /** `client_id` claim of external users (role External_Client). */
  clientIdClaim: string | null;
}

/** Machine client authenticated with an `X-API-Key` header; bound to exactly one tenant. */
export interface ApiKeyPrincipal {
  id: string;
  tenantId: string;
  name: string;
}

export interface AuthenticatedRequest {
  headers: { authorization?: string; 'x-api-key'?: string | string[] };
  user?: AuthenticatedUser;
  apiKey?: ApiKeyPrincipal;
}
