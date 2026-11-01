import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, type Repository } from 'typeorm';
import { TenantContext } from '../core/tenancy/tenant-context.service.js';
import { TenantRepository } from '../core/tenancy/tenant-repository.js';
import { TenantTransaction } from '../core/tenancy/tenant-transaction.service.js';
import { Client } from '../clients/entities/client.entity.js';
import { Store } from '../retailcare/entities/store.entity.js';
import { Agreement } from '../sales-rooms/entities/agreement.entity.js';
import { DigitalSalesRoom } from '../sales-rooms/entities/digital-sales-room.entity.js';
import { WorkOrder } from '../work-orders/entities/work-order.entity.js';

export const SEARCH_ENTITY_TYPES = ['client', 'store', 'work_order', 'agreement', 'client_room'] as const;
export type SearchEntityType = (typeof SEARCH_ENTITY_TYPES)[number];

export interface SearchHit {
  entityType: SearchEntityType;
  id: string;
  title: string;
  subtitle: string;
  /** Web app route (hash path) that opens the record. */
  route: string;
}

const STATUS_LABELS: Record<string, string> = {
  PENDING: 'Pending',
  IN_PROGRESS: 'In progress',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
  pending_approval: 'Awaiting approval',
  active: 'Active',
  expired: 'Expired',
  archived: 'Archived',
};

/** Escapes LIKE wildcards so user input is matched literally. */
function containsPattern(query: string): string {
  return `%${query.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

@Injectable()
export class SearchService {
  private readonly stores: TenantRepository<Store>;
  private readonly workOrders: TenantRepository<WorkOrder>;
  private readonly agreements: TenantRepository<Agreement>;
  private readonly rooms: TenantRepository<DigitalSalesRoom>;
  private readonly clients: TenantRepository<Client>;

  constructor(
    @InjectRepository(Store) stores: Repository<Store>,
    @InjectRepository(WorkOrder) workOrders: Repository<WorkOrder>,
    @InjectRepository(Agreement) agreements: Repository<Agreement>,
    @InjectRepository(DigitalSalesRoom) rooms: Repository<DigitalSalesRoom>,
    @InjectRepository(Client) clients: Repository<Client>,
    context: TenantContext,
    private readonly tx: TenantTransaction,
  ) {
    this.stores = new TenantRepository(stores, context);
    this.workOrders = new TenantRepository(workOrders, context);
    this.agreements = new TenantRepository(agreements, context);
    this.rooms = new TenantRepository(rooms, context);
    this.clients = new TenantRepository(clients, context);
  }

  async search(query: string, limitPerType: number): Promise<SearchHit[]> {
    const pattern = ILike(containsPattern(query));
    const take = limitPerType;

    const [stores, workOrders] = await Promise.all([
      this.stores.find({
        where: [{ name: pattern }, { storeCode: pattern }, { city: pattern }],
        order: { name: 'ASC' },
        take,
      }),
      this.workOrders.find({ where: { title: pattern }, order: { updatedAt: 'DESC' }, take }),
    ]);
    // Agreements and client rooms are protected by row-level security, so read them in a tenant transaction.
    const { clients, agreements, rooms } = await this.tx.run(async (manager) => ({
      clients: await this.clients.withManager(manager).find({
        where: [{ name: pattern }, { legalName: pattern }, { city: pattern }, { erpId: pattern }, { kvkNumber: pattern }],
        order: { name: 'ASC' },
        take,
      }),
      agreements: await this.agreements.withManager(manager).find({ where: { title: pattern }, order: { updatedAt: 'DESC' }, take }),
      rooms: await this.rooms.withManager(manager).find({ where: { roomName: pattern }, order: { updatedAt: 'DESC' }, take }),
    }));

    return [
      ...clients.map<SearchHit>((c) => ({
        entityType: 'client',
        id: c.id,
        title: c.name,
        subtitle: `Client · ${[c.erpId && `ERP ${c.erpId}`, c.city, STATUS_LABELS[c.status]].filter(Boolean).join(' · ')}`,
        route: `/nexus/clients/${c.id}`,
      })),
      ...workOrders.map<SearchHit>((w) => ({
        entityType: 'work_order',
        id: w.id,
        title: w.title,
        subtitle: `Work order · ${STATUS_LABELS[w.status] ?? w.status}`,
        route: `/retailpower/work-orders/${w.id}`,
      })),
      ...stores.map<SearchHit>((s) => ({
        entityType: 'store',
        id: s.id,
        title: s.name,
        subtitle: `Store · ${[s.storeCode, s.city].filter(Boolean).join(' · ')}`,
        route: `/retailpower/stores/${s.id}`,
      })),
      ...agreements.map<SearchHit>((a) => ({
        entityType: 'agreement',
        id: a.id,
        title: a.title,
        subtitle: `Agreement · ${STATUS_LABELS[a.status] ?? a.status}`,
        route: `/nexus/agreements/${a.id}`,
      })),
      ...rooms.map<SearchHit>((r) => ({
        entityType: 'client_room',
        id: r.id,
        title: r.roomName,
        subtitle: `Client room · ${STATUS_LABELS[r.status] ?? r.status}`,
        route: `/nexus/client-rooms/${r.id}`,
      })),
    ];
  }
}
