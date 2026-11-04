export interface AuthenticatedUser {
  keycloakId: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  roles: string[];
  tenantIdClaim: string | null;
  /** `client_id` claim of external users (role External_Client). */
  clientIdClaim: string | null;
  /** `tenant_license_tier` claim (edition of the user's own organisation). */
  licenseTierClaim?: 'vanguard' | 'symphony' | null;
  /** Token issue time (ms), to ignore a tier claim issued before an edition change. */
  issuedAtMs?: number | null;
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
