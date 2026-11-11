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
  invoiceNumber: string;
  description: string | null;
  issueDate: string;
  dueDate: string | null;
  amountExclVat: string;
  vatAmount: string;
  status?: 'draft' | 'issued';
}
export type InvoiceUpdate = Partial<Omit<InvoiceInput, 'clientId' | 'status'>>;

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
         i.amount_excl_vat::text AS "amountExclVat", i.vat_amount::text AS "vatAmount", (i.amount_excl_vat + i.vat_amount)::text AS "totalAmount",
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
      const saved = await this.unique(() => repository.save(repository.create({ ...input, status: input.status ?? 'draft' })));
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
