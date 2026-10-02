import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, type FindOptionsWhere, MoreThan, Repository } from 'typeorm';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { AuditService } from '../core/audit/audit.service.js';
import { User } from '../core/entities/index.js';
import { TenantContext } from '../core/tenancy/tenant-context.service.js';
import { TenantRepository } from '../core/tenancy/tenant-repository.js';
import { UserService } from '../user/user.service.js';
import { WorkOrderLog } from './entities/work-order-log.entity.js';
import { ALLOWED_TRANSITIONS, type WorkOrderStatus } from './entities/work-order-status.js';
import { WorkOrder } from './entities/work-order.entity.js';

export interface CreateWorkOrderInput {
  title: string;
  description: string | null;
  assignedUserId: string | null;
}

export interface ListWorkOrdersQuery {
  page: number;
  limit: number;
  updatedSince: Date | null;
}

export interface WorkOrderPage {
  items: WorkOrder[];
  page: number;
  limit: number;
  total: number;
}

@Injectable()
export class WorkOrdersService {
  private readonly workOrders: TenantRepository<WorkOrder>;
  private readonly logs: TenantRepository<WorkOrderLog>;
  private readonly users: TenantRepository<User>;

  constructor(
    @InjectRepository(WorkOrder) workOrders: Repository<WorkOrder>,
    @InjectRepository(WorkOrderLog) logs: Repository<WorkOrderLog>,
    @InjectRepository(User) users: Repository<User>,
    private readonly context: TenantContext,
    private readonly dataSource: DataSource,
    private readonly userService: UserService,
    private readonly audit: AuditService,
  ) {
    this.workOrders = new TenantRepository(workOrders, context);
    this.logs = new TenantRepository(logs, context);
    this.users = new TenantRepository(users, context);
  }

  async create(input: CreateWorkOrderInput, identity: AuthenticatedUser): Promise<WorkOrder> {
    const actor = await this.userService.resolveActor(identity);
    if (input.assignedUserId !== null) {
      await this.assertAssignable(input.assignedUserId, 'assignedUserId');
    }

    const workOrder = await this.dataSource.transaction(async (manager) => {
      const workOrders = this.workOrders.withManager(manager);
      const logs = this.logs.withManager(manager);
      const created = await workOrders.save(workOrders.create({ ...input, status: 'PENDING' }));
      await logs.save(
        logs.create({ workOrderId: created.id, previousStatus: null, newStatus: 'PENDING', changedByUserId: actor.id }),
      );
      return created;
    });

    this.audit.logAction(this.context.tenantId, actor.id, 'work_order.created', {
      workOrderId: workOrder.id,
      title: workOrder.title,
      assignedUserId: workOrder.assignedUserId,
    });
    return workOrder;
  }

  async list({ page, limit, updatedSince }: ListWorkOrdersQuery): Promise<WorkOrderPage> {
    const where: FindOptionsWhere<WorkOrder> = updatedSince ? { updatedAt: MoreThan(updatedSince) } : {};
    const direction = updatedSince ? 'ASC' : 'DESC';
    const [items, total] = await this.workOrders.findAndCount({
      where,
      order: { updatedAt: direction, id: direction },
      skip: (page - 1) * limit,
      take: limit,
    });
    return { items, page, limit, total };
  }

  async get(id: string): Promise<WorkOrder> {
    const workOrder = await this.workOrders.findOneBy({ id });
    if (!workOrder) {
      throw new NotFoundException('Work order not found');
    }
    return workOrder;
  }

  async history(id: string): Promise<WorkOrderLog[]> {
    await this.get(id);
    return this.logs.find({ where: { workOrderId: id }, order: { createdAt: 'ASC', id: 'ASC' } });
  }

  async assign(id: string, assignedUserId: string | null, identity: AuthenticatedUser): Promise<WorkOrder> {
    const actor = await this.userService.resolveActor(identity);

    const { workOrder, previousAssignedUserId } = await this.dataSource.transaction(async (manager) => {
      const workOrders = this.workOrders.withManager(manager);
      const current = await workOrders.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!current) {
        throw new NotFoundException('Work order not found');
      }
      if (ALLOWED_TRANSITIONS[current.status].length === 0) {
        throw new ConflictException(`Cannot reassign a ${current.status} work order`);
      }
      if (assignedUserId !== null) {
        await this.assertAssignable(assignedUserId, 'assigned_user_id');
      }
      const previous = current.assignedUserId;
      current.assignedUserId = assignedUserId;
      await workOrders.save(current);
      const updated = await workOrders.findOneBy({ id });
      if (!updated) {
        throw new NotFoundException('Work order not found');
      }
      return { workOrder: updated, previousAssignedUserId: previous };
    });

    this.audit.logAction(this.context.tenantId, actor.id, 'work_order.assigned', {
      workOrderId: id,
      previousAssignedUserId,
      assignedUserId,
    });
    return workOrder;
  }

  async updateStatus(id: string, status: WorkOrderStatus, identity: AuthenticatedUser): Promise<WorkOrder> {
    const actor = await this.userService.resolveActor(identity);

    const { workOrder, previousStatus } = await this.dataSource.transaction(async (manager) => {
      const workOrders = this.workOrders.withManager(manager);
      const logs = this.logs.withManager(manager);
      const current = await workOrders.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!current) {
        throw new NotFoundException('Work order not found');
      }
      const previous = current.status;
      if (!ALLOWED_TRANSITIONS[previous].includes(status)) {
        throw new ConflictException(`Cannot change status from ${previous} to ${status}`);
      }
      current.status = status;
      await workOrders.save(current);
      await logs.save(
        logs.create({ workOrderId: id, previousStatus: previous, newStatus: status, changedByUserId: actor.id }),
      );
      const updated = await workOrders.findOneBy({ id });
      if (!updated) {
        throw new NotFoundException('Work order not found');
      }
      return { workOrder: updated, previousStatus: previous };
    });

    this.audit.logAction(this.context.tenantId, actor.id, 'work_order.status_changed', {
      workOrderId: id,
      previousStatus,
      newStatus: status,
    });
    return workOrder;
  }

  /** The assignee must be an active user of the work order's (= the active) tenant. */
  private async assertAssignable(userId: string, field: string): Promise<void> {
    const user = await this.users.findOneBy({ id: userId });
    if (!user || !user.isActive) {
      throw new BadRequestException(`${field} is not an active user of the active tenant`);
    }
  }
}
