import { ConflictException, ForbiddenException, Injectable , NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { EXTERNAL_CLIENT_ROLE } from '../auth/roles.decorator.js';
import { AuditService } from '../core/audit/audit.service.js';
import { User } from '../core/entities/index.js';
import { TenantContext } from '../core/tenancy/tenant-context.service.js';
import { TenantRepository } from '../core/tenancy/tenant-repository.js';

const PG_UNIQUE_VIOLATION = '23505';

function sameRoles(stored: string[] | null | undefined, current: string[]): boolean {
  const a = [...(stored ?? [])].sort();
  const b = [...current].sort();
  return a.length === b.length && a.every((role, i) => role === b[i]);
}

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
    const { user, provisioned } = await this.ensure(identity);
    if (!provisioned) {
      this.audit.logAction(user.tenantId, user.id, 'user.profile_fetched');
    }
    return user;
  }

  /** Returns the caller's user record in the active tenant, provisioning it on first use. */
  async resolveActor(identity: AuthenticatedUser): Promise<User> {
    return (await this.ensure(identity)).user;
  }

  /** Active internal users of the active tenant, for assignee and field-rep pickers. */
  async listInternal(): Promise<User[]> {
    const users = await this.users.find({
      where: { isActive: true },
      order: { firstName: 'ASC', lastName: 'ASC', email: 'ASC' },
    });
    return users.filter((u) => !u.realmRoles.includes(EXTERNAL_CLIENT_ROLE));
  }

  /** Active internal user of the active tenant, or null. */
  async findInternal(id: string): Promise<User | null> {
    const user = await this.users.findOneBy({ id, isActive: true });
    return user && !user.realmRoles.includes(EXTERNAL_CLIENT_ROLE) ? user : null;
  }

  async updateProfile(id: string, changes: { title?: string | null; zone?: string | null }, actorId: string): Promise<User> {
    const user = await this.users.findOneBy({ id });
    if (!user) throw new NotFoundException('User not found');
    Object.assign(user, changes);
    await this.users.save(user);
    this.audit.logAction(user.tenantId, actorId, 'user.profile_updated', { userId: id, changes: Object.keys(changes) });
    return user;
  }

  private async ensure(identity: AuthenticatedUser): Promise<{ user: User; provisioned: boolean }> {
    const existing = await this.users.findOneBy({ keycloakId: identity.keycloakId });
    if (existing) {
      if (!existing.isActive) {
        throw new ForbiddenException('User is deactivated');
      }
      if (!sameRoles(existing.realmRoles, identity.roles)) {
        existing.realmRoles = [...identity.roles].sort();
        await this.users.save(existing);
      }
      return { user: existing, provisioned: false };
    }

    const user = await this.provision(identity);
    this.audit.logAction(user.tenantId, user.id, 'user.provisioned', { email: user.email });
    return { user, provisioned: true };
  }

  private async provision(identity: AuthenticatedUser): Promise<User> {
    try {
      return await this.users.save(
        this.users.create({
          keycloakId: identity.keycloakId,
          email: identity.email,
          firstName: identity.firstName,
          lastName: identity.lastName,
          realmRoles: [...identity.roles].sort(),
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
