import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLog } from './entities/index.js';

export interface AuditEntry {
  tenantId: string;
  userId: string | null;
  action: string;
  details?: Record<string, unknown>;
}

@Injectable()
export class AuditService {
  constructor(@InjectRepository(AuditLog) private readonly auditLogs: Repository<AuditLog>) {}

  async log(entry: AuditEntry): Promise<void> {
    await this.auditLogs.save(
      this.auditLogs.create({
        tenantId: entry.tenantId,
        userId: entry.userId,
        action: entry.action,
        details: entry.details ?? null,
      }),
    );
  }
}
