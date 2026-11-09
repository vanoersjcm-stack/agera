import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JobRoleGuard } from './job-roles.js';
import { ApiKeysModule } from '../api-keys/api-keys.module.js';
import { ApiKeyGuard } from './api-key.guard.js';
import { ExternalAccessGuard } from './external-access.guard.js';
import { KeycloakAuthGuard } from './keycloak-auth.guard.js';
import { RolesGuard } from './roles.guard.js';

@Module({
  imports: [ApiKeysModule],
  providers: [
    ApiKeyGuard,
    { provide: APP_GUARD, useClass: KeycloakAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: ExternalAccessGuard },
    { provide: APP_GUARD, useClass: JobRoleGuard },
  ],
})
export class AuthModule {}
