import { accessToken } from './auth';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { Authorization: `Bearer ${await accessToken()}` };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  const response = await fetch(`/api${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = (data as { message?: string | string[] } | null)?.message;
    throw new ApiError(response.status, Array.isArray(message) ? message.join(', ') : (message ?? response.statusText));
  }
  return data as T;
}

export type Category = 'revenue' | 'cogs' | 'opex' | 'license_fee';

export interface Tenant {
  id: string;
  name: string;
}

export interface FinancialModel {
  id: string;
  modelName: string;
  fiscalYear: number;
  status: 'draft' | 'approved' | 'archived';
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

export interface DsrState {
  dsrId: string;
  activityCount: number;
  stakeholderCount: number;
  lastActivityAt: string;
  activityCounts: Record<string, number>;
  stakeholders: StakeholderState[];
}

export interface DsrStatus {
  generatedAt: string;
  windowDays: number;
  summary: { activeDsrs: number; stakeholders: number; accepted: number; rejected: number; pending: number };
  dsrs: DsrState[];
}

export interface CommandResult {
  intent: string;
  navigateTo: string | null;
  parameters: Record<string, string>;
}

export const api = {
  tenant: () => request<Tenant>('GET', '/tenants/me'),
  models: () => request<FinancialModel[]>('GET', '/v1/financials/models'),
  pnl: (params: { modelId?: string; period?: string }) => {
    const query = new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][]);
    return request<Pnl>('GET', `/v1/financials/pnl${query.size ? `?${query}` : ''}`);
  },
  dsrStatus: (dsrId?: string) => request<DsrStatus>('GET', `/v1/nexus/dsr-status${dsrId ? `?dsrId=${dsrId}` : ''}`),
  command: (command: string, contextRoute: string) =>
    request<CommandResult>('POST', '/v1/nexus/command', { command, contextRoute }),
};
