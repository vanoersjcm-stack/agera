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
  const headers: Record<string, string> = { Authorization: `Bearer ${await accessToken()}` };
  if (contentType) headers['Content-Type'] = contentType;
  const response = await fetch(path.startsWith('/api/') ? path : `/api${path}`, { method, headers, body });
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = (data as { message?: string | string[] } | null)?.message;
    throw new ApiError(response.status, Array.isArray(message) ? message.join(', ') : (message ?? response.statusText));
  }
  return data as T;
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

/* ---------- Symphony ---------- */

export interface Tenant {
  id: string;
  name: string;
  domain: string;
  createdAt: string;
}

export interface UserProfile {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  roles: string[];
}

export type UserRole = 'platform-admin' | 'admin' | 'user';

export interface UserSummary {
  id: string;
  name: string;
  email: string;
  role: UserRole;
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

export interface Client {
  id: string;
  name: string;
  legalName: string | null;
  vatNumber: string | null;
  city: string | null;
  country: string | null;
  status: ClientStatus;
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

export type ClientInput = Pick<Client, 'name' | 'legalName' | 'vatNumber' | 'city' | 'country'>;
export type ContactInput = Omit<Contact, 'id' | 'clientId'>;

export interface ClientRecord {
  client: Client;
  contacts: Contact[];
  agreements: Agreement[];
  rooms: ClientRoom[];
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
  createdAt: string;
  updatedAt: string;
}

export type RoomStatus = 'active' | 'archived';

export interface ClientRoom {
  id: string;
  clientId: string;
  agreementId: string | null;
  roomName: string;
  status: RoomStatus;
  createdAt: string;
  updatedAt: string;
}

export const api = {
  // Symphony
  tenant: () => request<Tenant>('GET', '/tenants/me'),
  createTenant: (body: { name: string; domain: string }) => request<Tenant>('POST', '/tenants', body),
  me: () => request<UserProfile>('GET', '/users/me'),
  users: () => request<UserSummary[]>('GET', '/users'),
  auditLogs: (page: number, limit = 50) => request<Page<AuditLog>>('GET', `/audit-logs${query({ page, limit })}`),
  apiKeys: () => request<Page<ApiKey>>('GET', '/api-keys?limit=100'),
  createApiKey: (body: { name: string; expiresAt?: string }) => request<CreatedApiKey>('POST', '/api-keys', body),
  revokeApiKey: (id: string) => request<null>('DELETE', `/api-keys/${id}`),
  search: (q: string) => request<SearchHit[]>('GET', `/search${query({ q })}`),

  // RetailPower
  workOrders: () => request<Page<WorkOrder>>('GET', '/work-orders?limit=100'),
  workOrder: (id: string) => request<WorkOrder>('GET', `/work-orders/${id}`),
  workOrderLogs: (id: string) => request<WorkOrderLog[]>('GET', `/work-orders/${id}/logs`),
  userAccounts: (params: { q?: string; role?: string; status?: string; page?: number; limit?: number }) =>
    request<UserAccountPage>('GET', `/users/accounts${query(params)}`),
  inviteUser: (body: { email: string; firstName: string; lastName: string; role: AccountRole; clientId?: string }) =>
    request<{ user: UserAccount; temporaryPassword: string }>('POST', '/users', body),
  setUserRole: (id: string, role: AccountRole) => request<UserAccount>('PATCH', `/users/${id}/role`, { role }),
  setUserStatus: (id: string, isActive: boolean) => request<UserAccount>('PATCH', `/users/${id}/status`, { isActive }),
  updateWorkOrder: (id: string, body: { title?: string; description?: string | null; priority?: WorkOrderPriority }) =>
    request<WorkOrder>('PATCH', `/work-orders/${id}`, body),
  updateStore: (id: string, body: Partial<Pick<Store, 'storeCode' | 'name' | 'address' | 'city' | 'postalCode' | 'country' | 'status'>>) =>
    request<Store>('PATCH', `/stores/${id}`, body),
  updateVisit: (id: string, body: { visitDate?: string; notes?: string | null; fieldRepId?: string }) =>
    request<Visit>('PATCH', `/visits/${id}`, body),
  updateAgreement: (id: string, body: { title?: string; documentUrl?: string }) =>
    request<Agreement>('PATCH', `/v1/agreements/${id}`, body),
  createWorkOrder: (body: { title: string; description?: string; priority?: WorkOrderPriority; assignedUserId?: string | null }) =>
    request<WorkOrder>('POST', '/work-orders', body),
  assignWorkOrder: (id: string, assignedUserId: string | null) =>
    request<WorkOrder>('PATCH', `/work-orders/${id}/assign`, { assignedUserId }),
  setWorkOrderStatus: (id: string, status: WorkOrderStatus) => request<WorkOrder>('PATCH', `/work-orders/${id}/status`, { status }),
  stores: () => request<Page<Store>>('GET', '/stores?limit=100'),
  createStore: (body: { storeCode: string; name: string; address?: string; city?: string; postalCode?: string; country?: string }) =>
    request<Store>('POST', '/stores', body),
  visits: (storeId?: string) => request<Page<Visit>>('GET', `/visits${query({ limit: 100, storeId })}`),
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
    const response = await fetch(url, { headers: { Authorization: `Bearer ${await accessToken()}` } });
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
  rooms: () => request<ClientRoom[]>('GET', '/v1/dsrs'),
  room: (id: string) => request<ClientRoom>('GET', `/v1/dsrs/${id}`),
  createRoom: (body: { clientId: string; roomName: string; agreementId?: string | null }) => request<ClientRoom>('POST', '/v1/dsrs', body),
  setRoomStatus: (id: string, status: RoomStatus) => request<ClientRoom>('PATCH', `/v1/dsrs/${id}/status`, { status }),
  clients: () => request<Client[]>('GET', '/v1/clients'),
  client: (id: string) => request<ClientRecord>('GET', `/v1/clients/${id}`),
  createClient: (body: ClientInput) => request<Client>('POST', '/v1/clients', body),
  updateClient: (id: string, body: Partial<ClientInput> & { status?: ClientStatus }) => request<Client>('PATCH', `/v1/clients/${id}`, body),
  addContact: (clientId: string, body: ContactInput) => request<Contact>('POST', `/v1/clients/${clientId}/contacts`, body),
  updateContact: (clientId: string, contactId: string, body: Partial<ContactInput>) =>
    request<Contact>('PATCH', `/v1/clients/${clientId}/contacts/${contactId}`, body),
  agreements: () => request<Agreement[]>('GET', '/v1/agreements'),
  agreement: (id: string) => request<Agreement>('GET', `/v1/agreements/${id}`),
  createAgreement: (body: { clientId: string; title: string; documentUrl: string }) => request<Agreement>('POST', '/v1/agreements', body),
  setAgreementStatus: (id: string, status: AgreementStatus) => request<Agreement>('PATCH', `/v1/agreements/${id}/status`, { status }),
};
