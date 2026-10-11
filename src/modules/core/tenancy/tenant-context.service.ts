import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable } from '@nestjs/common';

export type TenantSource = 'claim' | 'domain' | 'apiKey';

/** Row-level security scope within the tenant; mirrored into `app.access_scope` / `app.current_client`. */
export type TenantAccess = { scope: 'internal' } | { scope: 'external'; clientId: string } | { scope: 'apiKey' };

export interface ActiveTenant {
  id: string;
  name: string;
  domain: string;
  source: TenantSource;
  access: TenantAccess;
}

@Injectable()
export class TenantContext {
  private readonly storage = new AsyncLocalStorage<ActiveTenant>();

  run<T>(tenant: ActiveTenant, fn: () => T): T {
    return this.storage.run(tenant, fn);
  }

  get tenant(): ActiveTenant {
    const tenant = this.storage.getStore();
    if (!tenant) {
      throw new Error('No active tenant in the current execution context');
    }
    return tenant;
  }

  get tenantId(): string {
    return this.tenant.id;
  }
}
