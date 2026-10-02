import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CoreModule } from '../core/core.module.js';
import { Tenant, User } from '../core/entities/index.js';
import { UserController } from './user.controller.js';
import { UserService } from './user.service.js';

@Module({
  imports: [CoreModule, TypeOrmModule.forFeature([User, Tenant])],
  controllers: [UserController],
  providers: [UserService],
})
export class UserModule {}
