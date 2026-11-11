import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';

/** IDMS lifecycle (V28): one step forward at a time; EXPIRED_PURGE is set by the retention job only. */
export const IDMS_STATUSES = ['DRAFT', 'IN_REVIEW', 'FINAL_LOCKED', 'ARCHIVED_WORM', 'EXPIRED_PURGE'] as const;
export type IdmsStatus = (typeof IDMS_STATUSES)[number];

/** Content is frozen in these states. */
export const LOCKED_STATUSES: ReadonlySet<string> = new Set(['FINAL_LOCKED', 'ARCHIVED_WORM', 'EXPIRED_PURGE']);

export function nextIdmsStatus(status: string): IdmsStatus | null {
  const i = IDMS_STATUSES.indexOf(status as IdmsStatus);
  return i >= 0 && i < IDMS_STATUSES.length - 1 ? IDMS_STATUSES[i + 1] : null;
}

export type IdmsTable = 'room_documents' | 'agreements' | 'financial_models' | 'invoices';

/**
 * Refuses (403) a change to a record whose content is frozen. `businessStatusChange`: the change only touches the
 * business status (paid, active, approved), which stays allowed while FINAL_LOCKED.
 */
export async function assertWritable(manager: EntityManager, table: IdmsTable, tenantId: string, id: string, businessStatusChange = false): Promise<void> {
  const [row] = await manager.query(`SELECT idms_status FROM ${table} WHERE tenant_id = $1 AND id = $2`, [tenantId, id]);
  if (!row) throw new NotFoundException('Record not found');
  assertStatusWritable(row.idms_status as string, businessStatusChange);
}

export function assertStatusWritable(status: string, businessStatusChange = false): void {
  if (businessStatusChange && status === 'FINAL_LOCKED') return;
  if (LOCKED_STATUSES.has(status)) throw new ForbiddenException(`This record is ${status} and can no longer be changed`);
}
