import { randomBytes } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException, HttpException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { JOB_ROLES, type JobRole, jobRoleOf } from '../auth/job-roles.js';
import { EXTERNAL_CLIENT_ROLE, PLATFORM_ADMIN_ROLE } from '../auth/roles.decorator.js';
import { Client } from '../clients/entities/client.entity.js';
import { AuditService } from '../core/audit/audit.service.js';
import { User } from '../core/entities/index.js';
import { TenantContext } from '../core/tenancy/tenant-context.service.js';
import { TenantRepository } from '../core/tenancy/tenant-repository.js';
import { KeycloakAdminService, KeycloakRequestError } from './keycloak-admin.service.js';
import { UserService } from './user.service.js';
import { runForTenant } from '../core/tenancy/tenant-transaction.service.js';

export const ACCOUNT_ROLES = JOB_ROLES;
export type AccountRole = JobRole;

/** Legacy account roles still accepted by the API and mapped onto job roles. */
export const LEGACY_ROLES: Record<string, AccountRole> = { 'platform-admin': 'PLATFORM_ADMIN', admin: 'HQ_ADMIN', user: 'ACCOUNT_MANAGER', External_Client: 'CLIENT_VIEWER' };

/** Realm roles granted per job role; the legacy roles are kept so existing @Roles checks keep working. */
const ROLE_SETS: Record<AccountRole, string[]> = {
  PLATFORM_ADMIN: ['PLATFORM_ADMIN', 'platform-admin', 'admin', 'user'],
  HQ_ADMIN: ['HQ_ADMIN', 'admin', 'user'],
  ACCOUNT_MANAGER: ['ACCOUNT_MANAGER', 'user'],
  FIELD_REPRESENTATIVE: ['FIELD_REPRESENTATIVE', 'user'],
  CLIENT_VIEWER: ['CLIENT_VIEWER', EXTERNAL_CLIENT_ROLE],
};
const MANAGED_ROLES: readonly string[] = [...JOB_ROLES, ...Object.keys(LEGACY_ROLES)];

export function accountRole(realmRoles: string[]): AccountRole {
  return jobRoleOf(realmRoles) ?? (Object.entries(LEGACY_ROLES).find(([legacy]) => realmRoles.includes(legacy))?.[1] ?? 'ACCOUNT_MANAGER');
}

export interface AccountQuery {
  page: number;
  limit: number;
  q: string;
  role: AccountRole | null;
  status: 'active' | 'inactive' | null;
}

export interface InviteInput {
  email: string;
  firstName: string;
  lastName: string;
  role: AccountRole;
  clientId: string | null;
  /** The company the person is bound to: the active organisation for staff, the client company for client contacts. */
  entityId: string | null;
}

@Injectable()
export class UserAdminService {
  private readonly users: TenantRepository<User>;
  private readonly clients: TenantRepository<Client>;

  constructor(
    @InjectRepository(User) users: Repository<User>,
    @InjectRepository(Client) clients: Repository<Client>,
    private readonly context: TenantContext,
    private readonly keycloak: KeycloakAdminService,
    private readonly userService: UserService,
    private readonly audit: AuditService,
    private readonly dataSource: DataSource,
  ) {
    this.users = new TenantRepository(users, context);
    this.clients = new TenantRepository(clients, context);
  }

  get available(): boolean {
    return this.keycloak.configured;
  }

  async list(query: AccountQuery): Promise<{ items: User[]; page: number; limit: number; total: number }> {
    const q = query.q.trim().toLowerCase();
    const all = (await this.users.find({ order: { firstName: 'ASC', lastName: 'ASC', email: 'ASC' } })).filter(
      (u) =>
        (!query.role || accountRole(u.realmRoles) === query.role) &&
        (!query.status || u.isActive === (query.status === 'active')) &&
        (!q || [u.firstName, u.lastName, u.email].some((v) => v?.toLowerCase().includes(q))),
    );
    const start = (query.page - 1) * query.limit;
    return { items: all.slice(start, start + query.limit), page: query.page, limit: query.limit, total: all.length };
  }

  async invite(input: InviteInput, identity: AuthenticatedUser): Promise<{ user: User; temporaryPassword: string }> {
    const actor = await this.userService.resolveActor(identity);
    this.assertMayGrant(identity, input.role);
    const external = input.role === 'CLIENT_VIEWER';
    if (external) {
      if (input.clientId && input.entityId && input.clientId !== input.entityId) throw new BadRequestException('entityId and clientId must be the same client company');
      input = { ...input, clientId: input.entityId ?? input.clientId };
    } else if (input.entityId && input.entityId !== this.context.tenantId) {
      throw new BadRequestException('entityId must be your own organisation for staff accounts');
    }
    if (!external) await this.assertSeatAvailable();
    if (external && (!input.clientId || !(await this.clients.findOneBy({ id: input.clientId })))) {
      throw new BadRequestException('clientId must be a client of the active tenant for client users');
    }
    if (await this.users.findOneBy({ email: input.email })) {
      throw new ConflictException('A user with this e-mail address already exists');
    }
    const [tierRow]: { license_tier: string }[] = await this.dataSource.query('SELECT license_tier FROM tenants WHERE id = $1', [this.context.tenantId]);
    const attributes: Record<string, string[]> = { tenant_id: [this.context.tenantId], tenant_license_tier: [tierRow?.license_tier ?? 'symphony'] };
    if (external && input.clientId) attributes.client_id = [input.clientId];
    const temporaryPassword = `${randomBytes(9).toString('base64url')}-Ag1`;

    let keycloakId: string;
    try {
      keycloakId = await this.keycloak.createUser({ email: input.email, firstName: input.firstName, lastName: input.lastName, attributes }, temporaryPassword);
    } catch (error) {
      if (error instanceof KeycloakRequestError && error.status === 409) {
        throw new ConflictException('A user with this e-mail address already exists in the identity service');
      }
      throw error;
    }
    const realmRoles = ROLE_SETS[input.role];
    let user: User;
    try {
      await this.keycloak.setRealmRoles(keycloakId, realmRoles, MANAGED_ROLES);
      user = await this.users.save(
        this.users.create({ keycloakId, email: input.email, firstName: input.firstName, lastName: input.lastName, realmRoles: [...realmRoles].sort(), isActive: true }),
      );
    } catch (error) {
      await this.keycloak.deleteUser(keycloakId).catch(() => undefined);
      throw error;
    }
    this.audit.logAction(this.context.tenantId, actor.id, 'user.invited', { userId: user.id, email: user.email, role: input.role });
    return { user, temporaryPassword };
  }

  async changeRole(id: string, role: AccountRole, identity: AuthenticatedUser): Promise<User> {
    const actor = await this.userService.resolveActor(identity);
    const user = await this.target(id, actor);
    const previous = accountRole(user.realmRoles);
    if ((previous === 'CLIENT_VIEWER') !== (role === 'CLIENT_VIEWER')) {
      throw new BadRequestException('Client users and internal users cannot be converted into each other; invite a new user instead');
    }
    this.assertMayGrant(identity, role);
    this.assertMayGrant(identity, previous);
    if (previous === role) return user;
    await this.keycloak.setRealmRoles(user.keycloakId, ROLE_SETS[role], MANAGED_ROLES);
    user.realmRoles = [...user.realmRoles.filter((r) => !MANAGED_ROLES.includes(r)), ...ROLE_SETS[role]].sort();
    const saved = await this.users.save(user);
    this.audit.logAction(this.context.tenantId, actor.id, 'user.role_changed', { userId: id, previousRole: previous, newRole: role });
    return saved;
  }

  /** Vanguard organisations have a seat cap on active internal users (client contacts do not count). 402 when full. */
  private async assertSeatAvailable(): Promise<void> {
    const [row] = await runForTenant(this.dataSource, this.context.tenantId, (m) => m.query(
      `SELECT t.license_tier AS tier, t.max_seats AS "maxSeats",
              (SELECT count(*)::int FROM users u WHERE u.tenant_id = t.id AND u.is_active AND NOT ('External_Client' = ANY (u.realm_roles))) AS used
         FROM tenants t WHERE t.id = $1`,
      [this.context.tenantId],
    ));
    if (row?.maxSeats != null && row.used >= row.maxSeats) {
      throw new HttpException(
        {
          statusCode: HttpStatus.PAYMENT_REQUIRED,
          error: 'Seat limit reached',
          message: `All ${row.maxSeats} seats of your ${row.tier === 'vanguard' ? 'Agera Vanguard' : 'Agera'} licence are in use. Deactivate a colleague or upgrade to Agera Symphony (Enterprise) to add more people.`,
        },
        HttpStatus.PAYMENT_REQUIRED,
      );
    }
  }

  async setActive(id: string, active: boolean, identity: AuthenticatedUser): Promise<User> {
    if (active) {
      const target = await this.users.findOneBy({ id });
      if (target && !target.isActive && !target.realmRoles.includes(EXTERNAL_CLIENT_ROLE)) await this.assertSeatAvailable();
    }
    const actor = await this.userService.resolveActor(identity);
    const user = await this.target(id, actor);
    this.assertMayGrant(identity, accountRole(user.realmRoles));
    if (user.isActive === active) return user;
    await this.keycloak.setEnabled(user.keycloakId, active);
    user.isActive = active;
    const saved = await this.users.save(user);
    this.audit.logAction(this.context.tenantId, actor.id, active ? 'user.activated' : 'user.deactivated', { userId: id, email: user.email });
    return saved;
  }

  private async target(id: string, actor: User): Promise<User> {
    const user = await this.users.findOneBy({ id });
    if (!user) throw new NotFoundException('User not found');
    if (user.id === actor.id) throw new BadRequestException('You cannot change your own role or status');
    return user;
  }

  private assertMayGrant(identity: AuthenticatedUser, role: AccountRole): void {
    if (role === 'PLATFORM_ADMIN' && !identity.roles.includes(PLATFORM_ADMIN_ROLE)) {
      throw new ForbiddenException('Only platform administrators can manage platform administrators');
    }
  }
}
