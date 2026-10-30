import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
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
}

@ApiTags('users')
@ApiBearerAuth(BEARER_AUTH)
@ApiErrors(401, 403)
@Controller('users')
export class UserController {
  constructor(private readonly userService: UserService) {}

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
    }));
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
      isActive: user.isActive,
      roles: identity.roles,
      createdAt: user.createdAt,
    };
  }
}
