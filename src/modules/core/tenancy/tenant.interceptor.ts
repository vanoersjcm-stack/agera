import { type CallHandler, type ExecutionContext, Injectable, type NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import type { AuthenticatedRequest } from '../../auth/authenticated-user.js';
import { TenantContext } from './tenant-context.service.js';
import { TenantResolver } from './tenant-resolver.service.js';

@Injectable()
export class TenantInterceptor implements NestInterceptor {
  constructor(
    private readonly resolver: TenantResolver,
    private readonly context: TenantContext,
  ) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const { user } = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!user) {
      return next.handle();
    }
    const tenant = await this.resolver.resolve(user);
    return new Observable((subscriber) => this.context.run(tenant, () => next.handle().subscribe(subscriber)));
  }
}
