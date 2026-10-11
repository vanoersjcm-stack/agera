import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';
export const PLATFORM_ADMIN_ROLE = 'platform-admin';
/** External client, retailer or brand partner user; limited to endpoints marked @AllowExternal(). */
export const EXTERNAL_CLIENT_ROLE = 'External_Client';

export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
