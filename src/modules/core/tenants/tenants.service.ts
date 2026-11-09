import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import type { AuthenticatedUser } from '../../auth/authenticated-user.js';
import { AuditService } from '../audit/audit.service.js';
import { Tenant, User } from '../entities/index.js';
import { type LicenseTier, VANGUARD_DEFAULT_SEATS } from '../entities/tenant.entity.js';
import { distrustTierClaims } from '../tenancy/license.js';
import { TenantContext } from '../tenancy/tenant-context.service.js';
import { TenantRepository } from '../tenancy/tenant-repository.js';
import { runForTenant } from '../tenancy/tenant-transaction.service.js';

const PG_UNIQUE_VIOLATION = '23505';

export const TENANT_LICENSE_CHANGED_EVENT = 'tenant.license_changed';
export interface TenantLicenseChangedEvent {
  tenantId: string;
  licenseTier: LicenseTier;
}

export interface CreateTenantInput {
  name: string;
  domain: string;
  licenseTier: LicenseTier;
  maxSeats: number | null;
}

@Injectable()
export class TenantsService {
  private readonly users: TenantRepository<User>;

  constructor(
    @InjectRepository(Tenant) private readonly tenants: Repository<Tenant>,
    @InjectRepository(User) users: Repository<User>,
    private readonly context: TenantContext,
    private readonly audit: AuditService,
    private readonly events: EventEmitter2,
  ) {
    this.users = new TenantRepository(users, context);
  }

  /** All organisations; for the platform-admin organisation switcher. */
  list(): Promise<Tenant[]> {
    return this.tenants.find({ order: { name: 'ASC' } });
  }

  /** Active internal users of the active tenant (seats in use). */
  activeSeats(tenantId: string): Promise<number> {
    return runForTenant(this.tenants.manager, tenantId, (m) =>
      m.query(`SELECT count(*)::int AS n FROM users WHERE tenant_id = $1 AND is_active AND NOT ('External_Client' = ANY (realm_roles))`, [tenantId]),
    ).then((r: { n: number }[]) => r[0]?.n ?? 0);
  }

  /** Upgrade/downgrade path: changing the tier switches branding and limits in place, without data migration. */
  async setLicense(id: string, licenseTier: LicenseTier, maxSeats: number | null | undefined, actor: AuthenticatedUser): Promise<Tenant> {
    const tenant = await this.tenants.findOneBy({ id });
    if (!tenant) throw new NotFoundException('Organisation not found');
    const previous = { licenseTier: tenant.licenseTier, maxSeats: tenant.maxSeats };
    tenant.licenseTier = licenseTier;
    tenant.maxSeats = maxSeats !== undefined ? maxSeats : licenseTier === 'vanguard' ? VANGUARD_DEFAULT_SEATS : null;
    await this.tenants.save(tenant);
    distrustTierClaims(id);
    this.events.emit(TENANT_LICENSE_CHANGED_EVENT, { tenantId: id, licenseTier: tenant.licenseTier } satisfies TenantLicenseChangedEvent);
    const actorRecord = await this.users.findOneBy({ keycloakId: actor.keycloakId });
    this.audit.logAction(this.context.tenantId, actorRecord?.id ?? null, 'tenant.license_changed', {
      tenantId: id,
      from: previous,
      to: { licenseTier: tenant.licenseTier, maxSeats: tenant.maxSeats },
    });
    return tenant;
  }

  async getActive(): Promise<Tenant> {
    const tenant = await this.tenants.findOneBy({ id: this.context.tenantId });
    if (!tenant) {
      throw new NotFoundException('Active tenant no longer exists');
    }
    return tenant;
  }

  async create(input: CreateTenantInput, actor: AuthenticatedUser): Promise<Tenant> {
    let tenant: Tenant;
    try {
      tenant = await this.tenants.save(this.tenants.create(input));
    } catch (error) {
      if (error instanceof QueryFailedError && (error.driverError as { code?: string }).code === PG_UNIQUE_VIOLATION) {
        throw new ConflictException('A tenant with this domain already exists');
      }
      throw error;
    }

    const actorRecord = await this.users.findOneBy({ keycloakId: actor.keycloakId });
    this.audit.logAction(this.context.tenantId, actorRecord?.id ?? null, 'tenant.created', {
      createdTenantId: tenant.id,
      domain: tenant.domain,
      actorKeycloakId: actor.keycloakId,
    });
    return tenant;
  }
}
