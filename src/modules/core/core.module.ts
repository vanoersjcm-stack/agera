import { Module } from '@nestjs/common';
import { AuditModule } from './audit/audit.module.js';
import { DatabaseModule } from './database.module.js';
import { HealthController } from './health.controller.js';
import { TenancyModule } from './tenancy/tenancy.module.js';
import { TenantsModule } from './tenants/tenants.module.js';

@Module({
  imports: [DatabaseModule, TenancyModule, AuditModule, TenantsModule],
  controllers: [HealthController],
  exports: [TenancyModule, AuditModule],
})
export class CoreModule {}
