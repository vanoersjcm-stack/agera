import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLog } from '../entities/index.js';
import { AUDIT_LOG_EVENT, type AuditLogEvent } from './audit.events.js';

@Injectable()
export class AuditLogListener {
  private readonly logger = new Logger(AuditLogListener.name);

  constructor(@InjectRepository(AuditLog) private readonly auditLogs: Repository<AuditLog>) {}

  @OnEvent(AUDIT_LOG_EVENT, { async: true, promisify: true })
  async handle(event: AuditLogEvent): Promise<void> {
    try {
      await this.auditLogs.save(this.auditLogs.create(event));
    } catch (error) {
      this.logger.error(
        `Failed to write audit log "${event.action}" for tenant ${event.tenantId}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
