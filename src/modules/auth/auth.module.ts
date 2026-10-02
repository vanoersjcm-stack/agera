import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { KeycloakAuthGuard } from './keycloak-auth.guard.js';

@Module({
  providers: [{ provide: APP_GUARD, useClass: KeycloakAuthGuard }],
})
export class AuthModule {}
