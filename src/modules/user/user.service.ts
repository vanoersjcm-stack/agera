import { ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { AuditService } from '../core/audit.service.js';
import { Tenant, User } from '../core/entities/index.js';

const PG_UNIQUE_VIOLATION = '23505';

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Tenant) private readonly tenants: Repository<Tenant>,
    private readonly audit: AuditService,
  ) {}

  async getOrProvision(identity: AuthenticatedUser): Promise<User> {
    const existing = await this.users.findOneBy({ keycloakId: identity.keycloakId });
    if (existing) {
      this.assertActive(existing);
      await this.audit.log({ tenantId: existing.tenantId, userId: existing.id, action: 'user.profile_fetched' });
      return existing;
    }

    const tenant = await this.resolveTenant(identity.email);
    const user = await this.provision(identity, tenant);
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.id,
      action: 'user.provisioned',
      details: { email: user.email },
    });
    return user;
  }

  private async resolveTenant(email: string): Promise<Tenant> {
    const domain = email.split('@')[1];
    const tenant = domain ? await this.tenants.findOneBy({ domain }) : null;
    if (!tenant) {
      throw new ForbiddenException('No tenant is registered for this email domain');
    }
    return tenant;
  }

  private async provision(identity: AuthenticatedUser, tenant: Tenant): Promise<User> {
    try {
      return await this.users.save(
        this.users.create({
          tenantId: tenant.id,
          keycloakId: identity.keycloakId,
          email: identity.email,
          firstName: identity.firstName,
          lastName: identity.lastName,
        }),
      );
    } catch (error) {
      if (error instanceof QueryFailedError && (error.driverError as { code?: string }).code === PG_UNIQUE_VIOLATION) {
        const concurrent = await this.users.findOneBy({ keycloakId: identity.keycloakId, tenantId: tenant.id });
        if (concurrent) {
          return concurrent;
        }
        throw new ConflictException('A user with this email already exists');
      }
      throw error;
    }
  }

  private assertActive(user: User): void {
    if (!user.isActive) {
      throw new ForbiddenException('User is deactivated');
    }
  }
}
