import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ApiKeysModule } from '../api-keys/api-keys.module.js';
import { ApiKeyGuard } from './api-key.guard.js';
import { KeycloakAuthGuard } from './keycloak-auth.guard.js';
import { RolesGuard } from './roles.guard.js';

@Module({
  imports: [ApiKeysModule],
  providers: [
    ApiKeyGuard,
    { provide: APP_GUARD, useClass: KeycloakAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AuthModule {}
