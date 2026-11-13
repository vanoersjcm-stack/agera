import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { type EntityManager, QueryFailedError, type Repository } from 'typeorm';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { AuditService } from '../core/audit/audit.service.js';
import { TenantContext } from '../core/tenancy/tenant-context.service.js';
import { TenantRepository } from '../core/tenancy/tenant-repository.js';
import { TenantTransaction } from '../core/tenancy/tenant-transaction.service.js';
import { UserService } from '../user/user.service.js';
import { Invoice, INVOICE_TRANSITIONS, type InvoiceStatus } from './invoice.entity.js';
import { assertStatusWritable } from '../core/idms/idms.js';

export interface InvoiceInput {
  clientId: string;
  /** Empty: the next INV-YYYY-XXXX number of the organisation. */
  invoiceNumber?: string;
  description: string | null;
  issueDate: string;
  dueDate: string | null;
  amountExclVat: string;
  vatAmount: string;
  status?: 'draft' | 'issued';
}
export type InvoiceUpdate = Partial<Omit<InvoiceInput, 'clientId' | 'status'>>;

export const LINE_SOURCES = ['agreement', 'store_visit', 'manual'] as const;
export type LineSource = (typeof LINE_SOURCES)[number];

export interface InvoiceLineInput {
  sourceType: LineSource;
  sourceId: string | null;
  description: string | null;
  quantity: string;
  unitPrice: string;
}

export interface GenerateInvoiceInput {
  clientId: string;
  description: string | null;
  issueDate: string;
  dueDate: string | null;
  vatRate: string;
  lines: InvoiceLineInput[];
}

export interface InvoiceLineView {
  id: string;
  position: number;
  sourceType: LineSource;
  sourceId: string | null;
  description: string;
  quantity: string;
  unitPrice: string;
  lineTotal: string;
}

export interface BillableSources {
  agreements: { id: string; title: string; annualValue: string; suggestedAmount: string }[];
  visits: { id: string; storeName: string; visitDate: string }[];
}

const cents = (value: string | number): number => Math.round(Number(value) * 100);
const euros = (value: number): string => (value / 100).toFixed(2);

export interface InvoiceView {
  id: string;
  clientId: string;
  clientName: string;
  invoiceNumber: string;
  idmsStatus: string;
  description: string | null;
  issueDate: string;
  dueDate: string | null;
  amountExclVat: string;
  vatAmount: string;
  vatRate: string | null;
  totalAmount: string;
  status: InvoiceStatus;
  overdue: boolean;
  paidAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const INVOICE_SQL = `
  SELECT i.id, i.client_id AS "clientId", c.name AS "clientName", i.invoice_number AS "invoiceNumber", i.description,
         to_char(i.issue_date, 'YYYY-MM-DD') AS "issueDate", to_char(i.due_date, 'YYYY-MM-DD') AS "dueDate",
         i.amount_excl_vat::text AS "amountExclVat", i.vat_amount::text AS "vatAmount", i.vat_rate::text AS "vatRate", (i.amount_excl_vat + i.vat_amount)::text AS "totalAmount",
         i.status, i.idms_status AS "idmsStatus", (i.status = 'issued' AND i.due_date < current_date) AS overdue,
         i.paid_at AS "paidAt", i.created_at AS "createdAt", i.updated_at AS "updatedAt"
    FROM invoices i JOIN clients c ON c.tenant_id = i.tenant_id AND c.id = i.client_id
   WHERE i.tenant_id = $1`;

@Injectable()
export class InvoicesService {
  private readonly invoices: TenantRepository<Invoice>;

  constructor(
    @InjectRepository(Invoice) invoices: Repository<Invoice>,
    private readonly context: TenantContext,
    private readonly tx: TenantTransaction,
    private readonly userService: UserService,
    private readonly audit: AuditService,
  ) {
    this.invoices = new TenantRepository(invoices, context);
  }

  list(filter: { clientId?: string; status?: InvoiceStatus }): Promise<InvoiceView[]> {
    return this.tx.run((manager) => {
      const params: unknown[] = [this.context.tenantId];
      let sql = INVOICE_SQL;
      if (filter.clientId) sql += ` AND i.client_id = $${params.push(filter.clientId)}`;
      if (filter.status) sql += ` AND i.status = $${params.push(filter.status)}`;
      return manager.query(`${sql} ORDER BY i.issue_date DESC, i.invoice_number DESC`, params);
    });
  }

  async listForClient(clientId: string): Promise<InvoiceView[]> {
    await this.tx.run(async (manager) => {
      const [client] = await manager.query('SELECT id FROM clients WHERE tenant_id = $1 AND id = $2', [this.context.tenantId, clientId]);
      if (!client) throw new NotFoundException('Client not found');
    });
    return this.list({ clientId });
  }

  get(id: string): Promise<InvoiceView> {
    return this.tx.run((manager) => this.load(manager, id));
  }

  async create(input: InvoiceInput, identity: AuthenticatedUser): Promise<InvoiceView> {
    const actor = await this.userService.resolveActor(identity);
    const view = await this.tx.run(async (manager) => {
      const [client] = await manager.query('SELECT id FROM clients WHERE tenant_id = $1 AND id = $2', [this.context.tenantId, input.clientId]);
      if (!client) throw new BadRequestException('clientId must be a client of the active tenant');
      const repository = this.invoices.withManager(manager);
      const invoiceNumber = input.invoiceNumber || (await this.nextNumber(manager, input.issueDate));
      const saved = await this.unique(() => repository.save(repository.create({ ...input, invoiceNumber, status: input.status ?? 'draft' })));
      return this.load(manager, saved.id);
    });
    this.audit.logAction(this.context.tenantId, actor.id, 'invoice.created', { invoiceId: view.id, clientId: view.clientId, invoiceNumber: view.invoiceNumber });
    return view;
  }

  async update(id: string, changes: InvoiceUpdate, identity: AuthenticatedUser): Promise<InvoiceView> {
    const actor = await this.userService.resolveActor(identity);
    const view = await this.tx.run(async (manager) => {
      const repository = this.invoices.withManager(manager);
      const invoice = await repository.findOneBy({ id });
      if (!invoice) throw new NotFoundException('Invoice not found');
      assertStatusWritable(invoice.idmsStatus);
      if (invoice.status !== 'draft') throw new ConflictException('Only draft invoices can be edited');
      await this.assertNoPendingApproval(manager, id);
      Object.assign(invoice, changes);
      if (invoice.dueDate && invoice.dueDate < invoice.issueDate) throw new BadRequestException('dueDate must be on or after issueDate');
      await this.unique(() => repository.save(invoice));
      return this.load(manager, id);
    });
    this.audit.logAction(this.context.tenantId, actor.id, 'invoice.updated', { invoiceId: id, changes: Object.keys(changes) });
    return view;
  }

  async changeStatus(id: string, status: InvoiceStatus, identity: AuthenticatedUser): Promise<InvoiceView> {
    const actor = await this.userService.resolveActor(identity);
    let previous: InvoiceStatus = status;
    const view = await this.tx.run(async (manager) => {
      const repository = this.invoices.withManager(manager);
      const invoice = await repository.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!invoice) throw new NotFoundException('Invoice not found');
      assertStatusWritable(invoice.idmsStatus, true);
      previous = invoice.status;
      if (invoice.status === 'draft') await this.assertNoPendingApproval(manager, id);
      if (!INVOICE_TRANSITIONS[invoice.status].includes(status)) {
        throw new ConflictException(`An invoice that is ${invoice.status} cannot become ${status}`);
      }
      invoice.status = status;
      invoice.paidAt = status === 'paid' ? new Date() : null;
      await repository.save(invoice);
      return this.load(manager, id);
    });
    this.audit.logAction(this.context.tenantId, actor.id, 'invoice.status_changed', { invoiceId: id, from: previous, to: status });
    return view;
  }

  /** Approved agreements (active) and completed store visits of the client's stores that are not invoiced yet. */
  billable(clientId: string): Promise<BillableSources> {
    return this.tx.run(async (m) => {
      const [client] = await m.query('SELECT id FROM clients WHERE tenant_id = $1 AND id = $2', [this.context.tenantId, clientId]);
      if (!client) throw new NotFoundException('Client not found');
      const agreements = await m.query(
        `SELECT id, title, annual_value::text AS "annualValue", round(annual_value / 12, 2)::text AS "suggestedAmount"
           FROM agreements WHERE tenant_id = $1 AND client_id = $2 AND status = 'active' ORDER BY title`,
        [this.context.tenantId, clientId],
      );
      const visits = await m.query(
        `SELECT v.id, s.name AS "storeName", to_char(v.visit_date, 'YYYY-MM-DD') AS "visitDate"
           FROM merchandising_visits v JOIN stores s ON s.tenant_id = v.tenant_id AND s.id = v.store_id
          WHERE v.tenant_id = $1 AND s.client_id = $2 AND v.status = 'COMPLETED'
            AND NOT EXISTS (SELECT 1 FROM invoice_lines l WHERE l.tenant_id = v.tenant_id AND l.source_type = 'store_visit' AND l.source_id = v.id)
          ORDER BY v.visit_date DESC LIMIT 300`,
        [this.context.tenantId, clientId],
      );
      return { agreements, visits };
    });
  }

  /** A draft invoice with an automatic number and lines from approved agreements, completed store visits or free text. */
  async generate(input: GenerateInvoiceInput, identity: AuthenticatedUser): Promise<InvoiceView> {
    const actor = await this.userService.resolveActor(identity);
    const t = this.context.tenantId;
    const view = await this.tx.run(async (m) => {
      const [client] = await m.query('SELECT id FROM clients WHERE tenant_id = $1 AND id = $2', [t, input.clientId]);
      if (!client) throw new BadRequestException('clientId must be a client of the active tenant');
      const lines: (InvoiceLineInput & { description: string; total: number })[] = [];
      const seen = new Set<string>();
      for (const line of input.lines) {
        let description = line.description;
        if (line.sourceId) {
          if (seen.has(line.sourceId)) throw new BadRequestException('Each agreement or store visit can be on the invoice once');
          seen.add(line.sourceId);
        }
        if (line.sourceType === 'agreement') {
          const [a] = await m.query(`SELECT title FROM agreements WHERE tenant_id = $1 AND id = $2 AND client_id = $3 AND status = 'active'`, [t, line.sourceId, input.clientId]);
          if (!a) throw new BadRequestException('Agreement lines need an approved (active) agreement of this client');
          description ||= `Agreement: ${a.title}`;
        } else if (line.sourceType === 'store_visit') {
          const [v] = await m.query(
            `SELECT s.name, to_char(v.visit_date, 'YYYY-MM-DD') AS day FROM merchandising_visits v JOIN stores s ON s.tenant_id = v.tenant_id AND s.id = v.store_id
              WHERE v.tenant_id = $1 AND v.id = $2 AND s.client_id = $3 AND v.status = 'COMPLETED'`,
            [t, line.sourceId, input.clientId],
          );
          if (!v) throw new BadRequestException('Store visit lines need a completed visit to a store of this client');
          const [billed] = await m.query(`SELECT 1 FROM invoice_lines WHERE tenant_id = $1 AND source_type = 'store_visit' AND source_id = $2`, [t, line.sourceId]);
          if (billed) throw new ConflictException('This store visit is already on an invoice');
          description ||= `Store visit ${v.name} (${v.day})`;
        } else if (!description) {
          throw new BadRequestException('Free lines need a description');
        }
        lines.push({ ...line, description: description.slice(0, 255), total: Math.round(Number(line.quantity) * Number(line.unitPrice) * 100) });
      }
      const subtotal = lines.reduce((sum, l) => sum + l.total, 0);
      const vat = Math.round((subtotal * cents(input.vatRate)) / 10000);
      const repository = this.invoices.withManager(m);
      const invoiceNumber = await this.nextNumber(m, input.issueDate);
      const saved = await this.unique(() =>
        repository.save(
          repository.create({
            clientId: input.clientId, invoiceNumber, description: input.description, issueDate: input.issueDate, dueDate: input.dueDate,
            amountExclVat: euros(subtotal), vatAmount: euros(vat), vatRate: input.vatRate, status: 'draft',
          }),
        ),
      );
      let position = 1;
      for (const l of lines) {
        await m.query(
          `INSERT INTO invoice_lines (tenant_id, invoice_id, position, source_type, source_id, description, quantity, unit_price, line_total)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [t, saved.id, position++, l.sourceType, l.sourceId, l.description, l.quantity, l.unitPrice, euros(l.total)],
        );
      }
      return this.load(m, saved.id);
    });
    this.audit.logAction(t, actor.id, 'invoice.created', { invoiceId: view.id, clientId: view.clientId, invoiceNumber: view.invoiceNumber, lines: input.lines.length });
    return view;
  }

  lines(id: string): Promise<InvoiceLineView[]> {
    return this.tx.run(async (m) => {
      await this.load(m, id);
      return m.query(
        `SELECT id, position, source_type AS "sourceType", source_id AS "sourceId", description, quantity::text AS quantity,
                unit_price::text AS "unitPrice", line_total::text AS "lineTotal"
           FROM invoice_lines WHERE tenant_id = $1 AND invoice_id = $2 ORDER BY position`,
        [this.context.tenantId, id],
      );
    });
  }

  /** Final approval in Workflow › Approvals: the invoice is issued and locked (IN_REVIEW → FINAL_LOCKED). */
  async finalizeApproved(id: string, identity: AuthenticatedUser): Promise<void> {
    const actor = await this.userService.resolveActor(identity);
    await this.tx.run(async (m) => {
      const rows = await m.query(
        `UPDATE invoices SET status = 'issued', idms_status = 'FINAL_LOCKED' WHERE tenant_id = $1 AND id = $2 AND status = 'draft' AND idms_status = 'IN_REVIEW' RETURNING id`,
        [this.context.tenantId, id],
      );
      if (rows.length === 0) throw new ConflictException('Only a draft invoice in review can be approved');
    });
    this.audit.logAction(this.context.tenantId, actor.id, 'invoice.status_changed', { invoiceId: id, from: 'draft', to: 'issued', idmsStatus: 'FINAL_LOCKED' });
  }

  /** Next INV-YYYY-XXXX of the organisation for the invoice year; skips numbers that were typed in by hand. */
  private async nextNumber(m: EntityManager, issueDate: string): Promise<string> {
    const year = Number(issueDate.slice(0, 4));
    for (;;) {
      const [row] = await m.query(
        `INSERT INTO invoice_sequences (tenant_id, year, last_value) VALUES ($1, $2, 1)
         ON CONFLICT (tenant_id, year) DO UPDATE SET last_value = invoice_sequences.last_value + 1 RETURNING last_value`,
        [this.context.tenantId, year],
      );
      const number = `INV-${year}-${String(row.last_value).padStart(4, '0')}`;
      const [taken] = await m.query('SELECT 1 FROM invoices WHERE tenant_id = $1 AND invoice_number = $2', [this.context.tenantId, number]);
      if (!taken) return number;
    }
  }

  private async assertNoPendingApproval(m: EntityManager, id: string): Promise<void> {
    const [pending] = await m.query(`SELECT 1 FROM approval_requests WHERE tenant_id = $1 AND entity_id = $2 AND status = 'pending'`, [this.context.tenantId, id]);
    if (pending) throw new ConflictException('This invoice is waiting for approval in Workflow › Approvals');
  }

  private async load(manager: EntityManager, id: string): Promise<InvoiceView> {
    const [invoice]: InvoiceView[] = await manager.query(`${INVOICE_SQL} AND i.id = $2`, [this.context.tenantId, id]);
    if (!invoice) throw new NotFoundException('Invoice not found');
    return invoice;
  }

  private async unique<T>(save: () => Promise<T>): Promise<T> {
    try {
      return await save();
    } catch (error) {
      if (error instanceof QueryFailedError && (error.driverError as { code?: string }).code === '23505') {
        throw new ConflictException('This invoice number is already used');
      }
      throw error;
    }
  }
}
