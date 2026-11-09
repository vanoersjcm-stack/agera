import { accessToken } from './auth';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function send<T>(method: string, path: string, body?: BodyInit, contentType?: string): Promise<T> {
  const headers: Record<string, string> = { Authorization: `Bearer ${await accessToken()}`, ...organisationHeader() };
  if (contentType) headers['Content-Type'] = contentType;
  const response = await fetch(path.startsWith('/api/') ? path : `/api${path}`, { method, headers, body });
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = (data as { message?: string | string[] } | null)?.message;
    throw new ApiError(response.status, Array.isArray(message) ? message.join(', ') : (message ?? response.statusText));
  }
  return data as T;
}

export interface RoomDocument {
  id: string;
  clientRoomId: string;
  title: string;
  currentVersion: number;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedByName: string | null;
  downloads: number;
  createdAt: string;
  updatedAt: string;
}

export interface RoomDocumentVersion {
  id: string;
  version: number;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  uploadedByName: string | null;
  createdAt: string;
}

export interface AgreementSignature {
  id: string;
  agreementId: string;
  clientRoomId: string | null;
  signerName: string;
  signerEmail: string;
  contentSha256: string;
  signedAt: string;
}

export type SurveyQuestionType = 'nps' | 'csat' | 'rating' | 'single_choice' | 'multi_choice' | 'text';
export type SurveyStatus = 'draft' | 'active' | 'closed' | 'archived';
export interface SurveyQuestion { id: string; type: SurveyQuestionType; label: string; required: boolean; options?: string[]; minRating?: number; maxRating?: number; showIf?: { questionId: string; equals: string } | null }
export interface SurveyDispatch { id: string; targetType: 'single_client' | 'client_cohort' | 'client_room'; clientId: string | null; clientName: string | null; clientRoomId: string | null; clientRoomName: string | null; filterCriteria: Record<string, unknown> | null; totalTargeted: number; totalContacts: number; totalResponded: number; dispatchedByName: string | null; createdAt: string }
export interface Survey { id: string; title: string; description: string | null; status: SurveyStatus; questions: SurveyQuestion[]; createdByName: string | null; responseCount: number; targetedClients: number; dispatchCount: number; nps: number | null; createdAt: string; updatedAt: string; dispatches?: SurveyDispatch[] }
export interface SurveyList { tier: LicenseTier; maxActive: number | null; activeCount: number; questionTypes: SurveyQuestionType[]; items: Survey[] }
export interface SurveyAudience { targetType: 'single_client' | 'client_cohort' | 'client_room'; clientId?: string | null; clientRoomId?: string | null; all?: boolean; sector?: string | null; minArr?: number | null; maxArr?: number | null; accountManagerId?: string | null; maxHealthScore?: number | null }
export interface NpsResult { score: number | null; promoters: number; passives: number; detractors: number; count: number }
export interface SurveyAnalytics {
  surveyId: string; title: string; status: SurveyStatus; totalResponses: number; targetedClients: number; respondedClients: number; responseRate: number | null; nps: NpsResult;
  questions: { id: string; label: string; type: SurveyQuestionType; answered: number; skipped: number; distribution?: Record<string, number>; average?: number | null; texts?: string[]; nps?: NpsResult }[];
  bySector: { name: string; responses: number; nps: number | null }[]; byAccountManager: { name: string; responses: number; nps: number | null }[];
  respondents: { id: string; clientId: string | null; clientName: string | null; sector: string | null; accountManagerName: string | null; respondentEmail: string | null; contactName: string | null; npsScore: number | null; submittedAt: string }[];
}
export interface FeedbackSummary { responses: number; nps: NpsResult; clients: { clientId: string; name: string; responses: number; lastAt: string; nps: number | null; averageScore: number | null }[]; surveys: Survey[] }
export interface PortalSurvey { id: string; title: string; description: string | null; questions: SurveyQuestion[]; answered: boolean; clientRoomIds: string[] }
export type SurveyAnswers = Record<string, string | number | string[]>;

export interface AutomationStep {
  condition: { field: string; op: 'equals' | 'not_equals' | 'contains' | 'exists'; value: string | null } | null;
  action: 'notify_user' | 'create_exception';
  config: { userId?: string | null; title: string; message?: string | null; severity?: 'low' | 'medium' | 'high' };
  delayMinutes: number;
}
export interface AutomationRun { id: string; stepIndex: number; status: 'scheduled' | 'done' | 'skipped' | 'failed'; runAt: string; detail: string | null; createdAt: string }
export interface Automation { id: string; name: string; trigger: string; steps: AutomationStep[]; active: boolean; runCount: number; lastRunAt: string | null; createdAt: string; runs?: AutomationRun[] }
export interface AutomationList { tier: LicenseTier; maxActive: number | null; activeCount: number; items: Automation[] }
export interface AutomationCatalog { triggers: { value: string; label: string }[]; operators: string[]; actions: string[] }
export interface AutomationBody { name?: string; trigger?: string; steps?: AutomationStep[]; active?: boolean }
export interface ReportColumn { key: string; label: string; type: 'text' | 'number' | 'date' }
export interface ReportDataset { key: string; label: string; columns: ReportColumn[] }
export interface ReportDefinition {
  dataset: string;
  columns: string[];
  filters: { column: string; op: 'equals' | 'not_equals' | 'contains' | 'gt' | 'lt'; value: string }[];
  groupBy: string | null;
  aggregate: { fn: 'count' | 'sum' | 'avg' | 'min' | 'max'; column: string | null } | null;
  sort: { column: string; direction: 'asc' | 'desc' } | null;
  limit: number;
}
export interface ReportResult { columns: ReportColumn[]; rows: Record<string, unknown>[] }
export interface SavedReport { id: string; name: string; definition: ReportDefinition; pinned: boolean; createdAt: string; updatedAt: string }
export interface Kpis {
  activeClients: number; activeAgreementValue: string; openDeals: number; pipelineValue: string; overdueInvoices: number; overdueAmount: string;
  openExceptions: number; openWorkOrders: number; visitsCompletedThisMonth: number; visitsThisMonth: number;
  dealsByStage: { stage: string; count: number; value: string }[]; invoicesByStatus: { status: string; count: number; value: string }[]; tier: LicenseTier;
}

/** Fetches an authenticated file and hands it to the browser as a download. */
export async function downloadFile(path: string, fileName: string): Promise<void> {
  const response = await fetch(`/api${path}`, { headers: { Authorization: `Bearer ${await accessToken()}`, ...organisationHeader() } });
  if (!response.ok) throw new ApiError(response.status, response.statusText);
  const url = URL.createObjectURL(await response.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

const VIEW_KEY = 'agera.viewOrganisation';

/** Organisation a platform admin is viewing read-only, or null for their own organisation. */
export function viewingOrganisation(): string | null {
  return sessionStorage.getItem(VIEW_KEY);
}

export function switchOrganisation(id: string | null): void {
  if (id) sessionStorage.setItem(VIEW_KEY, id);
  else sessionStorage.removeItem(VIEW_KEY);
  window.location.hash = '#/symphony';
  window.location.reload();
}

function organisationHeader(): Record<string, string> {
  const id = viewingOrganisation();
  return id ? { 'X-Agera-Organisation': id } : {};
}

function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  return body === undefined ? send<T>(method, path) : send<T>(method, path, JSON.stringify(body), 'application/json');
}

function query(params: Record<string, string | number | null | undefined>): string {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '') as [string, string][];
  const q = new URLSearchParams(entries.map(([k, v]) => [k, String(v)]));
  return q.size ? `?${q}` : '';
}

export interface Page<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
}

/* ---------- RetailPower field catalogue ---------- */

export interface Product { id: string; sku: string; name: string; brand: string | null; category: string | null; unitPrice: string; active: boolean; createdAt: string; updatedAt: string }
export interface PlanogramItem { id: string; productId: string; productName: string; sku: string; expectedFacings: number; shelf: string | null }
export interface PlanogramSummary { id: string; name: string; category: string | null; storeId: string | null; storeName: string | null; active: boolean; itemCount: number; totalFacings: number; updatedAt: string }
export interface Planogram { id: string; name: string; category: string | null; storeId: string | null; storeName: string | null; active: boolean; updatedAt: string; items: PlanogramItem[] }
export type FieldOrderStatus = 'draft' | 'submitted' | 'confirmed' | 'delivered' | 'cancelled';
export interface FieldOrderLine { id: string; productId: string; productName: string; sku: string; quantity: number; unitPrice: string; lineTotal: string }
export interface FieldOrder {
  id: string; storeId: string; storeName: string; clientId: string | null; clientName: string | null; visitId: string | null; status: FieldOrderStatus;
  notes: string | null; createdByName: string | null; submittedAt: string | null; createdAt: string; updatedAt: string; total: string; lineCount?: number; lines?: FieldOrderLine[];
}
export interface AuditRoundVisit { id: string; storeId: string; storeName: string; storeCode: string; visitDate: string; status: VisitStatus; fieldRepName: string | null; complianceStatus: string | null; planogramScore: number | null }
export interface AuditRound {
  id: string; name: string; checklist: string[]; dueDate: string | null; status: 'open' | 'closed'; createdByName: string | null; createdAt: string;
  visitCount?: number; completedCount?: number; issueCount?: number; visits?: AuditRoundVisit[];
}
export interface VisitContext { auditRound: { id: string; name: string; checklist: string[] } | null; planograms: Planogram[] }

/* ---------- Commercial ---------- */

export interface PriceListItem { id: string; productId: string; sku: string; productName: string; catalogPrice: string; unitPrice: string; minQuantity: number }
export interface PriceList {
  id: string; name: string; clientId: string | null; clientName: string | null; validFrom: string | null; validTo: string | null; active: boolean; itemCount: number;
  createdAt: string; updatedAt: string; items?: PriceListItem[];
}
export type TemplateKind = 'proposal' | 'agreement' | 'letter' | 'mail';
export interface DocumentTemplate { id: string; name: string; kind: TemplateKind; body: string; active: boolean; createdAt: string; updatedAt: string }
export interface PriceListBody { name: string; clientId: string | null; validFrom: string | null; validTo: string | null; active?: boolean; items: { productId: string; unitPrice: string | number; minQuantity: number }[] }

/* ---------- Workflow ---------- */

export type ApprovalEntity = 'financial_plan' | 'agreement';
export interface ApprovalStep { id: string; stepOrder: number; approverId: string; approverName: string; decision: 'pending' | 'approved' | 'rejected'; comment: string | null; decidedAt: string | null }
export interface Approval {
  id: string; entityType: ApprovalEntity; entityId: string; entityLabel: string; note: string | null; status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  requestedById: string | null; requestedByName: string | null; createdAt: string; decidedAt: string | null; steps: ApprovalStep[]; currentApproverId: string | null;
}
export type ExceptionSeverity = 'low' | 'medium' | 'high';
export type ExceptionStatus = 'open' | 'in_progress' | 'resolved';
export interface ExceptionRecord {
  id: string; title: string; description: string | null; severity: ExceptionSeverity; status: ExceptionStatus; ownerId: string | null; ownerName: string | null;
  storeId: string | null; storeName: string | null; clientId: string | null; clientName: string | null; source: string | null; resolution: string | null;
  createdByName: string | null; resolvedAt: string | null; createdAt: string; updatedAt: string;
}
export interface AppNotification { id: string; title: string; body: string | null; link: string | null; readAt: string | null; createdAt: string }
export interface ClientHealth {
  clientId: string; name: string; creditStatus: string; overdueInvoices: number; atRiskAgreements: number; openExceptions: number; activeRooms: number;
  engagementScore: number; score: number; band: 'healthy' | 'watch' | 'at_risk'; factors: string[]; surveyNps: number | null;
}

/* ---------- Symphony ---------- */

export type LicenseTier = 'vanguard' | 'symphony';

export interface Tenant {
  readOnly?: boolean;
  licenseTier: LicenseTier;
  maxSeats: number | null;
  activeSeats?: number;
  id: string;
  name: string;
  domain: string;
  createdAt: string;
}

export interface UserProfile {
  licenseTier?: LicenseTier;
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  title: string | null;
  zone: string | null;
  roles: string[];
}

export type UserRole = 'platform-admin' | 'admin' | 'user';

export interface UserSummary {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  title: string | null;
}

export interface MailStatus {
  configured: boolean;
  connected: boolean;
  host: string | null;
  port: number;
  from: string | null;
  error: string | null;
}

export interface AuditChainCheck {
  intact: boolean;
  checked: number;
  firstBrokenSeq: number | null;
  headHash: string | null;
}

export interface AuditLog {
  id: string;
  userId: string | null;
  action: string;
  details: Record<string, unknown> | null;
  createdAt: string;
}

export interface ApiKey {
  id: string;
  tenantId: string;
  name: string;
  keyPrefix: string;
  createdAt: string;
  expiresAt: string | null;
}

export interface CreatedApiKey extends ApiKey {
  key: string;
}

export interface SearchHit {
  entityType: 'client' | 'store' | 'work_order' | 'agreement' | 'client_room';
  id: string;
  title: string;
  subtitle: string;
  route: string;
}

/* ---------- RetailPower ---------- */

export type WorkOrderStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';

export type WorkOrderPriority = 'low' | 'normal' | 'high' | 'urgent';

export interface WorkOrder {
  id: string;
  title: string;
  description: string | null;
  status: WorkOrderStatus;
  priority: WorkOrderPriority;
  assignedUserId: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface WorkOrderLog {
  id: string;
  previousStatus: WorkOrderStatus | null;
  newStatus: WorkOrderStatus;
  changedByUserId: string;
  createdAt: string;
}

export type StoreStatus = 'active' | 'closed';

export interface Store {
  id: string;
  storeCode: string;
  name: string;
  address: string | null;
  city: string | null;
  postalCode: string | null;
  country: string | null;
  status: StoreStatus;
  clientId: string | null;
  createdAt: string;
}

export type VisitStatus = 'PLANNED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';

export interface Visit {
  id: string;
  storeId: string;
  fieldRepId: string;
  workOrderId: string | null;
  visitDate: string;
  notes: string | null;
  status: VisitStatus;
  createdAt: string;
  updatedAt: string;
}

export interface VisitReport {
  id: string;
  summary: string | null;
  auditData: Record<string, unknown>;
  updatedAt: string;
  replenishmentRoomId?: string | null;
}

export interface VisitMedia {
  id: string;
  visitId: string;
  mimeType: string;
  fileSizeBytes: number;
  url: string;
  createdAt: string;
}

export interface VisitSummary {
  visit: Visit;
  report: VisitReport | null;
  media: VisitMedia[];
}

/* ---------- Nexus ---------- */

export type Category = 'revenue' | 'cogs' | 'opex' | 'license_fee';
export type PlanStatus = 'draft' | 'approved' | 'archived';

export interface FinancialModel {
  id: string;
  modelName: string;
  fiscalYear: number;
  status: PlanStatus;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface LineItem {
  id: string;
  modelId: string;
  category: Category;
  subcategory: string | null;
  periodCode: string;
  projectedAmount: string;
  actualAmount: string | null;
  variance: string | null;
  currency: string;
}

export interface PnlAggregate {
  periodCode: string | null;
  category: Category;
  currency: string;
  lineCount: number;
  projected: string;
  actual: string | null;
  variance: string | null;
  variancePercent: number | null;
}

export interface Pnl {
  rows: PnlAggregate[];
  totals: PnlAggregate[];
}

export interface StakeholderState {
  email: string;
  status: 'accepted' | 'rejected' | 'engaged';
  activityCount: number;
  lastActivityType: string;
  lastActivityAt: string;
}

export interface RoomEngagement {
  dsrId: string;
  activityCount: number;
  stakeholderCount: number;
  lastActivityAt: string;
  activityCounts: Record<string, number>;
  stakeholders: StakeholderState[];
}

export interface EngagementStatus {
  generatedAt: string;
  windowDays: number;
  summary: { activeDsrs: number; stakeholders: number; accepted: number; rejected: number; pending: number };
  dsrs: RoomEngagement[];
}

export type AlertType = 'financial_variance' | 'dsr_stagnation' | 'store_compliance';

export interface Alert {
  anomalyType: AlertType;
  sourceId: string;
  description: string;
  observedAt: string;
  details: Record<string, unknown>;
  createdAt: string;
}

export interface Alerts {
  generatedAt: string;
  anomalies: Alert[];
}

export type ClientStatus = 'active' | 'archived';

export type CreditStatus = 'approved' | 'review_required' | 'locked';

export interface Client {
  id: string;
  name: string;
  legalName: string | null;
  vatNumber: string | null;
  city: string | null;
  country: string | null;
  status: ClientStatus;
  kvkNumber: string | null;
  sector: string | null;
  address: string | null;
  paymentTerms: string;
  creditLimit: string;
  creditStatus: CreditStatus;
  erpId: string | null;
  accountManagerId: string | null;
  accountManagerName: string | null;
  activeAgreements: number;
  activeRooms: number;
  contractValue: string;
  createdAt: string;
  updatedAt: string;
}

export interface Contact {
  id: string;
  clientId: string;
  firstName: string;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  roleTitle: string | null;
  isPrimary: boolean;
}

export type ClientInput = Pick<Client, 'name' | 'legalName' | 'vatNumber' | 'city' | 'country'> &
  Partial<Pick<Client, 'kvkNumber' | 'sector' | 'address' | 'paymentTerms' | 'creditLimit' | 'creditStatus' | 'erpId' | 'accountManagerId'>>;
export type ContactInput = Omit<Contact, 'id' | 'clientId'>;

export interface ClientRecord {
  client: Client;
  contacts: Contact[];
  agreements: Agreement[];
  rooms: ClientRoom[];
  stores: { id: string; storeCode: string; name: string; city: string | null; status: StoreStatus }[];
  plans: { id: string; modelName: string; fiscalYear: number; status: PlanStatus }[];
}

export interface RoomActivity {
  id: string;
  dsrId: string;
  stakeholderEmail: string;
  activityType: string;
  details: Record<string, unknown>;
  createdAt: string;
}

export type AgreementStatus = 'pending_approval' | 'active' | 'expired';

export type AccountRole = 'platform-admin' | 'admin' | 'user' | 'External_Client';

export interface UserAccount {
  id: string;
  name: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: AccountRole;
  title: string | null;
  zone: string | null;
  isActive: boolean;
  createdAt: string;
}

export interface UserAccountPage {
  items: UserAccount[];
  page: number;
  limit: number;
  total: number;
  managementAvailable: boolean;
}

export interface Agreement {
  id: string;
  clientId: string;
  title: string;
  status: AgreementStatus;
  documentUrl: string;
  annualValue: string;
  churnRisk: string | null;
  endDate: string | null;
  createdAt: string;
  updatedAt: string;
}

export type InvoiceStatus = 'draft' | 'issued' | 'paid' | 'cancelled';

export interface Invoice {
  id: string;
  clientId: string;
  clientName: string;
  invoiceNumber: string;
  description: string | null;
  issueDate: string;
  dueDate: string | null;
  amountExclVat: string;
  vatAmount: string;
  totalAmount: string;
  status: InvoiceStatus;
  overdue: boolean;
  paidAt: string | null;
  createdAt: string;
}

export interface InvoiceInput {
  clientId: string;
  invoiceNumber: string;
  description?: string | null;
  issueDate: string;
  dueDate?: string | null;
  amountExclVat: string;
  vatAmount?: string;
  status?: 'draft' | 'issued';
}

export interface CreditHold {
  id: string;
  clientId: string | null;
  clientName: string | null;
  reason: string;
  setByName: string | null;
  createdAt: string;
  releasedAt: string | null;
  releasedByName: string | null;
  active: boolean;
}

export interface Waterfall {
  fiscalYear: number;
  currency: string;
  baseline: string;
  expansion: string;
  churn: string;
  prognosis: string;
  actuals: string;
  openPipeline: string;
}

export type RoomStatus = 'active' | 'archived';

export type DealStage = 'lead_ingest' | 'proposal_sent' | 'contract_negotiation' | 'ops_handoff';
export type DealPriority = 'low' | 'medium' | 'high';

export interface Deal {
  id: string;
  clientId: string;
  clientName: string;
  title: string;
  value: string;
  stage: DealStage;
  ownerId: string | null;
  ownerName: string | null;
  priority: DealPriority;
  clientRoomId: string | null;
  clientRoomName: string | null;
  dueDate: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DealRecord extends Deal {
  history: { id: string; fromStage: DealStage | null; toStage: DealStage; changedByName: string | null; changedAt: string }[];
}

export interface DealInput {
  clientId: string;
  title: string;
  value?: string;
  stage?: DealStage;
  ownerId?: string | null;
  priority?: DealPriority;
  clientRoomId?: string | null;
  dueDate?: string | null;
  notes?: string | null;
}

export type MilestoneOwnerSide = 'internal' | 'client';

export interface Milestone {
  id: string;
  clientRoomId: string;
  title: string;
  ownerSide: MilestoneOwnerSide;
  dueDate: string | null;
  completed: boolean;
  completedAt: string | null;
  completedByName: string | null;
  createdAt: string;
}

export interface ClientRoom {
  id: string;
  clientId: string;
  agreementId: string | null;
  roomName: string;
  status: RoomStatus;
  createdAt: string;
  updatedAt: string;
}

/* ---------- RetailPower operations (V26) ---------- */

export type ContractType = 'fixed' | 'flex';
export type CrewAvailability = 'available' | 'busy' | 'on_leave' | 'inactive';
export interface CrewMember { id: string; userId: string; name: string; email: string; isActive: boolean; contractType: ContractType; languages: string[]; brandCertifications: string[]; availableDays: number[]; availability: CrewAvailability; homeRegion: string | null; phone: string | null; notes: string | null; openVisits: number; vehicleId: string | null }
export type ShiftStatus = 'pending' | 'approved' | 'rejected';
export interface Shift { id: string; userId: string; userName: string; contractType: ContractType | null; storeId: string | null; storeName: string | null; visitId: string | null; clockInAt: string; clockOutAt: string | null; clockInLat: number | null; clockInLng: number | null; geofenceDistanceM: number | null; hours: number | null; validationStatus: ShiftStatus; validatedByName: string | null; validatedAt: string | null; rejectionReason: string | null; notes: string | null }
export type VehicleSide = 'front' | 'back' | 'left' | 'right';
export interface VehicleAllocation { id: string; userId: string; userName: string; vehicleId: string; description: string | null; allocatedFrom: string; allocatedUntil: string | null; status: 'pending_check' | 'active' | 'returned'; checkCompletedAt: string | null; odometerKm: number | null; damageNotes: string | null; returnedAt: string | null; photos: Record<VehicleSide, boolean> }
export interface ApparelAssignment { id: string; userId: string; userName: string; item: string; size: string | null; quantity: number; issuedOn: string; returnedOn: string | null; notes: string | null }
export type RmaStatus = 'open' | 'approved' | 'shipped' | 'credited' | 'rejected';
export interface RmaCase { id: string; caseNumber: string; storeId: string; storeName: string; productName: string | null; clientName: string | null; quantity: number; reason: string; status: RmaStatus; description: string | null; openedByName: string; createdAt: string }
export type ClaimStatus = 'submitted' | 'approved' | 'rejected' | 'paid';
export interface StockClaim { id: string; storeId: string; storeName: string; productName: string | null; clientName: string | null; claimType: string; quantity: number; amount: string; status: ClaimStatus; description: string | null; submittedByName: string; decidedByName: string | null; createdAt: string }
export interface OpsChainRow { clientId: string | null; chain: string; stores: number; visits30: number; completed30: number; nonCompliant: number; compliant: number; photos30: number; lastVisit: string | null }
export interface OpsDashboard {
  kpis: { chains: number; stores: number; visits30: number; completed30: number; compliancePercent: number | null; photos30: number; openRma: number; openClaims: number; pendingShifts: number; availableCrew: number };
  chains: OpsChainRow[];
  photos: { id: string; visitId: string; url: string; storeName: string; chain: string | null; visitDate: string; repName: string | null; createdAt: string }[];
}

export const api = {
  // Symphony
  tenant: () => request<Tenant>('GET', '/tenants/me'),
  tenants: () => request<Tenant[]>('GET', '/tenants'),
  createTenant: (body: { name: string; domain: string }) => request<Tenant>('POST', '/tenants', body),
  setLicense: (id: string, body: { licenseTier: LicenseTier; maxSeats?: number | null }) => request<Tenant>('PATCH', `/tenants/${id}/license`, body),
  me: () => request<UserProfile>('GET', '/users/me'),
  surveys: () => request<SurveyList>('GET', '/v1/surveys'),
  survey: (id: string) => request<Survey>('GET', `/v1/surveys/${id}`),
  createSurvey: (body: { title: string; description?: string | null; questions: SurveyQuestion[] }) => request<Survey>('POST', '/v1/surveys', body),
  updateSurvey: (id: string, body: { title?: string; description?: string | null; questions?: SurveyQuestion[] }) => request<Survey>('PATCH', `/v1/surveys/${id}`, body),
  setSurveyStatus: (id: string, status: SurveyStatus) => request<Survey>('PATCH', `/v1/surveys/${id}/status`, { status }),
  surveyAudience: (body: SurveyAudience) => request<{ clients: number; contacts: number; sectors: string[] }>('POST', '/v1/surveys/audience', body),
  dispatchSurvey: (id: string, body: SurveyAudience) => request<{ id: string; totalTargeted: number; totalContacts: number }>('POST', `/v1/surveys/${id}/dispatch`, body),
  surveyAnalytics: (id: string, filter: { sector?: string; accountManagerId?: string } = {}) => request<SurveyAnalytics>('GET', `/v1/surveys/${id}/analytics${query(filter)}`),
  exportSurvey: (id: string, title: string) => downloadFile(`/v1/surveys/${id}/export`, `${title.replace(/[^\w-]+/g, '-')}-${new Date().toISOString().slice(0, 10)}.csv`),
  feedbackSummary: () => request<FeedbackSummary>('GET', '/v1/surveys/summary'),
  portalSurveys: () => request<PortalSurvey[]>('GET', '/v1/portal/surveys'),
  respondSurvey: (id: string, answers: SurveyAnswers) => request<{ id: string }>('POST', `/v1/portal/surveys/${id}/respond`, { answers }),
  automationCatalog: () => request<AutomationCatalog>('GET', '/v1/automations/catalog'),
  automations: () => request<AutomationList>('GET', '/v1/automations'),
  automation: (id: string) => request<Automation>('GET', `/v1/automations/${id}`),
  createAutomation: (body: AutomationBody) => request<Automation>('POST', '/v1/automations', body),
  updateAutomation: (id: string, body: AutomationBody) => request<Automation>('PATCH', `/v1/automations/${id}`, body),
  deleteAutomation: (id: string) => request<void>('DELETE', `/v1/automations/${id}`),
  reportDatasets: () => request<ReportDataset[]>('GET', '/v1/reports/datasets'),
  kpis: () => request<Kpis>('GET', '/v1/reports/kpis'),
  exportDataset: (key: string) => downloadFile(`/v1/reports/datasets/${key}/export`, `agera-${key}-${new Date().toISOString().slice(0, 10)}.csv`),
  runReport: (def: ReportDefinition) => request<ReportResult>('POST', '/v1/reports/run', def),
  savedReports: () => request<SavedReport[]>('GET', '/v1/reports/saved'),
  saveReport: (name: string, definition: ReportDefinition, pinned: boolean) => request<SavedReport>('POST', '/v1/reports/saved', { name, definition, pinned }),
  updateSavedReport: (id: string, body: { name?: string; definition?: ReportDefinition; pinned?: boolean }) => request<SavedReport>('PATCH', `/v1/reports/saved/${id}`, body),
  deleteSavedReport: (id: string) => request<void>('DELETE', `/v1/reports/saved/${id}`),
  users: () => request<UserSummary[]>('GET', '/users'),
  auditLogs: (page: number, limit = 50) => request<Page<AuditLog>>('GET', `/audit-logs${query({ page, limit })}`),
  verifyAuditChain: () => request<AuditChainCheck>('GET', '/audit-logs/verify'),
  // RetailPower operations
  opsDashboard: () => request<OpsDashboard>('GET', '/v1/operations/dashboard'),
  crew: () => request<CrewMember[]>('GET', '/v1/operations/crew'),
  createCrew: (body: Partial<CrewMember> & { userId: string }) => request<{ id: string }>('POST', '/v1/operations/crew', body),
  updateCrew: (id: string, body: Partial<CrewMember>) => request<{ id: string }>('PATCH', `/v1/operations/crew/${id}`, body),
  shifts: (params: { status?: ShiftStatus; from?: string; to?: string; userId?: string } = {}) => request<Shift[]>('GET', `/v1/operations/shifts${query(params)}`),
  myOpenShift: () => request<Shift | null>('GET', '/v1/operations/shifts/mine/open'),
  clockIn: (body: { storeId?: string | null; visitId?: string | null; lat?: number; lng?: number; notes?: string | null }) => request<Shift>('POST', '/v1/operations/shifts/clock-in', body),
  clockOut: (body: { lat?: number; lng?: number }) => request<Shift>('POST', '/v1/operations/shifts/clock-out', body),
  recordShift: (body: { userId: string; storeId: string | null; clockInAt: string; clockOutAt: string; notes: string | null }) => request<Shift>('POST', '/v1/operations/shifts', body),
  validateShift: (id: string, decision: 'approved' | 'rejected', reason?: string) => request<Shift>('PATCH', `/v1/operations/shifts/${id}/validation`, { decision, reason }),
  exportHours: (from: string, to: string) => downloadFile(`/v1/operations/shifts/export.csv${query({ from, to })}`, `validated-hours-${from.slice(0, 10)}-${to.slice(0, 10)}.csv`),
  vehicles: () => request<VehicleAllocation[]>('GET', '/v1/operations/vehicles'),
  allocateVehicle: (body: { userId: string; vehicleId: string; description: string | null; allocatedFrom: string | null; allocatedUntil: string | null }) => request<VehicleAllocation>('POST', '/v1/operations/vehicles', body),
  uploadVehiclePhoto: (id: string, side: VehicleSide, file: File) => {
    const form = new FormData();
    form.append('file', file);
    return send<VehicleAllocation>('POST', `/v1/operations/vehicles/${id}/photos/${side}`, form);
  },
  vehiclePhotoUrl: (id: string, side: VehicleSide) => `/api/v1/operations/vehicles/${id}/photos/${side}`,
  completeVehicleCheck: (id: string, body: { odometerKm: number | null; damageNotes: string | null }) => request<VehicleAllocation>('POST', `/v1/operations/vehicles/${id}/check`, body),
  returnVehicle: (id: string) => request<VehicleAllocation>('POST', `/v1/operations/vehicles/${id}/return`),
  apparel: () => request<ApparelAssignment[]>('GET', '/v1/operations/apparel'),
  issueApparel: (body: { userId: string; item: string; size: string | null; quantity: number; issuedOn: string | null; notes: string | null }) => request<{ id: string }>('POST', '/v1/operations/apparel', body),
  returnApparel: (id: string) => request<{ id: string }>('POST', `/v1/operations/apparel/${id}/return`),
  rmaCases: () => request<RmaCase[]>('GET', '/v1/operations/rma'),
  openRma: (body: { storeId: string; productId: string | null; clientId: string | null; quantity: number; reason: string; description: string | null }) => request<RmaCase>('POST', '/v1/operations/rma', body),
  setRmaStatus: (id: string, status: RmaStatus) => request<RmaCase>('PATCH', `/v1/operations/rma/${id}/status`, { status }),
  stockClaims: () => request<StockClaim[]>('GET', '/v1/operations/stock-claims'),
  submitClaim: (body: { storeId: string; productId: string | null; clientId: string | null; claimType: string; quantity: number; amount: string | number; description: string | null }) => request<StockClaim>('POST', '/v1/operations/stock-claims', body),
  setClaimStatus: (id: string, status: ClaimStatus) => request<StockClaim>('PATCH', `/v1/operations/stock-claims/${id}/status`, { status }),
  mailStatus: () => request<MailStatus>('GET', '/v1/mail/status'),
  sendMail: (input: { to: string; subject: string; text: string; clientId?: string }) => request<{ messageId: string }>('POST', '/v1/mail/send', input),
  apiKeys: () => request<Page<ApiKey>>('GET', '/api-keys?limit=100'),
  createApiKey: (body: { name: string; expiresAt?: string }) => request<CreatedApiKey>('POST', '/api-keys', body),
  revokeApiKey: (id: string) => request<null>('DELETE', `/api-keys/${id}`),
  search: (q: string) => request<SearchHit[]>('GET', `/search${query({ q })}`),

  // RetailPower
  workOrders: (clientId?: string) => request<Page<WorkOrder>>('GET', `/work-orders${query({ limit: 100, clientId })}`),
  workOrder: (id: string) => request<WorkOrder>('GET', `/work-orders/${id}`),
  workOrderLogs: (id: string) => request<WorkOrderLog[]>('GET', `/work-orders/${id}/logs`),
  userAccounts: (params: { q?: string; role?: string; status?: string; page?: number; limit?: number }) =>
    request<UserAccountPage>('GET', `/users/accounts${query(params)}`),
  inviteUser: (body: { email: string; firstName: string; lastName: string; role: AccountRole; clientId?: string }) =>
    request<{ user: UserAccount; temporaryPassword: string }>('POST', '/users', body),
  setUserProfile: (id: string, body: { title: string | null; zone: string | null }) => request<UserAccount>('PATCH', `/users/${id}/profile`, body),
  setUserRole: (id: string, role: AccountRole) => request<UserAccount>('PATCH', `/users/${id}/role`, { role }),
  setUserStatus: (id: string, isActive: boolean) => request<UserAccount>('PATCH', `/users/${id}/status`, { isActive }),
  updateWorkOrder: (id: string, body: { title?: string; description?: string | null; priority?: WorkOrderPriority }) =>
    request<WorkOrder>('PATCH', `/work-orders/${id}`, body),
  updateStore: (id: string, body: Partial<Pick<Store, 'storeCode' | 'name' | 'address' | 'city' | 'postalCode' | 'country' | 'status' | 'clientId'>>) =>
    request<Store>('PATCH', `/stores/${id}`, body),
  updateVisit: (id: string, body: { visitDate?: string; notes?: string | null; fieldRepId?: string }) =>
    request<Visit>('PATCH', `/visits/${id}`, body),
  updateAgreement: (id: string, body: { title?: string; documentUrl?: string; annualValue?: string; churnRisk?: string; endDate?: string | null }) =>
    request<Agreement>('PATCH', `/v1/agreements/${id}`, body),
  createWorkOrder: (body: { title: string; description?: string; priority?: WorkOrderPriority; assignedUserId?: string | null }) =>
    request<WorkOrder>('POST', '/work-orders', body),
  assignWorkOrder: (id: string, assignedUserId: string | null) =>
    request<WorkOrder>('PATCH', `/work-orders/${id}/assign`, { assignedUserId }),
  setWorkOrderStatus: (id: string, status: WorkOrderStatus) => request<WorkOrder>('PATCH', `/work-orders/${id}/status`, { status }),
  stores: () => request<Page<Store>>('GET', '/stores?limit=100'),
  createStore: (body: { storeCode: string; name: string; address?: string; city?: string; postalCode?: string; country?: string; clientId?: string | null }) =>
    request<Store>('POST', '/stores', body),
  visits: (storeId?: string, clientId?: string) => request<Page<Visit>>('GET', `/visits${query({ limit: 100, storeId, clientId })}`),
  visitSummary: (id: string) => request<VisitSummary>('GET', `/visits/${id}/summary`),
  createVisit: (body: { storeId: string; visitDate: string; fieldRepId?: string | null; workOrderId?: string | null; notes?: string }) =>
    request<Visit>('POST', '/visits', body),
  setVisitStatus: (id: string, status: VisitStatus) => request<Visit>('PATCH', `/visits/${id}/status`, { status }),
  saveVisitReport: (id: string, body: { summary: string; auditData: Record<string, unknown> }) =>
    request<VisitReport>('POST', `/visits/${id}/report`, body),
  uploadVisitPhoto: (id: string, file: File) => {
    const form = new FormData();
    form.append('file', file);
    return send<VisitMedia>('POST', `/visits/${id}/media`, form);
  },
  deleteVisitPhoto: (visitId: string, mediaId: string) => request<null>('DELETE', `/visits/${visitId}/media/${mediaId}`),
  /** Photos need the bearer token, so they are fetched as blobs and shown via object URLs. */
  photoBlob: async (url: string) => {
    const response = await fetch(url, { headers: { Authorization: `Bearer ${await accessToken()}`, ...organisationHeader() } });
    if (!response.ok) throw new ApiError(response.status, response.statusText);
    return response.blob();
  },

  // Nexus
  models: () => request<FinancialModel[]>('GET', '/v1/financials/models'),
  model: (id: string) => request<FinancialModel>('GET', `/v1/financials/models/${id}`),
  createModel: (body: { modelName: string; fiscalYear: number; metadata?: Record<string, unknown> }) =>
    request<FinancialModel>('POST', '/v1/financials/models', body),
  setModelStatus: (id: string, status: PlanStatus) => request<FinancialModel>('PATCH', `/v1/financials/models/${id}/status`, { status }),
  lineItems: (modelId: string) => request<LineItem[]>('GET', `/v1/financials/models/${modelId}/line-items`),
  createLineItem: (
    modelId: string,
    body: { category: Category; subcategory?: string; periodCode: string; projectedAmount: string; actualAmount?: string | null },
  ) => request<LineItem>('POST', `/v1/financials/models/${modelId}/line-items`, body),
  updateLineItem: (id: string, body: { projectedAmount?: string; actualAmount?: string | null }) =>
    request<LineItem>('PATCH', `/v1/financials/line-items/${id}`, body),
  pnl: (params: { modelId?: string; period?: string }) => request<Pnl>('GET', `/v1/financials/pnl${query(params)}`),
  engagement: (roomId?: string) => request<EngagementStatus>('GET', `/v1/nexus/dsr-status${query({ dsrId: roomId })}`),
  activities: (roomId: string) => request<RoomActivity[]>('GET', `/v1/nexus/dsr-activities${query({ dsrId: roomId })}`),
  recordActivity: (body: { dsrId: string; stakeholderEmail: string; activityType: string; details?: Record<string, unknown> }) =>
    request<RoomActivity>('POST', '/v1/nexus/dsr-activities', body),
  alerts: () => request<Alerts>('GET', '/v1/nexus/anomalies'),
  deals: (params: { stage?: DealStage; clientId?: string } = {}) => {
    const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][]).toString();
    return request<Deal[]>('GET', `/v1/deals${q ? `?${q}` : ''}`);
  },
  deal: (id: string) => request<DealRecord>('GET', `/v1/deals/${id}`),
  createDeal: (body: DealInput) => request<DealRecord>('POST', '/v1/deals', body),
  updateDeal: (id: string, body: Partial<Omit<DealInput, 'stage'>>) => request<DealRecord>('PATCH', `/v1/deals/${id}`, body),
  setDealStage: (id: string, stage: DealStage) => request<DealRecord>('PATCH', `/v1/deals/${id}/stage`, { stage }),
  deleteDeal: (id: string) => request<void>('DELETE', `/v1/deals/${id}`).then(() => true),
  milestones: (roomId: string) => request<Milestone[]>('GET', `/v1/nexus/client-rooms/${roomId}/milestones`),
  addMilestone: (roomId: string, body: { title: string; ownerSide: MilestoneOwnerSide; dueDate: string | null }) =>
    request<Milestone>('POST', `/v1/nexus/client-rooms/${roomId}/milestones`, body),
  updateMilestone: (roomId: string, id: string, body: Partial<{ title: string; ownerSide: MilestoneOwnerSide; dueDate: string | null; completed: boolean }>) =>
    request<Milestone>('PATCH', `/v1/nexus/client-rooms/${roomId}/milestones/${id}`, body),
  deleteMilestone: (roomId: string, id: string) => request<void>('DELETE', `/v1/nexus/client-rooms/${roomId}/milestones/${id}`).then(() => true),
  invoices: (params: { clientId?: string; status?: InvoiceStatus } = {}) => {
    const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][]).toString();
    return request<Invoice[]>('GET', `/v1/invoices${q ? `?${q}` : ''}`);
  },
  clientInvoices: (clientId: string) => request<Invoice[]>('GET', `/v1/clients/${clientId}/invoices`),
  createInvoice: (body: InvoiceInput) => request<Invoice>('POST', '/v1/invoices', body),
  setInvoiceStatus: (id: string, status: InvoiceStatus) => request<Invoice>('PATCH', `/v1/invoices/${id}/status`, { status }),
  creditHolds: (includeReleased = false) => request<CreditHold[]>('GET', `/v1/governance/credit-holds${includeReleased ? '?includeReleased=true' : ''}`),
  createCreditHold: (body: { clientId: string | null; reason: string }) => request<CreditHold>('POST', '/v1/governance/credit-holds', body),
  releaseCreditHold: (id: string) => request<CreditHold>('DELETE', `/v1/governance/credit-holds/${id}`),
  waterfall: (fiscalYear: number) => request<Waterfall>('GET', `/v1/financials/waterfall?fiscalYear=${fiscalYear}`),
  rooms: () => request<ClientRoom[]>('GET', '/v1/dsrs'),
  room: (id: string) => request<ClientRoom>('GET', `/v1/dsrs/${id}`),
  createRoom: (body: { clientId: string; roomName: string; agreementId?: string | null }) => request<ClientRoom>('POST', '/v1/dsrs', body),
  setRoomStatus: (id: string, status: RoomStatus) => request<ClientRoom>('PATCH', `/v1/dsrs/${id}/status`, { status }),
  health: () => request<{ status: string }>('GET', '/health'),
  clients: () => request<Client[]>('GET', '/v1/clients'),
  approvals: (params: { mine?: boolean; entityId?: string; status?: string } = {}) =>
    request<Approval[]>('GET', `/v1/approvals${query({ mine: params.mine ? 'true' : undefined, entityId: params.entityId, status: params.status })}`),
  approval: (id: string) => request<Approval>('GET', `/v1/approvals/${id}`),
  requestApproval: (body: { entityType: ApprovalEntity; entityId: string; approverIds: string[]; note?: string | null }) => request<Approval>('POST', '/v1/approvals', body),
  decideApproval: (id: string, decision: 'approved' | 'rejected', comment?: string) => request<Approval>('POST', `/v1/approvals/${id}/decision`, { decision, comment: comment || null }),
  cancelApproval: (id: string) => request<Approval>('POST', `/v1/approvals/${id}/cancel`),
  exceptions: (status?: string) => request<ExceptionRecord[]>('GET', `/v1/exceptions${status ? `?status=${status}` : ''}`),
  exception: (id: string) => request<ExceptionRecord>('GET', `/v1/exceptions/${id}`),
  createException: (body: { title: string; description?: string | null; severity: ExceptionSeverity; ownerId?: string | null; storeId?: string | null; clientId?: string | null; source?: string | null }) =>
    request<ExceptionRecord>('POST', '/v1/exceptions', body),
  updateException: (id: string, body: Partial<{ title: string; description: string | null; severity: ExceptionSeverity; status: ExceptionStatus; ownerId: string | null; resolution: string | null }>) =>
    request<ExceptionRecord>('PATCH', `/v1/exceptions/${id}`, body),
  notifications: () => request<{ unread: number; items: AppNotification[] }>('GET', '/v1/notifications'),
  readNotifications: (id?: string) => request<null>('POST', '/v1/notifications/read', id ? { id } : {}),
  clientsHealth: () => request<ClientHealth[]>('GET', '/v1/clients-health'),
  priceLists: (clientId?: string) => request<PriceList[]>('GET', `/v1/price-lists${clientId ? `?clientId=${clientId}` : ''}`),
  priceList: (id: string) => request<PriceList>('GET', `/v1/price-lists/${id}`),
  createPriceList: (body: PriceListBody) => request<PriceList>('POST', '/v1/price-lists', body),
  updatePriceList: (id: string, body: Partial<PriceListBody>) => request<PriceList>('PATCH', `/v1/price-lists/${id}`, body),
  documentTemplates: (includeInactive = false) => request<{ placeholders: string[]; items: DocumentTemplate[] }>('GET', `/v1/document-templates${includeInactive ? '?includeInactive=true' : ''}`),
  createDocumentTemplate: (body: { name: string; kind: TemplateKind; body: string }) => request<DocumentTemplate>('POST', '/v1/document-templates', body),
  updateDocumentTemplate: (id: string, body: Partial<{ name: string; kind: TemplateKind; body: string; active: boolean }>) => request<DocumentTemplate>('PATCH', `/v1/document-templates/${id}`, body),
  renderTemplate: (id: string, target: { roomId?: string; clientId?: string }) => request<{ name: string; text: string; missing: string[] }>('POST', `/v1/document-templates/${id}/render`, target),
  generateRoomDocument: (roomId: string, templateId: string, title?: string) => request<RoomDocument>('POST', `/v1/nexus/client-rooms/${roomId}/documents/from-template`, { templateId, title: title || null }),
  products: (includeInactive = false) => request<Product[]>('GET', `/v1/field/products${includeInactive ? '?includeInactive=true' : ''}`),
  createProduct: (body: { sku: string; name: string; brand?: string | null; category?: string | null; unitPrice: string | number }) => request<Product>('POST', '/v1/field/products', body),
  updateProduct: (id: string, body: Partial<{ sku: string; name: string; brand: string | null; category: string | null; unitPrice: string | number; active: boolean }>) =>
    request<Product>('PATCH', `/v1/field/products/${id}`, body),
  planograms: (storeId?: string) => request<PlanogramSummary[]>('GET', `/v1/field/planograms${storeId ? `?storeId=${storeId}` : ''}`),
  planogram: (id: string) => request<Planogram>('GET', `/v1/field/planograms/${id}`),
  createPlanogram: (body: { name: string; category?: string | null; storeId?: string | null; items?: { productId: string; expectedFacings: number; shelf?: string | null }[] }) =>
    request<Planogram>('POST', '/v1/field/planograms', body),
  updatePlanogram: (id: string, body: Partial<{ name: string; category: string | null; storeId: string | null; active: boolean; items: { productId: string; expectedFacings: number; shelf?: string | null }[] }>) =>
    request<Planogram>('PATCH', `/v1/field/planograms/${id}`, body),
  fieldOrders: (status?: FieldOrderStatus) => request<FieldOrder[]>('GET', `/v1/field/orders${status ? `?status=${status}` : ''}`),
  fieldOrder: (id: string) => request<FieldOrder>('GET', `/v1/field/orders/${id}`),
  createFieldOrder: (body: { storeId: string; visitId?: string | null; notes?: string | null; lines: { productId: string; quantity: number }[] }) => request<FieldOrder>('POST', '/v1/field/orders', body),
  updateFieldOrder: (id: string, body: { notes?: string | null; lines?: { productId: string; quantity: number }[] }) => request<FieldOrder>('PATCH', `/v1/field/orders/${id}`, body),
  setFieldOrderStatus: (id: string, status: FieldOrderStatus) => request<FieldOrder>('PATCH', `/v1/field/orders/${id}/status`, { status }),
  auditRounds: () => request<AuditRound[]>('GET', '/v1/field/audit-rounds'),
  auditRound: (id: string) => request<AuditRound>('GET', `/v1/field/audit-rounds/${id}`),
  createAuditRound: (body: { name: string; checklist: string[]; dueDate?: string | null; visitDate: string; fieldRepId?: string | null; storeIds: string[] }) =>
    request<AuditRound>('POST', '/v1/field/audit-rounds', body),
  setAuditRoundStatus: (id: string, status: 'open' | 'closed') => request<AuditRound>('PATCH', `/v1/field/audit-rounds/${id}/status`, { status }),
  visitContext: (visitId: string) => request<VisitContext>('GET', `/v1/field/visits/${visitId}/context`),
  roomDocuments: (roomId: string) => request<RoomDocument[]>('GET', `/v1/nexus/client-rooms/${roomId}/documents`),
  documentVersions: (roomId: string, id: string) => request<RoomDocumentVersion[]>('GET', `/v1/nexus/client-rooms/${roomId}/documents/${id}/versions`),
  uploadRoomDocument: (roomId: string, file: File, fields: { title?: string; documentId?: string } = {}) => {
    const form = new FormData();
    form.append('file', file);
    if (fields.title) form.append('title', fields.title);
    if (fields.documentId) form.append('documentId', fields.documentId);
    return send<RoomDocument>('POST', `/v1/nexus/client-rooms/${roomId}/documents`, form);
  },
  editorStatus: () => request<{ connected: boolean; editor: string }>('GET', '/v1/documents/editor-status'),
  officeDocuments: (clientId: string) => request<OfficeDocument[]>('GET', `/v1/documents?clientId=${clientId}`),
  createOfficeDocument: (body: NewOfficeDocument) => request<OfficeDocument>('POST', '/v1/documents', body),
  officeVersions: (id: string) => request<OfficeVersion[]>('GET', `/v1/documents/${id}/versions`),
  officeSession: (id: string) => request<EditorSession>('POST', `/v1/documents/${id}/session`),
  downloadOfficeDocument: (id: string, fileName: string, version?: number) => downloadFile(`/v1/documents/${id}/download${version ? `?version=${version}` : ''}`, fileName),
  renameRoomDocument: (roomId: string, id: string, title: string) => request<RoomDocument>('PATCH', `/v1/nexus/client-rooms/${roomId}/documents/${id}`, { title }),
  deleteRoomDocument: (roomId: string, id: string) => request<null>('DELETE', `/v1/nexus/client-rooms/${roomId}/documents/${id}`),
  downloadRoomDocument: (roomId: string, id: string, fileName: string, version?: number) =>
    downloadFile(`/v1/nexus/client-rooms/${roomId}/documents/${id}/download${version ? `?version=${version}` : ''}`, fileName),
  signatures: (agreementId: string) => request<AgreementSignature[]>('GET', `/v1/agreements/${agreementId}/signatures`),
  signAgreement: (agreementId: string, body: { signerName: string; signatureImage: string }) =>
    request<AgreementSignature>('POST', `/v1/agreements/${agreementId}/signatures`, body),
  signatureImageUrl: (agreementId: string, signatureId: string) => `/api/v1/agreements/${agreementId}/signatures/${signatureId}/image`,
  client: (id: string) => request<ClientRecord>('GET', `/v1/clients/${id}`),
  createClient: (body: ClientInput) => request<Client>('POST', '/v1/clients', body),
  updateClient: (id: string, body: Partial<ClientInput> & { status?: ClientStatus }) => request<Client>('PATCH', `/v1/clients/${id}`, body),
  addContact: (clientId: string, body: ContactInput) => request<Contact>('POST', `/v1/clients/${clientId}/contacts`, body),
  updateContact: (clientId: string, contactId: string, body: Partial<ContactInput>) =>
    request<Contact>('PATCH', `/v1/clients/${clientId}/contacts/${contactId}`, body),
  agreements: () => request<Agreement[]>('GET', '/v1/agreements'),
  agreement: (id: string) => request<Agreement>('GET', `/v1/agreements/${id}`),
  createAgreement: (body: { clientId: string; title: string; documentUrl: string; annualValue?: string; churnRisk?: string; endDate?: string | null }) => request<Agreement>('POST', '/v1/agreements', body),
  setAgreementStatus: (id: string, status: AgreementStatus) => request<Agreement>('PATCH', `/v1/agreements/${id}/status`, { status }),
};

export interface OfficeDocument {
  id: string;
  title: string;
  clientId: string;
  clientName: string | null;
  clientRoomId: string | null;
  roomName: string | null;
  contactId: string | null;
  contactName: string | null;
  dealId: string | null;
  dealName: string | null;
  fileFormat: string | null;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  currentVersion: number;
  editable: boolean;
  lastModifiedByName: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OfficeVersion {
  id: string;
  version: number;
  fileName: string;
  sizeBytes: number;
  sha256: string;
  uploadedByName: string | null;
  createdAt: string;
}

export interface NewOfficeDocument {
  clientId: string;
  contactId?: string | null;
  clientRoomId?: string | null;
  title: string;
  format: 'docx' | 'xlsx' | 'pptx';
  templateId?: string | null;
  starterCsv?: string | null;
}

export interface EditorSession {
  documentId: string;
  editorUrl: string;
  accessToken: string;
  accessTokenTtl: number;
  documentTitle: string;
  clientName: string | null;
  contactName: string | null;
  fileFormat: string;
}
