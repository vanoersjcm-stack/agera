import { type CanActivate, type ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiKeysService } from '../api-keys/api-keys.service.js';
import { ALLOW_API_KEY } from './allow-api-key.decorator.js';
import type { AuthenticatedRequest } from './authenticated-user.js';

/** Authenticates `X-API-Key` on endpoints marked with @AllowApiKey(); the key's tenant becomes the active tenant. */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly apiKeys: ApiKeysService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = request.headers['x-api-key'];
    if (typeof header !== 'string' || header === '') {
      throw new UnauthorizedException('Missing API key');
    }
    const allowed = this.reflector.getAllAndOverride<boolean | undefined>(ALLOW_API_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!allowed) {
      throw new ForbiddenException('API keys are not accepted on this endpoint');
    }
    const apiKey = await this.apiKeys.authenticate(header);
    if (!apiKey) {
      throw new UnauthorizedException('Invalid or expired API key');
    }
    request.apiKey = { id: apiKey.id, tenantId: apiKey.tenantId, name: apiKey.name };
    return true;
  }
}
