import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { AuditService } from '../core/audit/audit.service.js';
import { TenantContext } from '../core/tenancy/tenant-context.service.js';
import { TenantTransaction } from '../core/tenancy/tenant-transaction.service.js';
import { assertEnterprise, licenseTier } from '../core/tenancy/license.js';
import { UserService } from '../user/user.service.js';

type ColumnType = 'text' | 'number' | 'date';
interface Column { label: string; sql: string; type: ColumnType }
interface Dataset { label: string; from: string; columns: Record<string, Column> }

const person = (alias: string) => `NULLIF(btrim(concat_ws(' ', ${alias}.first_name, ${alias}.last_name)), '')`;

/** Whitelisted report sources; every column is a fixed SQL expression, so user input never becomes SQL. */
export const DATASETS: Record<string, Dataset> = {
  clients: {
    label: 'Clients',
    from: 'clients x LEFT JOIN users am ON am.id = x.account_manager_id',
    columns: {
      name: { label: 'Client', sql: 'x.name', type: 'text' },
      city: { label: 'City', sql: 'x.city', type: 'text' },
      sector: { label: 'Sector', sql: 'x.sector', type: 'text' },
      status: { label: 'Status', sql: 'x.status', type: 'text' },
      creditStatus: { label: 'Credit status', sql: 'x.credit_status', type: 'text' },
      creditLimit: { label: 'Credit limit', sql: 'x.credit_limit', type: 'number' },
      paymentTerms: { label: 'Payment terms', sql: 'x.payment_terms', type: 'text' },
      accountManager: { label: 'Account manager', sql: person('am'), type: 'text' },
      createdAt: { label: 'Created', sql: 'x.created_at::date', type: 'date' },
    },
  },
  stores: {
    label: 'Stores',
    from: 'stores x LEFT JOIN clients c ON c.id = x.client_id',
    columns: {
      storeCode: { label: 'Store code', sql: 'x.store_code', type: 'text' },
      name: { label: 'Store', sql: 'x.name', type: 'text' },
      city: { label: 'City', sql: 'x.city', type: 'text' },
      status: { label: 'Status', sql: 'x.status', type: 'text' },
      client: { label: 'Client', sql: 'c.name', type: 'text' },
    },
  },
  visits: {
    label: 'Store visits',
    from: 'merchandising_visits x JOIN stores s ON s.id = x.store_id LEFT JOIN clients c ON c.id = s.client_id LEFT JOIN users u ON u.id = x.field_rep_id',
    columns: {
      visitDate: { label: 'Visit date', sql: 'x.visit_date::date', type: 'date' },
      status: { label: 'Status', sql: 'x.status', type: 'text' },
      store: { label: 'Store', sql: 's.name', type: 'text' },
      city: { label: 'City', sql: 's.city', type: 'text' },
      client: { label: 'Client', sql: 'c.name', type: 'text' },
      rep: { label: 'Field rep', sql: person('u'), type: 'text' },
    },
  },
  workOrders: {
    label: 'Work orders',
    from: 'work_orders x LEFT JOIN users u ON u.id = x.assigned_user_id',
    columns: {
      title: { label: 'Work order', sql: 'x.title', type: 'text' },
      status: { label: 'Status', sql: 'x.status', type: 'text' },
      priority: { label: 'Priority', sql: 'x.priority', type: 'text' },
      assignee: { label: 'Assignee', sql: person('u'), type: 'text' },
      createdAt: { label: 'Created', sql: 'x.created_at::date', type: 'date' },
      completedAt: { label: 'Completed', sql: 'x.completed_at::date', type: 'date' },
    },
  },
  agreements: {
    label: 'Agreements',
    from: 'agreements x LEFT JOIN clients c ON c.id = x.client_id',
    columns: {
      title: { label: 'Agreement', sql: 'x.title', type: 'text' },
      client: { label: 'Client', sql: 'c.name', type: 'text' },
      status: { label: 'Status', sql: 'x.status', type: 'text' },
      annualValue: { label: 'Annual value', sql: 'x.annual_value', type: 'number' },
      churnRisk: { label: 'Churn risk %', sql: 'x.churn_risk', type: 'number' },
      endDate: { label: 'End date', sql: 'x.end_date', type: 'date' },
    },
  },
  invoices: {
    label: 'Invoices',
    from: 'invoices x LEFT JOIN clients c ON c.id = x.client_id',
    columns: {
      invoiceNumber: { label: 'Invoice', sql: 'x.invoice_number', type: 'text' },
      client: { label: 'Client', sql: 'c.name', type: 'text' },
      status: { label: 'Status', sql: 'x.status', type: 'text' },
      issueDate: { label: 'Issued', sql: 'x.issue_date', type: 'date' },
      dueDate: { label: 'Due', sql: 'x.due_date', type: 'date' },
      amountExclVat: { label: 'Amount excl. VAT', sql: 'x.amount_excl_vat', type: 'number' },
      vatAmount: { label: 'VAT', sql: 'x.vat_amount', type: 'number' },
    },
  },
  deals: {
    label: 'Deals',
    from: 'deals x LEFT JOIN clients c ON c.id = x.client_id LEFT JOIN users u ON u.id = x.owner_id',
    columns: {
      title: { label: 'Deal', sql: 'x.title', type: 'text' },
      client: { label: 'Client', sql: 'c.name', type: 'text' },
      stage: { label: 'Stage', sql: 'x.stage', type: 'text' },
      priority: { label: 'Priority', sql: 'x.priority', type: 'text' },
      value: { label: 'Value', sql: 'x.value', type: 'number' },
      owner: { label: 'Owner', sql: person('u'), type: 'text' },
      dueDate: { label: 'Due', sql: 'x.due_date', type: 'date' },
    },
  },
  fieldOrders: {
    label: 'Field orders',
    from: 'field_orders x JOIN stores s ON s.id = x.store_id LEFT JOIN clients c ON c.id = s.client_id',
    columns: {
      store: { label: 'Store', sql: 's.name', type: 'text' },
      client: { label: 'Client', sql: 'c.name', type: 'text' },
      status: { label: 'Status', sql: 'x.status', type: 'text' },
      createdAt: { label: 'Created', sql: 'x.created_at::date', type: 'date' },
      submittedAt: { label: 'Submitted', sql: 'x.submitted_at::date', type: 'date' },
    },
  },
  exceptions: {
    label: 'Exceptions',
    from: 'exceptions x LEFT JOIN clients c ON c.id = x.client_id LEFT JOIN users u ON u.id = x.owner_id',
    columns: {
      title: { label: 'Exception', sql: 'x.title', type: 'text' },
      severity: { label: 'Severity', sql: 'x.severity', type: 'text' },
      status: { label: 'Status', sql: 'x.status', type: 'text' },
      client: { label: 'Client', sql: 'c.name', type: 'text' },
      owner: { label: 'Owner', sql: person('u'), type: 'text' },
      createdAt: { label: 'Created', sql: 'x.created_at::date', type: 'date' },
    },
  },
};

export const FILTER_OPS = ['equals', 'not_equals', 'contains', 'gt', 'lt'] as const;
export const AGGREGATES = ['count', 'sum', 'avg', 'min', 'max'] as const;

export interface ReportDefinition {
  dataset: string;
  columns: string[];
  filters: { column: string; op: (typeof FILTER_OPS)[number]; value: string }[];
  groupBy: string | null;
  aggregate: { fn: (typeof AGGREGATES)[number]; column: string | null } | null;
  sort: { column: string; direction: 'asc' | 'desc' } | null;
  limit: number;
}
export interface ReportResult { columns: { key: string; label: string; type: ColumnType }[]; rows: Record<string, unknown>[] }

const SAVED_SQL = 'SELECT id, name, definition, pinned, created_at AS "createdAt", updated_at AS "updatedAt" FROM saved_reports';

export function toCsv(result: ReportResult): string {
  const cell = (v: unknown) => {
    const s = v === null || v === undefined ? '' : v instanceof Date ? v.toISOString().slice(0, 10) : String(v);
    return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [result.columns.map((c) => cell(c.label)).join(','), ...result.rows.map((r) => result.columns.map((c) => cell(r[c.key])).join(','))].join('\r\n') + '\r\n';
}

@Injectable()
export class ReportsService {
  constructor(
    private readonly context: TenantContext,
    private readonly tx: TenantTransaction,
    private readonly userService: UserService,
    private readonly audit: AuditService,
  ) {}

  private get t(): string {
    return this.context.tenantId;
  }

  datasets(): unknown {
    return Object.entries(DATASETS).map(([key, d]) => ({ key, label: d.label, columns: Object.entries(d.columns).map(([k, c]) => ({ key: k, label: c.label, type: c.type })) }));
  }

  /** Fixed KPI dashboard, available in every edition. */
  async kpis(): Promise<unknown> {
    return this.tx.run(async (m) => {
      const [row] = await m.query(
        `SELECT
           (SELECT count(*)::int FROM clients WHERE tenant_id = $1 AND status = 'active') AS "activeClients",
           (SELECT COALESCE(sum(annual_value), 0)::text FROM agreements WHERE tenant_id = $1 AND status = 'active') AS "activeAgreementValue",
           (SELECT count(*)::int FROM deals WHERE tenant_id = $1 AND stage NOT IN ('ops_handoff')) AS "openDeals",
           (SELECT COALESCE(sum(value), 0)::text FROM deals WHERE tenant_id = $1 AND stage NOT IN ('ops_handoff')) AS "pipelineValue",
           (SELECT count(*)::int FROM invoices WHERE tenant_id = $1 AND status <> 'paid' AND due_date < CURRENT_DATE) AS "overdueInvoices",
           (SELECT COALESCE(sum(amount_excl_vat + vat_amount), 0)::text FROM invoices WHERE tenant_id = $1 AND status <> 'paid' AND due_date < CURRENT_DATE) AS "overdueAmount",
           (SELECT count(*)::int FROM exceptions WHERE tenant_id = $1 AND status <> 'resolved') AS "openExceptions",
           (SELECT count(*)::int FROM work_orders WHERE tenant_id = $1 AND status NOT IN ('completed', 'cancelled')) AS "openWorkOrders",
           (SELECT count(*)::int FROM merchandising_visits WHERE tenant_id = $1 AND status = 'completed' AND visit_date >= date_trunc('month', NOW())) AS "visitsCompletedThisMonth",
           (SELECT count(*)::int FROM merchandising_visits WHERE tenant_id = $1 AND visit_date >= date_trunc('month', NOW())) AS "visitsThisMonth"`,
        [this.t],
      );
      const dealsByStage = await m.query('SELECT stage, count(*)::int AS count, COALESCE(sum(value), 0)::text AS value FROM deals WHERE tenant_id = $1 GROUP BY stage', [this.t]);
      const invoicesByStatus = await m.query('SELECT status, count(*)::int AS count, COALESCE(sum(amount_excl_vat), 0)::text AS value FROM invoices WHERE tenant_id = $1 GROUP BY status', [this.t]);
      return { ...row, dealsByStage, invoicesByStatus, tier: await licenseTier(m, this.t) };
    });
  }

  /** CSV with every column of a dataset (all editions). */
  async export(key: string, identity: AuthenticatedUser): Promise<string> {
    const ds = DATASETS[key];
    if (!ds) throw new NotFoundException('Unknown dataset');
    const result = await this.tx.run((m) => this.query(m, { dataset: key, columns: Object.keys(ds.columns), filters: [], groupBy: null, aggregate: null, sort: null, limit: 10000 }));
    const actor = await this.userService.resolveActor(identity);
    this.audit.logAction(this.t, actor.id, 'report.exported', { dataset: key, rows: result.rows.length });
    return toCsv(result);
  }

  /** Custom report builder (Enterprise only). */
  async run(def: ReportDefinition): Promise<ReportResult> {
    return this.tx.run(async (m) => {
      await assertEnterprise(m, this.t, 'The custom report builder');
      return this.query(m, def);
    });
  }

  validate(def: ReportDefinition): void {
    const ds = DATASETS[def.dataset];
    if (!ds) throw new BadRequestException(`dataset must be one of: ${Object.keys(DATASETS).join(', ')}`);
    const known = (c: string, what: string) => {
      if (!ds.columns[c]) throw new BadRequestException(`${what} "${c}" is not a column of ${def.dataset}`);
    };
    def.columns.forEach((c) => known(c, 'Column'));
    def.filters.forEach((f) => known(f.column, 'Filter column'));
    if (def.groupBy) known(def.groupBy, 'Group-by column');
    if (def.aggregate?.column) known(def.aggregate.column, 'Aggregate column');
    if (def.aggregate && def.aggregate.fn !== 'count' && !def.aggregate.column) throw new BadRequestException(`${def.aggregate.fn} needs a column`);
    if (def.sort) known(def.sort.column, 'Sort column');
    if (!def.groupBy && def.columns.length === 0) throw new BadRequestException('Choose at least one column');
  }

  private async query(m: EntityManager, def: ReportDefinition): Promise<ReportResult> {
    this.validate(def);
    const ds = DATASETS[def.dataset];
    const params: unknown[] = [this.t];
    const where = ['x.tenant_id = $1'];
    for (const f of def.filters) {
      const col = ds.columns[f.column];
      params.push(f.op === 'contains' ? `%${f.value}%` : f.value);
      const p = `$${params.length}`;
      const cast = col.type === 'number' ? '::numeric' : col.type === 'date' ? '::date' : '';
      if (f.op === 'contains') where.push(`${col.sql}::text ILIKE ${p}`);
      else if (f.op === 'equals') where.push(col.type === 'text' ? `lower(${col.sql}) = lower(${p})` : `${col.sql} = ${p}${cast}`);
      else if (f.op === 'not_equals') where.push(col.type === 'text' ? `lower(${col.sql}) IS DISTINCT FROM lower(${p})` : `${col.sql} IS DISTINCT FROM ${p}${cast}`);
      else where.push(`${col.sql} ${f.op === 'gt' ? '>' : '<'} ${p}${cast}`);
    }
    let select: string[];
    let columns: ReportResult['columns'];
    let group = '';
    if (def.groupBy) {
      const g = ds.columns[def.groupBy];
      const agg = def.aggregate ?? { fn: 'count' as const, column: null };
      const aggCol = agg.column ? ds.columns[agg.column] : null;
      const expr = agg.fn === 'count' ? 'count(*)' : `round(${agg.fn}(${aggCol!.sql})::numeric, 2)`;
      select = [`${g.sql} AS "${def.groupBy}"`, `${expr} AS "value"`];
      columns = [{ key: def.groupBy, label: g.label, type: g.type }, { key: 'value', label: agg.fn === 'count' ? 'Count' : `${agg.fn[0].toUpperCase()}${agg.fn.slice(1)} of ${aggCol!.label}`, type: 'number' }];
      group = ` GROUP BY 1`;
    } else {
      select = def.columns.map((c) => `${ds.columns[c].sql} AS "${c}"`);
      columns = def.columns.map((c) => ({ key: c, label: ds.columns[c].label, type: ds.columns[c].type }));
    }
    const order = def.sort
      ? ` ORDER BY ${def.groupBy && def.sort.column !== def.groupBy ? '2' : ds.columns[def.sort.column].sql} ${def.sort.direction === 'desc' ? 'DESC' : 'ASC'} NULLS LAST`
      : def.groupBy ? ' ORDER BY 2 DESC' : '';
    params.push(Math.min(Math.max(def.limit, 1), 10000));
    const rows = await m.query(`SELECT ${select.join(', ')} FROM ${ds.from} WHERE ${where.join(' AND ')}${group}${order} LIMIT $${params.length}`, params);
    return { columns, rows };
  }

  // Saved reports / cockpit tabs (Enterprise) ------------------------------------------------------------------------

  async saved(): Promise<unknown[]> {
    return this.tx.run(async (m) => {
      await assertEnterprise(m, this.t, 'Saved reports and cockpits');
      return m.query(`${SAVED_SQL} WHERE tenant_id = $1 ORDER BY pinned DESC, name`, [this.t]);
    });
  }

  async save(name: string, def: ReportDefinition, pinned: boolean, identity: AuthenticatedUser): Promise<unknown> {
    this.validate(def);
    const actor = await this.userService.resolveActor(identity);
    const row = await this.tx.run(async (m) => {
      await assertEnterprise(m, this.t, 'Saved reports and cockpits');
      const [r] = await m.query(`INSERT INTO saved_reports (tenant_id, name, definition, pinned, created_by) VALUES ($1,$2,$3::jsonb,$4,$5) RETURNING id`, [this.t, name, JSON.stringify(def), pinned, actor.id]);
      return (await m.query(`${SAVED_SQL} WHERE id = $1`, [r.id]))[0];
    });
    this.audit.logAction(this.t, actor.id, 'report.saved', { reportId: row.id });
    return row;
  }

  async updateSaved(id: string, changes: { name?: string; definition?: ReportDefinition; pinned?: boolean }): Promise<unknown> {
    if (changes.definition) this.validate(changes.definition);
    return this.tx.run(async (m) => {
      await assertEnterprise(m, this.t, 'Saved reports and cockpits');
      const [r] = await m.query(
        `UPDATE saved_reports SET name = COALESCE($3, name), definition = COALESCE($4::jsonb, definition), pinned = COALESCE($5, pinned) WHERE tenant_id = $1 AND id = $2 RETURNING id`,
        [this.t, id, changes.name ?? null, changes.definition ? JSON.stringify(changes.definition) : null, changes.pinned ?? null],
      );
      if (!r) throw new NotFoundException('Report not found');
      return (await m.query(`${SAVED_SQL} WHERE id = $1`, [id]))[0];
    });
  }

  async removeSaved(id: string): Promise<void> {
    await this.tx.run(async (m) => {
      await assertEnterprise(m, this.t, 'Saved reports and cockpits');
      const [r] = await m.query('DELETE FROM saved_reports WHERE tenant_id = $1 AND id = $2 RETURNING id', [this.t, id]);
      if (!r) throw new NotFoundException('Report not found');
    });
  }
}
