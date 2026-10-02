export const AUDIT_LOG_EVENT = 'audit.log';

export interface AuditLogEvent {
  tenantId: string;
  userId: string | null;
  action: string;
  details: Record<string, unknown> | null;
}
