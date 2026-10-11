import { type CanActivate, type ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ALLOW_EXTERNAL } from './allow-external.decorator.js';
import type { AuthenticatedRequest } from './authenticated-user.js';
import { EXTERNAL_CLIENT_ROLE } from './roles.decorator.js';

/** Deny by default: External_Client users only reach endpoints marked with @AllowExternal(). */
@Injectable()
export class ExternalAccessGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const { user } = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!user?.roles.includes(EXTERNAL_CLIENT_ROLE)) {
      return true;
    }
    const allowed = this.reflector.getAllAndOverride<boolean | undefined>(ALLOW_EXTERNAL, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!allowed) {
      throw new ForbiddenException('Not available to external users');
    }
    return true;
  }
}
