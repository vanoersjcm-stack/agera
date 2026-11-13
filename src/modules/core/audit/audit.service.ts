import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLog } from '../entities/index.js';
import { TenantContext } from '../tenancy/tenant-context.service.js';
import { TenantRepository } from '../tenancy/tenant-repository.js';
import { TenantTransaction } from '../tenancy/tenant-transaction.service.js';
import { AUDIT_LOG_EVENT, type AuditLogEvent } from './audit.events.js';

export interface AuditChainCheck {
  intact: boolean;
  checked: number;
  /** Position (seq) of the first row whose hash does not match; null when intact. */
  firstBrokenSeq: number | null;
  headHash: string | null;
}

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
    private readonly transaction: TenantTransaction,
  ) {
    this.auditLogs = new TenantRepository(repository, context);
  }

  /** Fire-and-forget: the write happens in AuditLogListener and never delays the caller. */
  logAction(tenantId: string, userId: string | null, action: string, details?: Record<string, unknown>): void {
    const event: AuditLogEvent = { tenantId, userId, action, details: details ?? null };
    this.events.emit(AUDIT_LOG_EVENT, event);
  }

  async findForActiveTenant(page: number, limit: number, onlySubject: string | null = null): Promise<AuditLogPage> {
    let where = {};
    if (onlySubject) {
      const [me] = await this.transaction.run((m) => m.query('SELECT id FROM users WHERE keycloak_id = $1 AND tenant_id = app_current_tenant()', [onlySubject]));
      if (!me) return { items: [], page, limit, total: 0 };
      where = { userId: me.id };
    }
    const [items, total] = await this.auditLogs.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return { items, page, limit, total };
  }

  /** Recomputes the active tenant's SHA-256 chain in the database. */
  async verifyChain(): Promise<AuditChainCheck> {
    const [row] = await this.transaction.run((m) => m.query('SELECT checked, first_broken_seq, head_hash FROM app_verify_audit_chain()'));
    const firstBrokenSeq = row.first_broken_seq === null ? null : Number(row.first_broken_seq);
    return { intact: firstBrokenSeq === null, checked: Number(row.checked), firstBrokenSeq, headHash: row.head_hash ?? null };
  }
}
