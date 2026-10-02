import { ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { AuditService } from '../core/audit/audit.service.js';
import { User } from '../core/entities/index.js';
import { TenantContext } from '../core/tenancy/tenant-context.service.js';
import { TenantRepository } from '../core/tenancy/tenant-repository.js';

const PG_UNIQUE_VIOLATION = '23505';

@Injectable()
export class UserService {
  private readonly users: TenantRepository<User>;

  constructor(
    @InjectRepository(User) repository: Repository<User>,
    context: TenantContext,
    private readonly audit: AuditService,
  ) {
    this.users = new TenantRepository(repository, context);
  }

  async getOrProvision(identity: AuthenticatedUser): Promise<User> {
    const existing = await this.users.findOneBy({ keycloakId: identity.keycloakId });
    if (existing) {
      if (!existing.isActive) {
        throw new ForbiddenException('User is deactivated');
      }
      this.audit.logAction(existing.tenantId, existing.id, 'user.profile_fetched');
      return existing;
    }

    const user = await this.provision(identity);
    this.audit.logAction(user.tenantId, user.id, 'user.provisioned', { email: user.email });
    return user;
  }

  private async provision(identity: AuthenticatedUser): Promise<User> {
    try {
      return await this.users.save(
        this.users.create({
          keycloakId: identity.keycloakId,
          email: identity.email,
          firstName: identity.firstName,
          lastName: identity.lastName,
        }),
      );
    } catch (error) {
      if (error instanceof QueryFailedError && (error.driverError as { code?: string }).code === PG_UNIQUE_VIOLATION) {
        const concurrent = await this.users.findOneBy({ keycloakId: identity.keycloakId });
        if (concurrent) {
          return concurrent;
        }
        throw new ConflictException('This user is already registered under a different tenant');
      }
      throw error;
    }
  }
}
