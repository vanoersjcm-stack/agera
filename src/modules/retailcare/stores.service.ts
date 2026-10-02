import { ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { AuditService } from '../core/audit/audit.service.js';
import { TenantContext } from '../core/tenancy/tenant-context.service.js';
import { TenantRepository } from '../core/tenancy/tenant-repository.js';
import { UserService } from '../user/user.service.js';
import { Store } from './entities/store.entity.js';

const PG_UNIQUE_VIOLATION = '23505';

export interface CreateStoreInput {
  storeCode: string;
  name: string;
  address: string | null;
  city: string | null;
  postalCode: string | null;
  country: string | null;
}

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
  ) {
    this.stores = new TenantRepository(stores, context);
  }

  async create(input: CreateStoreInput, identity: AuthenticatedUser): Promise<Store> {
    const actor = await this.userService.resolveActor(identity);
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
