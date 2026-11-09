import type { AgreementStatus, AlertType, Category, PlanStatus, RoomStatus, UserRole, VisitStatus, WorkOrderStatus } from './api';
import { t, locale, live } from './i18n';

/** Single source of business-facing names (audit §9). */
export const WORK_ORDER_STATUS: Record<WorkOrderStatus, string> = live(() => ({
  PENDING: t("Pending"),
  IN_PROGRESS: t("In progress"),
  COMPLETED: t("Completed"),
  CANCELLED: t("Cancelled"),
}));

export const VISIT_STATUS: Record<VisitStatus, string> = live(() => ({
  PLANNED: t("Planned"),
  IN_PROGRESS: t("In progress"),
  COMPLETED: t("Completed"),
  CANCELLED: t("Cancelled"),
}));

export const AGREEMENT_STATUS: Record<AgreementStatus, string> = live(() => ({
  pending_approval: t("Awaiting approval"),
  active: t("Active"),
  expired: t("Expired"),
}));

export const ROOM_STATUS: Record<RoomStatus, string> = live(() => ({ active: t("Active"), archived: t("Archived") }));

export const PLAN_STATUS: Record<PlanStatus, string> = live(() => ({ draft: t("Draft"), approved: t("Approved"), archived: t("Archived") }));

export const CATEGORY: Record<Category, string> = live(() => ({
  revenue: t("Revenue"),
  cogs: t("Cost of goods"),
  opex: t("Operating costs"),
  license_fee: t("Licence fees"),
}));

export const ALERT_TYPE: Record<AlertType, string> = live(() => ({
  financial_variance: t("Plan deviation > 10%"),
  dsr_stagnation: t("Client room inactive (7+ days)"),
  store_compliance: t("Store not compliant"),
}));

export const ROLE: Record<UserRole, string> = live(() => ({
  'platform-admin': t("Platform administrator"),
  admin: t("Administrator"),
  user: t("Staff"),
}));

export const ENGAGEMENT_STATUS: Record<string, string> = live(() => ({
  accepted: t("Accepted terms"),
  rejected: t("Rejected terms"),
  engaged: t("Engaged"),
}));

export const ACTIVITY_TYPE: Record<string, string> = live(() => ({
  opened: t("Opened the room"),
  zone_viewed: t("Viewed a section"),
  briefing_played: t("Watched a briefing"),
  view: t("Viewed a document"),
  download: t("Downloaded a document"),
  comment: t("Commented"),
  terms_accepted: t("Accepted terms"),
  terms_rejected: t("Rejected terms"),
}));

export const COMPLIANCE: Record<string, string> = live(() => ({
  compliant: t("Compliant"),
  needs_follow_up: t("Needs follow-up"),
  not_compliant: t("Not compliant"),
  flagged_anomaly: t("Not compliant"),
  variance_pending: t("Needs follow-up"),
}));

export const AUDIT_ACTION: Record<string, string> = live(() => ({
  'client.created': t("Created a client"),
  'client.updated': t("Updated a client"),
  'contact.created': t("Added a contact"),
  'contact.updated': t("Updated a contact"),
  'agreement.created': t("Created an agreement"),
  'agreement.updated': t("Edited an agreement"),
  'agreement.status_changed': t("Changed an agreement status"),
  'api_key.created': t("Created an integration key"),
  'api_key.revoked': t("Revoked an integration key"),
  'dsr.activity_recorded': t("Client activity recorded"),
  'dsr.created': t("Created a client room"),
  'dsr.status_changed': t("Changed a client room status"),
  'financial_line_item.created': t("Added a plan line"),
  'financial_line_item.updated': t("Updated a plan line"),
  'financial_model.created': t("Created a financial plan"),
  'financial_model.status_changed': t("Changed a financial plan status"),
  'nexus.command': t("Used quick navigation"),
  'nexus.voice_event_queued': t("Recorded a voice command"),
  'store.created': t("Added a store"),
  'user.invited': t("Invited a user"),
  'user.role_changed': t("Changed a user role"),
  'user.activated': t("Reactivated a user"),
  'user.deactivated': t("Deactivated a user"),
  'store.updated': t("Edited a store"),
  'tenant.created': t("Created an organisation"),
  'user.provisioned': t("Signed in for the first time"),
  'access.denied': t("Was refused access (403)"),
  'user.profile_fetched': t("Signed in"),
  'visit.media_deleted': t("Deleted a visit photo"),
  'visit.media_uploaded': t("Uploaded a visit photo"),
  'visit.planned': t("Planned a store visit"),
  'visit.updated': t("Edited a store visit"),
  'visit.report_saved': t("Saved a visit report"),
  'visit.status_changed': t("Changed a store visit status"),
  'work_order.assigned': t("Assigned a work order"),
  'work_order.created': t("Created a work order"),
  'work_order.updated': t("Edited a work order"),
  'work_order.status_changed': t("Changed a work order status"),
}));

export function auditActionLabel(action: string): string {
  return AUDIT_ACTION[action] ?? action.replace(/[._]/g, ' ');
}

export function formatDate(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleDateString(locale(), { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
}

export function formatDateTime(value: string | null | undefined): string {
  return value
    ? new Date(value).toLocaleString(locale(), { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '—';
}

export const CLIENT_STATUS: Record<string, string> = live(() => ({ active: t("Active"), archived: t("Archived") }));
export const CREDIT_STATUS: Record<'approved' | 'review_required' | 'locked', string> = live(() => ({ approved: t("Approved"), review_required: t("Review required"), locked: t("Locked (credit hold)") }));

export const STORE_STATUS: Record<string, string> = live(() => ({ active: t("Open"), closed: t("Closed") }));

export const WORK_ORDER_PRIORITY: Record<string, string> = live(() => ({ low: t("Low"), normal: t("Normal"), high: t("High"), urgent: t("Urgent") }));
