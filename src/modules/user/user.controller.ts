import { Controller, Get } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { UserService } from './user.service.js';

export interface UserProfile {
  id: string;
  tenantId: string;
  keycloakId: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  isActive: boolean;
  roles: string[];
  createdAt: Date;
}

@Controller('users')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get('me')
  async me(@CurrentUser() identity: AuthenticatedUser): Promise<UserProfile> {
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
