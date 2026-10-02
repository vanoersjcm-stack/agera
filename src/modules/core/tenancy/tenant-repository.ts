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
  ) {}

  /** Same tenant scoping, bound to a transaction's EntityManager. */
  withManager(manager: EntityManager): TenantRepository<T> {
    return new TenantRepository(manager.getRepository<T>(this.repository.target), this.context);
  }

  find(options: FindManyOptions<T> = {}): Promise<T[]> {
    return this.repository.find(this.scope(options));
  }

  findAndCount(options: FindManyOptions<T> = {}): Promise<[T[], number]> {
    return this.repository.findAndCount(this.scope(options));
  }

  findOne(options: FindOneOptions<T>): Promise<T | null> {
    return this.repository.findOne(this.scope(options));
  }

  findOneBy(where: FindOptionsWhere<T>): Promise<T | null> {
    return this.repository.findOneBy(this.scopeWhere(where));
  }

  create(data: Omit<DeepPartial<T>, 'tenantId'>): T {
    return this.repository.create({ ...data, tenantId: this.context.tenantId } as DeepPartial<T>);
  }

  save(entity: T): Promise<T> {
    if (entity.tenantId !== this.context.tenantId) {
      throw new Error('Refusing to save an entity that belongs to another tenant');
    }
    return this.repository.save(entity);
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
