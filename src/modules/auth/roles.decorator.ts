import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';
export const PLATFORM_ADMIN_ROLE = 'platform-admin';

export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
