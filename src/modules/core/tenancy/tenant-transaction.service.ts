import { Injectable } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';
import { TenantContext } from './tenant-context.service.js';

/**
 * Runs work in a transaction whose PostgreSQL setting `app.current_tenant` is the active tenant.
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
    const tenantId = this.context.tenantId;
    return this.dataSource.transaction(async (manager) => {
      await manager.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
      return work(manager);
    });
  }
}
