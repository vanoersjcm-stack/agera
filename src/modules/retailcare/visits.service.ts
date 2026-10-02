import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, type FindOptionsWhere, MoreThan, Repository } from 'typeorm';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { AuditService } from '../core/audit/audit.service.js';
import { User } from '../core/entities/index.js';
import { TenantContext } from '../core/tenancy/tenant-context.service.js';
import { TenantRepository } from '../core/tenancy/tenant-repository.js';
import { UserService } from '../user/user.service.js';
import { WorkOrder } from '../work-orders/entities/work-order.entity.js';
import { MerchandisingVisit } from './entities/merchandising-visit.entity.js';
import { ALLOWED_VISIT_TRANSITIONS, type VisitStatus } from './entities/visit-status.js';
import { StoresService } from './stores.service.js';

export interface CreateVisitInput {
  storeId: string;
  /** Defaults to the caller. */
  fieldRepId: string | null;
  workOrderId: string | null;
  visitDate: Date;
  notes: string | null;
}

export interface ListVisitsQuery {
  page: number;
  limit: number;
  storeId: string | null;
  updatedSince: Date | null;
}

export interface VisitPage {
  items: MerchandisingVisit[];
  page: number;
  limit: number;
  total: number;
}

@Injectable()
export class VisitsService {
  private readonly visits: TenantRepository<MerchandisingVisit>;
  private readonly users: TenantRepository<User>;
  private readonly workOrders: TenantRepository<WorkOrder>;

  constructor(
    @InjectRepository(MerchandisingVisit) visits: Repository<MerchandisingVisit>,
    @InjectRepository(User) users: Repository<User>,
    @InjectRepository(WorkOrder) workOrders: Repository<WorkOrder>,
    private readonly context: TenantContext,
    private readonly dataSource: DataSource,
    private readonly stores: StoresService,
    private readonly userService: UserService,
    private readonly audit: AuditService,
  ) {
    this.visits = new TenantRepository(visits, context);
    this.users = new TenantRepository(users, context);
    this.workOrders = new TenantRepository(workOrders, context);
  }

  async create(input: CreateVisitInput, identity: AuthenticatedUser): Promise<MerchandisingVisit> {
    const actor = await this.userService.resolveActor(identity);
    const fieldRepId = input.fieldRepId ?? actor.id;

    if (!(await this.stores.findById(input.storeId))) {
      throw new BadRequestException('storeId is not a store of the active tenant');
    }
    const fieldRep = await this.users.findOneBy({ id: fieldRepId });
    if (!fieldRep || !fieldRep.isActive) {
      throw new BadRequestException('fieldRepId is not an active user of the active tenant');
    }
    if (input.workOrderId !== null && !(await this.workOrders.findOneBy({ id: input.workOrderId }))) {
      throw new BadRequestException('workOrderId is not a work order of the active tenant');
    }

    const visit = await this.visits.save(this.visits.create({ ...input, fieldRepId, status: 'PLANNED' }));
    this.audit.logAction(this.context.tenantId, actor.id, 'visit.planned', {
      visitId: visit.id,
      storeId: visit.storeId,
      fieldRepId: visit.fieldRepId,
      workOrderId: visit.workOrderId,
    });
    return visit;
  }

  async list({ page, limit, storeId, updatedSince }: ListVisitsQuery): Promise<VisitPage> {
    const where: FindOptionsWhere<MerchandisingVisit> = {};
    if (storeId !== null) {
      where.storeId = storeId;
    }
    if (updatedSince !== null) {
      where.updatedAt = MoreThan(updatedSince);
    }
    const direction = updatedSince ? 'ASC' : 'DESC';
    const [items, total] = await this.visits.findAndCount({
      where,
      order: { updatedAt: direction, id: direction },
      skip: (page - 1) * limit,
      take: limit,
    });
    return { items, page, limit, total };
  }

  async updateStatus(id: string, status: VisitStatus, identity: AuthenticatedUser): Promise<MerchandisingVisit> {
    const actor = await this.userService.resolveActor(identity);

    const { visit, previousStatus } = await this.dataSource.transaction(async (manager) => {
      const visits = this.visits.withManager(manager);
      const current = await visits.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!current) {
        throw new NotFoundException('Visit not found');
      }
      const previous = current.status;
      if (!ALLOWED_VISIT_TRANSITIONS[previous].includes(status)) {
        throw new ConflictException(`Cannot change status from ${previous} to ${status}`);
      }
      current.status = status;
      await visits.save(current);
      const updated = await visits.findOneBy({ id });
      if (!updated) {
        throw new NotFoundException('Visit not found');
      }
      return { visit: updated, previousStatus: previous };
    });

    this.audit.logAction(this.context.tenantId, actor.id, 'visit.status_changed', {
      visitId: id,
      previousStatus,
      newStatus: status,
    });
    return visit;
  }
}
