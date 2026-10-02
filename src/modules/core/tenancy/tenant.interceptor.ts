import { type CallHandler, type ExecutionContext, Injectable, type NestInterceptor } from '@nestjs/common';
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
    const { user, apiKey } = context.switchToHttp().getRequest<AuthenticatedRequest>();
    let tenant: ActiveTenant;
    if (user) {
      tenant = await this.resolver.resolve(user);
    } else if (apiKey) {
      tenant = await this.resolver.resolveApiKey(apiKey);
    } else {
      return next.handle();
    }
    return new Observable((subscriber) => this.context.run(tenant, () => next.handle().subscribe(subscriber)));
  }
}
