import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import type { AuthenticatedUser } from '../../auth/authenticated-user.js';
import { AuditService } from '../audit/audit.service.js';
import { Tenant, User } from '../entities/index.js';
import { TenantContext } from '../tenancy/tenant-context.service.js';
import { TenantRepository } from '../tenancy/tenant-repository.js';

const PG_UNIQUE_VIOLATION = '23505';

export interface CreateTenantInput {
  name: string;
  domain: string;
}

@Injectable()
export class TenantsService {
  private readonly users: TenantRepository<User>;

  constructor(
    @InjectRepository(Tenant) private readonly tenants: Repository<Tenant>,
    @InjectRepository(User) users: Repository<User>,
    private readonly context: TenantContext,
    private readonly audit: AuditService,
  ) {
    this.users = new TenantRepository(users, context);
  }

  /** All organisations; for the platform-admin organisation switcher. */
  list(): Promise<Tenant[]> {
    return this.tenants.find({ order: { name: 'ASC' } });
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
