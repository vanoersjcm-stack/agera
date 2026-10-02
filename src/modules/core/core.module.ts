import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditService } from './audit.service.js';
import { DatabaseModule } from './database.module.js';
import { AuditLog } from './entities/index.js';
import { HealthController } from './health.controller.js';

@Module({
  imports: [DatabaseModule, TypeOrmModule.forFeature([AuditLog])],
  controllers: [HealthController],
  providers: [AuditService],
  exports: [AuditService],
})
export class CoreModule {}
