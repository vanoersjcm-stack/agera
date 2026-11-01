import type { AgreementStatus, AlertType, Category, PlanStatus, RoomStatus, UserRole, VisitStatus, WorkOrderStatus } from './api';

/** Single source of business-facing names (audit §9). */
export const WORK_ORDER_STATUS: Record<WorkOrderStatus, string> = {
  PENDING: 'Pending',
  IN_PROGRESS: 'In progress',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

export const VISIT_STATUS: Record<VisitStatus, string> = {
  PLANNED: 'Planned',
  IN_PROGRESS: 'In progress',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

export const AGREEMENT_STATUS: Record<AgreementStatus, string> = {
  pending_approval: 'Awaiting approval',
  active: 'Active',
  expired: 'Expired',
};

export const ROOM_STATUS: Record<RoomStatus, string> = { active: 'Active', archived: 'Archived' };

export const PLAN_STATUS: Record<PlanStatus, string> = { draft: 'Draft', approved: 'Approved', archived: 'Archived' };

export const CATEGORY: Record<Category, string> = {
  revenue: 'Revenue',
  cogs: 'Cost of goods',
  opex: 'Operating costs',
  license_fee: 'Licence fees',
};

export const ALERT_TYPE: Record<AlertType, string> = {
  financial_variance: 'Plan deviation > 10%',
  dsr_stagnation: 'Client room inactive (7+ days)',
  store_compliance: 'Store not compliant',
};

export const ROLE: Record<UserRole, string> = {
  'platform-admin': 'Platform administrator',
  admin: 'Administrator',
  user: 'Staff',
};

export const ENGAGEMENT_STATUS: Record<string, string> = {
  accepted: 'Accepted terms',
  rejected: 'Rejected terms',
  engaged: 'Engaged',
};

export const ACTIVITY_TYPE: Record<string, string> = {
  opened: 'Opened the room',
  zone_viewed: 'Viewed a section',
  briefing_played: 'Watched a briefing',
  view: 'Viewed a document',
  download: 'Downloaded a document',
  comment: 'Commented',
  terms_accepted: 'Accepted terms',
  terms_rejected: 'Rejected terms',
};

export const COMPLIANCE: Record<string, string> = {
  compliant: 'Compliant',
  needs_follow_up: 'Needs follow-up',
  not_compliant: 'Not compliant',
  flagged_anomaly: 'Not compliant',
  variance_pending: 'Needs follow-up',
};

export const AUDIT_ACTION: Record<string, string> = {
  'client.created': 'Created a client',
  'client.updated': 'Updated a client',
  'contact.created': 'Added a contact',
  'contact.updated': 'Updated a contact',
  'agreement.created': 'Created an agreement',
  'agreement.status_changed': 'Changed an agreement status',
  'api_key.created': 'Created an integration key',
  'api_key.revoked': 'Revoked an integration key',
  'dsr.activity_recorded': 'Client activity recorded',
  'dsr.created': 'Created a client room',
  'dsr.status_changed': 'Changed a client room status',
  'financial_line_item.created': 'Added a plan line',
  'financial_line_item.updated': 'Updated a plan line',
  'financial_model.created': 'Created a financial plan',
  'financial_model.status_changed': 'Changed a financial plan status',
  'nexus.command': 'Used quick navigation',
  'nexus.voice_event_queued': 'Recorded a voice command',
  'store.created': 'Added a store',
  'tenant.created': 'Created an organisation',
  'user.provisioned': 'Signed in for the first time',
  'user.profile_fetched': 'Signed in',
  'visit.media_deleted': 'Deleted a visit photo',
  'visit.media_uploaded': 'Uploaded a visit photo',
  'visit.planned': 'Planned a store visit',
  'visit.report_saved': 'Saved a visit report',
  'visit.status_changed': 'Changed a store visit status',
  'work_order.assigned': 'Assigned a work order',
  'work_order.created': 'Created a work order',
  'work_order.status_changed': 'Changed a work order status',
};

export function auditActionLabel(action: string): string {
  return AUDIT_ACTION[action] ?? action.replace(/[._]/g, ' ');
}

export function formatDate(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
}

export function formatDateTime(value: string | null | undefined): string {
  return value
    ? new Date(value).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '—';
}

export const CLIENT_STATUS: Record<string, string> = { active: 'Active', archived: 'Archived' };
