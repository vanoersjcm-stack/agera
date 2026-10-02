import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLog } from '../entities/index.js';
import { TenantContext } from '../tenancy/tenant-context.service.js';
import { TenantRepository } from '../tenancy/tenant-repository.js';
import { AUDIT_LOG_EVENT, type AuditLogEvent } from './audit.events.js';

export interface AuditLogPage {
  items: AuditLog[];
  page: number;
  limit: number;
  total: number;
}

@Injectable()
export class AuditService {
  private readonly auditLogs: TenantRepository<AuditLog>;

  constructor(
    private readonly events: EventEmitter2,
    @InjectRepository(AuditLog) repository: Repository<AuditLog>,
    context: TenantContext,
  ) {
    this.auditLogs = new TenantRepository(repository, context);
  }

  /** Fire-and-forget: the write happens in AuditLogListener and never delays the caller. */
  logAction(tenantId: string, userId: string | null, action: string, details?: Record<string, unknown>): void {
    const event: AuditLogEvent = { tenantId, userId, action, details: details ?? null };
    this.events.emit(AUDIT_LOG_EVENT, event);
  }

  async findForActiveTenant(page: number, limit: number): Promise<AuditLogPage> {
    const [items, total] = await this.auditLogs.findAndCount({
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return { items, page, limit, total };
  }
}
