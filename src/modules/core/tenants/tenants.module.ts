import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module.js';
import { Tenant, User } from '../entities/index.js';
import { TenancyModule } from '../tenancy/tenancy.module.js';
import { TenantsController } from './tenants.controller.js';
import { TenantsService } from './tenants.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([Tenant, User]), TenancyModule, AuditModule],
  controllers: [TenantsController],
  providers: [TenantsService],
})
export class TenantsModule {}
