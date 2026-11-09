import type {
  DeepPartial,
  EntityManager,
  FindManyOptions,
  FindOneOptions,
  FindOptionsWhere,
  ObjectLiteral,
  Repository,
} from 'typeorm';
import type { TenantContext } from './tenant-context.service.js';
import { applyTenantSettings } from './tenant-transaction.service.js';

export interface TenantOwned extends ObjectLiteral {
  tenantId: string;
}

/**
 * Repository wrapper that pins every read and write to the active tenant from TenantContext.
 * Tenant-owned entities must be accessed through this class, never through the raw repository.
 */
export class TenantRepository<T extends TenantOwned> {
  constructor(
    private readonly repository: Repository<T>,
    private readonly context: TenantContext,
    /** Bound to a caller's transaction (withManager); otherwise each call opens its own short transaction. */
    private readonly bound = false,
  ) {}

  /** Same tenant scoping, bound to a transaction's EntityManager. */
  withManager(manager: EntityManager): TenantRepository<T> {
    return new TenantRepository(manager.getRepository<T>(this.repository.target), this.context, true);
  }

  find(options: FindManyOptions<T> = {}): Promise<T[]> {
    return this.exec((r) => r.find(this.scope(options)));
  }

  findAndCount(options: FindManyOptions<T> = {}): Promise<[T[], number]> {
    return this.exec((r) => r.findAndCount(this.scope(options)));
  }

  findOne(options: FindOneOptions<T>): Promise<T | null> {
    return this.exec((r) => r.findOne(this.scope(options)));
  }

  findOneBy(where: FindOptionsWhere<T>): Promise<T | null> {
    return this.exec((r) => r.findOneBy(this.scopeWhere(where)));
  }

  create(data: Omit<DeepPartial<T>, 'tenantId'>): T {
    return this.repository.create({ ...data, tenantId: this.context.tenantId } as DeepPartial<T>);
  }

  save(entity: T): Promise<T> {
    if (entity.tenantId !== this.context.tenantId) {
      throw new Error('Refusing to save an entity that belongs to another tenant');
    }
    return this.exec((r) => r.save(entity));
  }

  remove(entity: T): Promise<T> {
    if (entity.tenantId !== this.context.tenantId) {
      throw new Error('Refusing to remove an entity that belongs to another tenant');
    }
    return this.exec((r) => r.remove(entity));
  }

  /** Runs with the row-level security settings of the active tenant, so RLS-protected tables are visible. */
  private exec<R>(op: (repository: Repository<T>) => Promise<R>): Promise<R> {
    const tenant = this.context.tenant;
    if (this.bound) {
      return applyTenantSettings(this.repository.manager, tenant).then(() => op(this.repository));
    }
    return this.repository.manager.transaction(async (manager) => {
      await applyTenantSettings(manager, tenant);
      return op(manager.getRepository<T>(this.repository.target));
    });
  }

  private scopeWhere(where: FindOptionsWhere<T>): FindOptionsWhere<T> {
    return { ...where, tenantId: this.context.tenantId } as FindOptionsWhere<T>;
  }

  private scope<O extends FindOneOptions<T>>(options: O): O {
    const { where } = options;
    const scoped = Array.isArray(where) ? where.map((w) => this.scopeWhere(w)) : this.scopeWhere(where ?? {});
    return { ...options, where: scoped };
  }
}
