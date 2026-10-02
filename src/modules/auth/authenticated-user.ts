export interface AuthenticatedUser {
  keycloakId: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  roles: string[];
  tenantIdClaim: string | null;
}

export interface AuthenticatedRequest {
  headers: { authorization?: string };
  user?: AuthenticatedUser;
}
