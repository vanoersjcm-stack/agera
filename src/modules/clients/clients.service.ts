import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { type EntityManager, QueryFailedError, type Repository } from 'typeorm';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { AuditService } from '../core/audit/audit.service.js';
import { TenantContext } from '../core/tenancy/tenant-context.service.js';
import { TenantRepository } from '../core/tenancy/tenant-repository.js';
import { TenantTransaction } from '../core/tenancy/tenant-transaction.service.js';
import { Agreement } from '../sales-rooms/entities/agreement.entity.js';
import { DigitalSalesRoom } from '../sales-rooms/entities/digital-sales-room.entity.js';
import { UserService } from '../user/user.service.js';
import { Client, type ClientStatus, type CreditStatus } from './entities/client.entity.js';
import { Contact } from './entities/contact.entity.js';

export interface ClientInput {
  name: string;
  legalName: string | null;
  vatNumber: string | null;
  city: string | null;
  country: string | null;
  kvkNumber: string | null;
  sector: string | null;
  address: string | null;
  paymentTerms: string;
  creditLimit: string;
  creditStatus: CreditStatus;
  erpId: string | null;
  accountManagerId: string | null;
}

export type ClientUpdate = Partial<ClientInput> & { status?: ClientStatus };

export interface ContactInput {
  firstName: string;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  roleTitle: string | null;
  isPrimary: boolean;
}

export interface ClientSummary extends Client {
  activeAgreements: number;
  activeRooms: number;
  contractValue: string;
  accountManagerName: string | null;
}

export interface PlanRef {
  id: string;
  modelName: string;
  fiscalYear: number;
  status: string;
}

export interface ClientRecord {
  client: ClientSummary;
  contacts: Contact[];
  agreements: Agreement[];
  rooms: DigitalSalesRoom[];
  plans: PlanRef[];
  stores: StoreRef[];
}

export interface StoreRef {
  id: string;
  storeCode: string;
  name: string;
  city: string | null;
  status: string;
}

const SUMMARY_SQL = `
  SELECT c.id,
         (SELECT count(*)::int FROM agreements a
           WHERE a.tenant_id = c.tenant_id AND a.client_id = c.id AND a.status = 'active') AS "activeAgreements",
         (SELECT count(*)::int FROM digital_sales_rooms d
           WHERE d.tenant_id = c.tenant_id AND d.client_id = c.id AND d.status = 'active') AS "activeRooms",
         (SELECT COALESCE(sum(li.projected_amount), 0)::text
            FROM financial_models m JOIN financial_line_items li ON li.model_id = m.id AND li.tenant_id = m.tenant_id
           WHERE m.tenant_id = c.tenant_id AND m.metadata->>'clientId' = c.id::text
             AND m.status = 'approved' AND li.category = 'revenue') AS "contractValue",
         (SELECT COALESCE(NULLIF(btrim(concat_ws(' ', u.first_name, u.last_name)), ''), u.email)
            FROM users u WHERE u.id = c.account_manager_id) AS "accountManagerName"
    FROM clients c`;

@Injectable()
export class ClientsService {
  private readonly clients: TenantRepository<Client>;
  private readonly contacts: TenantRepository<Contact>;
  private readonly agreements: TenantRepository<Agreement>;
  private readonly rooms: TenantRepository<DigitalSalesRoom>;

  constructor(
    @InjectRepository(Client) clients: Repository<Client>,
    @InjectRepository(Contact) contacts: Repository<Contact>,
    @InjectRepository(Agreement) agreements: Repository<Agreement>,
    @InjectRepository(DigitalSalesRoom) rooms: Repository<DigitalSalesRoom>,
    private readonly context: TenantContext,
    private readonly tx: TenantTransaction,
    private readonly userService: UserService,
    private readonly audit: AuditService,
  ) {
    this.clients = new TenantRepository(clients, context);
    this.contacts = new TenantRepository(contacts, context);
    this.agreements = new TenantRepository(agreements, context);
    this.rooms = new TenantRepository(rooms, context);
  }

  private async withStats(manager: EntityManager, clients: Client[]): Promise<ClientSummary[]> {
    if (clients.length === 0) return [];
    const rows: { id: string; activeAgreements: number; activeRooms: number; contractValue: string; accountManagerName: string | null }[] = await manager.query(
      `${SUMMARY_SQL} WHERE c.tenant_id = $1 AND c.id = ANY($2::uuid[])`,
      [this.context.tenantId, clients.map((c) => c.id)],
    );
    const stats = new Map(rows.map((r) => [r.id, r]));
    return clients.map((c) => ({
      ...c,
      activeAgreements: stats.get(c.id)?.activeAgreements ?? 0,
      activeRooms: stats.get(c.id)?.activeRooms ?? 0,
      contractValue: stats.get(c.id)?.contractValue ?? '0',
      accountManagerName: stats.get(c.id)?.accountManagerName ?? null,
    }));
  }

  list(): Promise<ClientSummary[]> {
    return this.tx.run(async (manager) => {
      const clients = await this.clients.withManager(manager).find({ order: { name: 'ASC' } });
      return this.withStats(manager, clients);
    });
  }

  get(id: string): Promise<ClientRecord> {
    return this.tx.run(async (manager) => {
      const client = await this.clients.withManager(manager).findOneBy({ id });
      if (!client) throw new NotFoundException('Client not found');
      const [summary] = await this.withStats(manager, [client]);
      const contacts = await this.contacts.withManager(manager).find({
        where: { clientId: id },
        order: { isPrimary: 'DESC', firstName: 'ASC', lastName: 'ASC' },
      });
      const agreements = await this.agreements.withManager(manager).find({ where: { clientId: id }, order: { createdAt: 'DESC' } });
      const rooms = await this.rooms.withManager(manager).find({ where: { clientId: id }, order: { createdAt: 'DESC' } });
      const plans: PlanRef[] = await manager.query(
        `SELECT id, model_name AS "modelName", fiscal_year AS "fiscalYear", status
           FROM financial_models WHERE tenant_id = $1 AND metadata->>'clientId' = $2 ORDER BY fiscal_year DESC, model_name`,
        [this.context.tenantId, id],
      );
      const stores: StoreRef[] = await manager.query(
        `SELECT id, store_code AS "storeCode", name, city, status FROM stores WHERE tenant_id = $1 AND client_id = $2 ORDER BY name`,
        [this.context.tenantId, id],
      );
      return { client: summary, contacts, agreements, rooms, plans, stores };
    });
  }

  async create(input: ClientInput, identity: AuthenticatedUser): Promise<ClientSummary> {
    const actor = await this.userService.resolveActor(identity);
    await this.assertAccountManager(input.accountManagerId);
    const client = await this.tx.run(async (manager) => {
      const repository = this.clients.withManager(manager);
      const saved = await this.saveUnique(() => repository.save(repository.create(input)));
      const [summary] = await this.withStats(manager, [saved]);
      return summary;
    });
    this.audit.logAction(this.context.tenantId, actor.id, 'client.created', { clientId: client.id, name: client.name });
    return client;
  }

  async update(id: string, changes: ClientUpdate, identity: AuthenticatedUser): Promise<ClientSummary> {
    const actor = await this.userService.resolveActor(identity);
    await this.assertAccountManager(changes.accountManagerId);
    const client = await this.tx.run(async (manager) => {
      const repository = this.clients.withManager(manager);
      const current = await repository.findOneBy({ id });
      if (!current) throw new NotFoundException('Client not found');
      Object.assign(current, changes);
      await this.saveUnique(() => repository.save(current));
      const reloaded = await repository.findOneBy({ id });
      const [summary] = await this.withStats(manager, [reloaded ?? current]);
      return summary;
    });
    this.audit.logAction(this.context.tenantId, actor.id, 'client.updated', { clientId: id, changes: Object.keys(changes) });
    return client;
  }

  async addContact(clientId: string, input: ContactInput, identity: AuthenticatedUser): Promise<Contact> {
    const actor = await this.userService.resolveActor(identity);
    const contact = await this.tx.run(async (manager) => {
      if (!(await this.clients.withManager(manager).findOneBy({ id: clientId }))) throw new NotFoundException('Client not found');
      const repository = this.contacts.withManager(manager);
      if (input.isPrimary) await this.clearPrimary(manager, clientId);
      return repository.save(repository.create({ ...input, clientId }));
    });
    this.audit.logAction(this.context.tenantId, actor.id, 'contact.created', { clientId, contactId: contact.id });
    return contact;
  }

  async updateContact(clientId: string, contactId: string, changes: Partial<ContactInput>, identity: AuthenticatedUser): Promise<Contact> {
    const actor = await this.userService.resolveActor(identity);
    const contact = await this.tx.run(async (manager) => {
      const repository = this.contacts.withManager(manager);
      const current = await repository.findOneBy({ id: contactId, clientId });
      if (!current) throw new NotFoundException('Contact not found');
      if (changes.isPrimary && !current.isPrimary) await this.clearPrimary(manager, clientId);
      Object.assign(current, changes);
      await repository.save(current);
      return (await repository.findOneBy({ id: contactId })) ?? current;
    });
    this.audit.logAction(this.context.tenantId, actor.id, 'contact.updated', { clientId, contactId, changes: Object.keys(changes) });
    return contact;
  }

  private async assertAccountManager(userId: string | null | undefined): Promise<void> {
    if (userId && !(await this.userService.findInternal(userId))) {
      throw new BadRequestException('accountManagerId must be an active colleague in this organisation');
    }
  }

  private async saveUnique<T>(save: () => Promise<T>): Promise<T> {
    try {
      return await save();
    } catch (error) {
      if (error instanceof QueryFailedError && (error.driverError as { code?: string }).code === '23505') {
        throw new ConflictException('Another client already uses this ERP ID');
      }
      throw error;
    }
  }

  private async clearPrimary(manager: EntityManager, clientId: string): Promise<void> {
    await manager.query('UPDATE contacts SET is_primary = FALSE WHERE tenant_id = $1 AND client_id = $2 AND is_primary', [
      this.context.tenantId,
      clientId,
    ]);
  }
}
