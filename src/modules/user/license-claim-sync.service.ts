import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { TENANT_LICENSE_CHANGED_EVENT, type TenantLicenseChangedEvent } from '../core/tenants/tenants.service.js';
import { KeycloakAdminService } from './keycloak-admin.service.js';

export const TIER_ATTRIBUTE = 'tenant_license_tier';

/**
 * Keeps the Keycloak user attribute `tenant_license_tier` equal to the organisation's edition, so Keycloak
 * can put it in the access token. Keycloak cannot read our database, hence the copy.
 */
@Injectable()
export class LicenseClaimSyncService implements OnApplicationBootstrap {
  private readonly logger = new Logger(LicenseClaimSyncService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly keycloak: KeycloakAdminService,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.keycloak.configured) return;
    void this.reconcileAll().catch((error: unknown) => this.logger.warn(`Edition claim sync at startup failed: ${String(error)}`));
  }

  @OnEvent(TENANT_LICENSE_CHANGED_EVENT, { async: true, promisify: true })
  async onLicenseChanged(event: TenantLicenseChangedEvent): Promise<void> {
    if (!this.keycloak.configured) return;
    try {
      await this.syncTenant(event.tenantId, event.licenseTier);
    } catch (error) {
      this.logger.warn(`Edition claim sync for organisation ${event.tenantId} failed: ${String(error)}`);
    }
  }

  async reconcileAll(): Promise<void> {
    const tenants: { id: string; license_tier: string }[] = await this.dataSource.query('SELECT id, license_tier FROM tenants');
    for (const t of tenants) await this.syncTenant(t.id, t.license_tier);
  }

  private async syncTenant(tenantId: string, tier: string): Promise<void> {
    const users: { keycloak_id: string }[] = await this.dataSource.query('SELECT keycloak_id FROM users WHERE tenant_id = $1', [tenantId]);
    for (const u of users) {
      try {
        await this.keycloak.setAttribute(u.keycloak_id, TIER_ATTRIBUTE, tier);
      } catch (error) {
        this.logger.warn(`Could not set ${TIER_ATTRIBUTE} for Keycloak user ${u.keycloak_id}: ${String(error)}`);
      }
    }
  }
}
