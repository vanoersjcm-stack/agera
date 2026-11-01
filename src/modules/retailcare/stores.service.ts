import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { TenantTransaction } from '../core/tenancy/tenant-transaction.service.js';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { AuditService } from '../core/audit/audit.service.js';
import { TenantContext } from '../core/tenancy/tenant-context.service.js';
import { TenantRepository } from '../core/tenancy/tenant-repository.js';
import { UserService } from '../user/user.service.js';
import { Store, type StoreStatus } from './entities/store.entity.js';

const PG_UNIQUE_VIOLATION = '23505';

export interface CreateStoreInput {
  storeCode: string;
  name: string;
  address: string | null;
  city: string | null;
  postalCode: string | null;
  country: string | null;
  clientId: string | null;
}

export type UpdateStoreInput = Partial<CreateStoreInput> & { status?: StoreStatus };

export interface StorePage {
  items: Store[];
  page: number;
  limit: number;
  total: number;
}

@Injectable()
export class StoresService {
  private readonly stores: TenantRepository<Store>;

  constructor(
    @InjectRepository(Store) stores: Repository<Store>,
    private readonly context: TenantContext,
    private readonly userService: UserService,
    private readonly audit: AuditService,
    private readonly tx: TenantTransaction,
  ) {
    this.stores = new TenantRepository(stores, context);
  }

  /** Clients are RLS-protected, so check the link inside a tenant transaction. */
  private async assertClient(clientId: string | null | undefined): Promise<void> {
    if (!clientId) return;
    const rows: unknown[] = await this.tx.run((manager) =>
      manager.query('SELECT 1 FROM clients WHERE tenant_id = $1 AND id = $2', [this.context.tenantId, clientId]),
    );
    if (rows.length === 0) throw new BadRequestException('clientId must be a client of the active tenant');
  }

  async create(input: CreateStoreInput, identity: AuthenticatedUser): Promise<Store> {
    const actor = await this.userService.resolveActor(identity);
    await this.assertClient(input.clientId);
    let store: Store;
    try {
      store = await this.stores.save(this.stores.create(input));
    } catch (error) {
      if (error instanceof QueryFailedError && (error.driverError as { code?: string }).code === PG_UNIQUE_VIOLATION) {
        throw new ConflictException(`A store with code ${input.storeCode} already exists`);
      }
      throw error;
    }
    this.audit.logAction(this.context.tenantId, actor.id, 'store.created', {
      storeId: store.id,
      storeCode: store.storeCode,
    });
    return store;
  }

  async update(id: string, changes: UpdateStoreInput, identity: AuthenticatedUser): Promise<Store> {
    const actor = await this.userService.resolveActor(identity);
    const current = await this.stores.findOneBy({ id });
    if (!current) {
      throw new NotFoundException('Store not found');
    }
    await this.assertClient(changes.clientId);
    Object.assign(current, changes);
    try {
      await this.stores.save(current);
    } catch (error) {
      if (error instanceof QueryFailedError && (error.driverError as { code?: string }).code === PG_UNIQUE_VIOLATION) {
        throw new ConflictException(`A store with code ${changes.storeCode} already exists`);
      }
      throw error;
    }
    this.audit.logAction(this.context.tenantId, actor.id, 'store.updated', { storeId: id, changes: Object.keys(changes) });
    return (await this.stores.findOneBy({ id })) ?? current;
  }

  async list(page: number, limit: number): Promise<StorePage> {
    const [items, total] = await this.stores.findAndCount({
      order: { storeCode: 'ASC', id: 'ASC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return { items, page, limit, total };
  }

  findById(id: string): Promise<Store | null> {
    return this.stores.findOneBy({ id });
  }
}
