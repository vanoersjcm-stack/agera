import { Injectable } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';
import { TenantContext } from './tenant-context.service.js';

/**
 * Runs work in a transaction whose PostgreSQL settings `app.current_tenant`, `app.access_scope` and
 * `app.current_client` describe the active tenant and the caller's access scope.
 * Tables protected by row-level security must only be accessed through `run`. The setting is
 * transaction-local (`set_config(..., true)`), so it is cleared on commit or rollback and cannot
 * leak to another request that reuses the pooled connection.
 */
@Injectable()
export class TenantTransaction {
  constructor(
    private readonly dataSource: DataSource,
    private readonly context: TenantContext,
  ) {}

  run<T>(work: (manager: EntityManager) => Promise<T>): Promise<T> {
    const { id: tenantId, access } = this.context.tenant;
    const clientId = access.scope === 'external' ? access.clientId : '';
    return this.dataSource.transaction(async (manager) => {
      await manager.query(
        `SELECT set_config('app.current_tenant', $1, true),
                set_config('app.access_scope', $2, true),
                set_config('app.current_client', $3, true)`,
        [tenantId, access.scope, clientId],
      );
      return work(manager);
    });
  }
}
