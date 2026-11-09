import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLog } from '../entities/index.js';
import { TenancyModule } from '../tenancy/tenancy.module.js';
import { AuditLogListener } from './audit-log.listener.js';
import { AuditController } from './audit.controller.js';
import { AuditService } from './audit.service.js';
import { ForbiddenAuditFilter } from './forbidden-audit.filter.js';

@Module({
  imports: [TypeOrmModule.forFeature([AuditLog]), TenancyModule],
  controllers: [AuditController],
  providers: [AuditService, AuditLogListener, { provide: APP_FILTER, useClass: ForbiddenAuditFilter }],
  exports: [AuditService],
})
export class AuditModule {}
