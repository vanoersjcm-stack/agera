import { BadRequestException, Body, Controller, DefaultValuePipe, Get, Param, ParseIntPipe, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiParam, ApiProperty, ApiPropertyOptional, ApiQuery, ApiTags } from '@nestjs/swagger';
import { PLATFORM_ADMIN_ROLE, Roles } from '../auth/roles.decorator.js';
import type { User } from '../core/entities/index.js';
import { ApiPagination, PageMetaDto } from '../core/http/api-docs.js';
import { asObject, assertPagination, optionalString, optionalUuid, requiredString } from '../core/http/validation.js';
import { ACCOUNT_ROLES, type AccountRole, accountRole, UserAdminService } from './user-admin.service.js';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { ApiErrors, BEARER_AUTH } from '../core/http/api-docs.js';
import { UserService } from './user.service.js';

export class UserProfileDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  tenantId!: string;

  @ApiProperty({ description: 'Keycloak subject (sub claim)' })
  keycloakId!: string;

  @ApiProperty({ example: 'bob@acme.test' })
  email!: string;

  @ApiProperty({ type: String, nullable: true })
  firstName!: string | null;

  @ApiProperty({ type: String, nullable: true })
  lastName!: string | null;

  @ApiProperty()
  isActive!: boolean;

  @ApiProperty({ type: [String], description: 'Keycloak realm roles from the token', example: ['user'] })
  roles!: string[];

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: String, nullable: true, example: 'Key account manager' })
  title!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'Noord-Holland' })
  zone!: string | null;
}

export const USER_ROLES = ['platform-admin', 'admin', 'user'] as const;
export type UserRole = (typeof USER_ROLES)[number];

/** Highest internal role, from the realm roles recorded at the user's last request. */
export function primaryRole(roles: string[]): UserRole {
  return USER_ROLES.find((r) => roles.includes(r)) ?? 'user';
}

export class UserSummaryDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Sanne de Jong', description: 'Full name, or the e-mail address when no name is known' })
  name!: string;

  @ApiProperty({ example: 's.dejong@agera.local' })
  email!: string;

  @ApiProperty({ enum: USER_ROLES, description: 'Highest realm role seen at the user\'s last sign-in' })
  role!: UserRole;

  @ApiProperty({ type: String, nullable: true, example: 'Key account manager' })
  title!: string | null;
}

export class UserAccountDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  email!: string;

  @ApiProperty({ type: String, nullable: true })
  firstName!: string | null;

  @ApiProperty({ type: String, nullable: true })
  lastName!: string | null;

  @ApiProperty({ enum: ACCOUNT_ROLES })
  role!: AccountRole;

  @ApiProperty()
  isActive!: boolean;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: String, nullable: true, example: 'Key account manager' })
  title!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'Noord-Holland' })
  zone!: string | null;
}

export class UserAccountPageDto extends PageMetaDto {
  @ApiProperty({ type: [UserAccountDto] })
  items!: UserAccountDto[];

  @ApiProperty({ description: 'False when the backend has no Keycloak service-account secret' })
  managementAvailable!: boolean;
}

export class InviteUserDto {
  @ApiProperty()
  email!: string;

  @ApiProperty()
  firstName!: string;

  @ApiProperty()
  lastName!: string;

  @ApiProperty({ enum: ACCOUNT_ROLES })
  role!: AccountRole;

  @ApiPropertyOptional({ format: 'uuid', description: 'Required for External_Client users' })
  clientId?: string;
}

export class InvitedUserDto {
  @ApiProperty({ type: UserAccountDto })
  user!: UserAccountDto;

  @ApiProperty({ description: 'Shown once; the user must change it at first sign-in' })
  temporaryPassword!: string;
}

function toAccount(u: User): UserAccountDto {
  return {
    id: u.id,
    name: [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email,
    email: u.email,
    firstName: u.firstName,
    lastName: u.lastName,
    role: accountRole(u.realmRoles),
    title: u.title,
    zone: u.zone,
    isActive: u.isActive,
    createdAt: u.createdAt,
  };
}

function parseRole(value: unknown): AccountRole {
  if (!ACCOUNT_ROLES.includes(value as AccountRole)) {
    throw new BadRequestException(`role must be one of ${ACCOUNT_ROLES.join(', ')}`);
  }
  return value as AccountRole;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

@ApiTags('users')
@ApiBearerAuth(BEARER_AUTH)
@ApiErrors(401, 403)
@Controller('users')
export class UserController {
  constructor(
    private readonly userService: UserService,
    private readonly admin: UserAdminService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Active internal users of the active tenant',
    description: 'For assignee and field-rep pickers. Client (External_Client) users are excluded.',
  })
  @ApiOkResponse({ type: [UserSummaryDto] })
  async list(): Promise<UserSummaryDto[]> {
    const users = await this.userService.listInternal();
    return users.map((u) => ({
      id: u.id,
      name: [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email,
      email: u.email,
      role: primaryRole(u.realmRoles),
      title: u.title,
    }));
  }

  @Get('accounts')
  @Roles('admin', PLATFORM_ADMIN_ROLE)
  @ApiOperation({ summary: 'All user accounts of the active tenant (People & access), incl. client users and deactivated accounts' })
  @ApiPagination()
  @ApiQuery({ name: 'q', required: false, description: 'Search in name and e-mail' })
  @ApiQuery({ name: 'role', required: false, enum: ACCOUNT_ROLES })
  @ApiQuery({ name: 'status', required: false, enum: ['active', 'inactive'] })
  @ApiOkResponse({ type: UserAccountPageDto })
  @ApiErrors(400)
  async accounts(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(25), ParseIntPipe) limit: number,
    @Query('q') q?: string,
    @Query('role') role?: string,
    @Query('status') status?: string,
  ): Promise<UserAccountPageDto> {
    assertPagination(page, limit);
    if (status !== undefined && status !== 'active' && status !== 'inactive') {
      throw new BadRequestException('status must be active or inactive');
    }
    const result = await this.admin.list({ page, limit, q: q ?? '', role: role ? parseRole(role) : null, status: status ?? null });
    return { ...result, items: result.items.map(toAccount), managementAvailable: this.admin.available };
  }

  @Post()
  @Roles('admin', PLATFORM_ADMIN_ROLE)
  @ApiOperation({
    summary: 'Invite a user: creates the Keycloak account with a temporary password (audit: user.invited)',
    description: 'Only platform administrators can invite platform administrators. Returns 503 when Keycloak user management is not configured.',
  })
  @ApiBody({ type: InviteUserDto })
  @ApiCreatedResponse({ type: InvitedUserDto })
  @ApiErrors(400, 409, 503)
  async invite(@Body() body: unknown, @CurrentUser() identity: AuthenticatedUser): Promise<InvitedUserDto> {
    const raw = asObject(body);
    const email = requiredString('email', raw.email, 255).toLowerCase();
    if (!EMAIL.test(email)) throw new BadRequestException('email must be a valid e-mail address');
    const result = await this.admin.invite(
      {
        email,
        firstName: requiredString('firstName', raw.firstName, 100),
        lastName: requiredString('lastName', raw.lastName, 100),
        role: parseRole(raw.role),
        clientId: optionalUuid('clientId', raw.clientId),
      },
      identity,
    );
    return { user: toAccount(result.user), temporaryPassword: result.temporaryPassword };
  }

  @Patch(':id/role')
  @Roles('admin', PLATFORM_ADMIN_ROLE)
  @ApiOperation({ summary: 'Change the role of a user (audit: user.role_changed)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: UserAccountDto })
  @ApiErrors(400, 404, 503)
  async changeRole(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @CurrentUser() identity: AuthenticatedUser): Promise<UserAccountDto> {
    return toAccount(await this.admin.changeRole(id, parseRole(asObject(body).role), identity));
  }

  @Patch(':id/status')
  @Roles('admin', PLATFORM_ADMIN_ROLE)
  @ApiOperation({ summary: 'Activate or deactivate a user; deactivated users cannot sign in (audit: user.activated / user.deactivated)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: UserAccountDto })
  @ApiErrors(400, 404, 503)
  async setStatus(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @CurrentUser() identity: AuthenticatedUser): Promise<UserAccountDto> {
    const { isActive } = asObject(body);
    if (typeof isActive !== 'boolean') throw new BadRequestException('isActive must be true or false');
    return toAccount(await this.admin.setActive(id, isActive, identity));
  }

  @Patch(':id/profile')
  @Roles('admin', PLATFORM_ADMIN_ROLE)
  @ApiOperation({ summary: 'Set job title and zone/region of a user (audit: user.profile_updated)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: UserAccountDto })
  @ApiErrors(400, 404)
  async setProfile(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @CurrentUser() identity: AuthenticatedUser): Promise<UserAccountDto> {
    const raw = asObject(body);
    const changes: { title?: string | null; zone?: string | null } = {};
    if (raw.title !== undefined) changes.title = optionalString('title', raw.title, 150)?.trim() || null;
    if (raw.zone !== undefined) changes.zone = optionalString('zone', raw.zone, 100)?.trim() || null;
    if (Object.keys(changes).length === 0) throw new BadRequestException('Provide title and/or zone');
    const actor = await this.userService.resolveActor(identity);
    return toAccount(await this.userService.updateProfile(id, changes, actor.id));
  }

  @Get('me')
  @ApiOperation({
    summary: 'Current user profile',
    description: 'Creates the user in the active tenant on first call (audit: user.provisioned).',
  })
  @ApiOkResponse({ type: UserProfileDto })
  async me(@CurrentUser() identity: AuthenticatedUser): Promise<UserProfileDto> {
    const user = await this.userService.getOrProvision(identity);
    return {
      id: user.id,
      tenantId: user.tenantId,
      keycloakId: user.keycloakId,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      title: user.title,
      zone: user.zone,
      isActive: user.isActive,
      roles: identity.roles,
      createdAt: user.createdAt,
    };
  }
}
