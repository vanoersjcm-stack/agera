import { randomBytes } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { EXTERNAL_CLIENT_ROLE, PLATFORM_ADMIN_ROLE } from '../auth/roles.decorator.js';
import { Client } from '../clients/entities/client.entity.js';
import { AuditService } from '../core/audit/audit.service.js';
import { User } from '../core/entities/index.js';
import { TenantContext } from '../core/tenancy/tenant-context.service.js';
import { TenantRepository } from '../core/tenancy/tenant-repository.js';
import { KeycloakAdminService, KeycloakRequestError } from './keycloak-admin.service.js';
import { UserService } from './user.service.js';

export const ACCOUNT_ROLES = ['platform-admin', 'admin', 'user', 'External_Client'] as const;
export type AccountRole = (typeof ACCOUNT_ROLES)[number];

/** Realm roles granted per account role; higher internal roles include the lower ones. */
const ROLE_SETS: Record<AccountRole, string[]> = {
  'platform-admin': ['platform-admin', 'admin', 'user'],
  admin: ['admin', 'user'],
  user: ['user'],
  External_Client: ['External_Client'],
};

export function accountRole(realmRoles: string[]): AccountRole {
  return ACCOUNT_ROLES.find((r) => realmRoles.includes(r)) ?? 'user';
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
    const external = input.role === EXTERNAL_CLIENT_ROLE;
    if (external && (!input.clientId || !(await this.clients.findOneBy({ id: input.clientId })))) {
      throw new BadRequestException('clientId must be a client of the active tenant for client users');
    }
    if (await this.users.findOneBy({ email: input.email })) {
      throw new ConflictException('A user with this e-mail address already exists');
    }
    const attributes: Record<string, string[]> = { tenant_id: [this.context.tenantId] };
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
      await this.keycloak.setRealmRoles(keycloakId, realmRoles, ACCOUNT_ROLES);
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
    if ((previous === EXTERNAL_CLIENT_ROLE) !== (role === EXTERNAL_CLIENT_ROLE)) {
      throw new BadRequestException('Client users and internal users cannot be converted into each other; invite a new user instead');
    }
    this.assertMayGrant(identity, role);
    this.assertMayGrant(identity, previous);
    if (previous === role) return user;
    await this.keycloak.setRealmRoles(user.keycloakId, ROLE_SETS[role], ACCOUNT_ROLES);
    user.realmRoles = [...user.realmRoles.filter((r) => !(ACCOUNT_ROLES as readonly string[]).includes(r)), ...ROLE_SETS[role]].sort();
    const saved = await this.users.save(user);
    this.audit.logAction(this.context.tenantId, actor.id, 'user.role_changed', { userId: id, previousRole: previous, newRole: role });
    return saved;
  }

  async setActive(id: string, active: boolean, identity: AuthenticatedUser): Promise<User> {
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
    if (role === PLATFORM_ADMIN_ROLE && !identity.roles.includes(PLATFORM_ADMIN_ROLE)) {
      throw new ForbiddenException('Only platform administrators can manage platform administrators');
    }
  }
}
