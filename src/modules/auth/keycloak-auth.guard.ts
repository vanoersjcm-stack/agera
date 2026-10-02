import { type CanActivate, type ExecutionContext, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { createRemoteJWKSet, type JWTPayload, jwtVerify } from 'jose';
import type { KeycloakConfig } from '../../config/configuration.js';
import type { AuthenticatedRequest, AuthenticatedUser } from './authenticated-user.js';
import { IS_PUBLIC_KEY } from './public.decorator.js';

interface KeycloakTokenPayload extends JWTPayload {
  email?: string;
  given_name?: string;
  family_name?: string;
  realm_access?: { roles?: string[] };
  resource_access?: Record<string, { roles?: string[] }>;
}

@Injectable()
export class KeycloakAuthGuard implements CanActivate {
  private readonly logger = new Logger(KeycloakAuthGuard.name);
  private readonly issuer: string;
  private readonly audience: string;
  private readonly jwks: ReturnType<typeof createRemoteJWKSet>;

  constructor(
    private readonly reflector: Reflector,
    config: ConfigService,
  ) {
    const keycloak = config.getOrThrow<KeycloakConfig>('keycloak');
    this.issuer = keycloak.realmUrl;
    this.audience = keycloak.clientId;
    this.jwks = createRemoteJWKSet(new URL(`${keycloak.realmUrl}/protocol/openid-connect/certs`));
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = this.extractBearerToken(request.headers.authorization);
    if (!token) {
      throw new UnauthorizedException('Missing bearer token');
    }

    let payload: KeycloakTokenPayload;
    try {
      ({ payload } = await jwtVerify<KeycloakTokenPayload>(token, this.jwks, {
        issuer: this.issuer,
        audience: this.audience,
      }));
    } catch (error) {
      this.logger.debug(`Token rejected: ${error instanceof Error ? error.message : String(error)}`);
      throw new UnauthorizedException('Invalid token');
    }

    if (!payload.sub || !payload.email) {
      throw new UnauthorizedException('Token is missing sub or email claim');
    }

    request.user = this.toAuthenticatedUser(payload, payload.sub, payload.email);
    return true;
  }

  private extractBearerToken(header: string | undefined): string | null {
    if (!header) {
      return null;
    }
    const [scheme, token] = header.split(' ');
    return scheme?.toLowerCase() === 'bearer' && token ? token : null;
  }

  private toAuthenticatedUser(payload: KeycloakTokenPayload, sub: string, email: string): AuthenticatedUser {
    const realmRoles = payload.realm_access?.roles ?? [];
    const clientRoles = payload.resource_access?.[this.audience]?.roles ?? [];
    return {
      keycloakId: sub,
      email: email.toLowerCase(),
      firstName: payload.given_name ?? null,
      lastName: payload.family_name ?? null,
      roles: [...new Set([...realmRoles, ...clientRoles])],
    };
  }
}
