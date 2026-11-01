import { type CallHandler, type ExecutionContext, ForbiddenException, Injectable, type NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import type { AuthenticatedRequest } from '../../auth/authenticated-user.js';
import { type ActiveTenant, TenantContext } from './tenant-context.service.js';
import { TenantResolver } from './tenant-resolver.service.js';

@Injectable()
export class TenantInterceptor implements NestInterceptor {
  constructor(
    private readonly resolver: TenantResolver,
    private readonly context: TenantContext,
  ) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest & { method: string; headers: Record<string, string | string[] | undefined> }>();
    const { user, apiKey } = request;
    let tenant: ActiveTenant;
    if (user) {
      const header = request.headers['x-agera-organisation'];
      tenant = await this.resolver.resolve(user, Array.isArray(header) ? header[0] : header);
      if (tenant.readOnly && !['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
        throw new ForbiddenException('Read-only: you are viewing another organisation. Switch back to your own organisation to make changes.');
      }
    } else if (apiKey) {
      tenant = await this.resolver.resolveApiKey(apiKey);
    } else {
      return next.handle();
    }
    return new Observable((subscriber) => this.context.run(tenant, () => next.handle().subscribe(subscriber)));
  }
}
