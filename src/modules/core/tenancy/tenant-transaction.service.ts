import { Injectable } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';
import { type ActiveTenant, TenantContext } from './tenant-context.service.js';

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
    const tenant = this.context.tenant;
    return this.dataSource.transaction(async (manager) => {
      await applyTenantSettings(manager, tenant);
      return work(manager);
    });
  }

  /**
   * Cross-tenant system work (API-key lookup, platform administration): `app.access_scope = 'system'`
   * with no tenant. Only tables whose policies allow app_is_system() are visible.
   */
  runAsSystem<T>(work: (manager: EntityManager) => Promise<T>): Promise<T> {
    return runAsSystem(this.dataSource, work);
  }

  /** Background work for a known tenant outside a request (event listeners, scheduled jobs). */
  runForTenant<T>(tenantId: string, work: (manager: EntityManager) => Promise<T>): Promise<T> {
    return runForTenant(this.dataSource, tenantId, work);
  }
}

/** Sets the transaction-local RLS settings for a tenant; must run inside a transaction. */
export async function applyTenantSettings(manager: EntityManager, tenant: Pick<ActiveTenant, 'id' | 'access'>): Promise<void> {
  const clientId = tenant.access.scope === 'external' ? tenant.access.clientId : '';
  await manager.query(
    `SELECT set_config('app.current_tenant', $1, true),
            set_config('app.access_scope', $2, true),
            set_config('app.current_client', $3, true)`,
    [tenant.id, tenant.access.scope, clientId],
  );
}

export function runForTenant<T>(source: DataSource | EntityManager, tenantId: string, work: (manager: EntityManager) => Promise<T>): Promise<T> {
  return source.transaction(async (manager) => {
    await applyTenantSettings(manager, { id: tenantId, access: { scope: 'internal' } });
    return work(manager);
  });
}

export function runAsSystem<T>(source: DataSource | EntityManager, work: (manager: EntityManager) => Promise<T>): Promise<T> {
  return source.transaction(async (manager) => {
    await manager.query(`SELECT set_config('app.current_tenant', '', true), set_config('app.access_scope', 'system', true), set_config('app.current_client', '', true)`);
    return work(manager);
  });
}
