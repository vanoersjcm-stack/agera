import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CoreModule } from '../core/core.module.js';
import { Client } from '../clients/entities/client.entity.js';
import { User } from '../core/entities/index.js';
import { KeycloakAdminService } from './keycloak-admin.service.js';
import { UserAdminService } from './user-admin.service.js';
import { UserController } from './user.controller.js';
import { UserService } from './user.service.js';

@Module({
  imports: [CoreModule, TypeOrmModule.forFeature([User, Client])],
  controllers: [UserController],
  providers: [UserService, KeycloakAdminService, UserAdminService],
  exports: [UserService],
})
export class UserModule {}
