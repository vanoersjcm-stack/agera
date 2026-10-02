import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLog } from '../entities/index.js';
import { TenancyModule } from '../tenancy/tenancy.module.js';
import { AuditLogListener } from './audit-log.listener.js';
import { AuditController } from './audit.controller.js';
import { AuditService } from './audit.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([AuditLog]), TenancyModule],
  controllers: [AuditController],
  providers: [AuditService, AuditLogListener],
  exports: [AuditService],
})
export class AuditModule {}
