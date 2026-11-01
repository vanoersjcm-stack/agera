import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { KeycloakConfig } from '../../config/configuration.js';

export interface KeycloakUserInput {
  email: string;
  firstName: string;
  lastName: string;
  attributes: Record<string, string[]>;
}

export class KeycloakRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Minimal Keycloak Admin REST client. Authenticates as the service account of the
 * agera-backend client, which needs realm-management roles manage-users, view-users and query-users.
 */
@Injectable()
export class KeycloakAdminService {
  private readonly logger = new Logger(KeycloakAdminService.name);
  private readonly realmBase: string;
  private readonly adminBase: string;
  private token: { value: string; expiresAt: number } | null = null;

  constructor(private readonly config: ConfigService) {
    const kc = this.settings();
    this.realmBase = kc.jwksUrl.replace(/\/protocol\/openid-connect\/certs$/, '');
    this.adminBase = this.realmBase.replace(/\/realms\//, '/admin/realms/');
  }

  private settings(): KeycloakConfig {
    return this.config.getOrThrow<KeycloakConfig>('keycloak');
  }

  get configured(): boolean {
    return !!this.settings().clientSecret;
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 10_000) {
      return this.token.value;
    }
    const kc = this.settings();
    if (!kc.clientSecret) {
      throw new ServiceUnavailableException('User management is not configured (KEYCLOAK_CLIENT_SECRET is missing)');
    }
    const response = await fetch(`${this.realmBase}/protocol/openid-connect/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: kc.clientId, client_secret: kc.clientSecret }),
    });
    if (!response.ok) {
      this.logger.error(`Keycloak service-account login failed with HTTP ${response.status}`);
      throw new ServiceUnavailableException('User management is unavailable: the identity service rejected the backend');
    }
    const body = (await response.json()) as { access_token: string; expires_in: number };
    this.token = { value: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
    return body.access_token;
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<{ status: number; data: T; location: string | null }> {
    const response = await fetch(`${this.adminBase}${path}`, {
      method,
      headers: { authorization: `Bearer ${await this.accessToken()}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (response.status === 401 || response.status === 403) {
      this.token = null;
      this.logger.error(`Keycloak admin API returned ${response.status} for ${method} ${path}`);
      throw new ServiceUnavailableException('User management is unavailable: the backend lacks Keycloak user-management rights');
    }
    if (!response.ok) {
      const text = await response.text();
      throw new KeycloakRequestError(response.status, text || `Keycloak returned HTTP ${response.status}`);
    }
    const text = await response.text();
    return { status: response.status, data: (text ? JSON.parse(text) : undefined) as T, location: response.headers.get('location') };
  }

  async createUser(input: KeycloakUserInput, temporaryPassword: string): Promise<string> {
    const { location } = await this.call('POST', '/users', {
      username: input.email,
      email: input.email,
      emailVerified: true,
      enabled: true,
      firstName: input.firstName,
      lastName: input.lastName,
      attributes: input.attributes,
      credentials: [{ type: 'password', value: temporaryPassword, temporary: true }],
    });
    const id = location?.split('/').pop();
    if (!id) {
      throw new KeycloakRequestError(500, 'Keycloak did not return the new user id');
    }
    return id;
  }

  async getUser(id: string): Promise<{ id: string; enabled: boolean; attributes?: Record<string, string[]> }> {
    return (await this.call<{ id: string; enabled: boolean; attributes?: Record<string, string[]> }>('GET', `/users/${id}`)).data;
  }

  async setEnabled(id: string, enabled: boolean): Promise<void> {
    await this.call('PUT', `/users/${id}`, { enabled });
  }

  async deleteUser(id: string): Promise<void> {
    await this.call('DELETE', `/users/${id}`);
  }

  async realmRoles(id: string): Promise<string[]> {
    return (await this.call<{ name: string }[]>('GET', `/users/${id}/role-mappings/realm`)).data.map((r) => r.name);
  }

  /** Replaces the user's roles within `managed` by `target`; other realm roles are kept. */
  async setRealmRoles(id: string, target: readonly string[], managed: readonly string[]): Promise<void> {
    const current = await this.call<{ id: string; name: string }[]>('GET', `/users/${id}/role-mappings/realm`);
    const remove = current.data.filter((r) => managed.includes(r.name) && !target.includes(r.name));
    const missing = target.filter((name) => !current.data.some((r) => r.name === name));
    if (remove.length > 0) {
      await this.call('DELETE', `/users/${id}/role-mappings/realm`, remove);
    }
    if (missing.length > 0) {
      // The available-roles listing only needs user-management rights (GET /roles would need view-realm).
      const available = await this.call<{ id: string; name: string }[]>('GET', `/users/${id}/role-mappings/realm/available`);
      const roles = missing.map((name) => {
        const role = available.data.find((r) => r.name === name);
        if (!role) throw new KeycloakRequestError(500, `Realm role ${name} does not exist`);
        return role;
      });
      await this.call('POST', `/users/${id}/role-mappings/realm`, roles);
    }
  }
}
