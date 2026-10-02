import {
  BadRequestException,
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import {
  asObject,
  assertPagination,
  optionalString,
  optionalUuid,
  parseTimestamp,
  requiredString,
} from '../core/http/validation.js';
import type { WorkOrderLog } from './entities/work-order-log.entity.js';
import { WORK_ORDER_STATUSES, type WorkOrderStatus, isWorkOrderStatus } from './entities/work-order-status.js';
import type { WorkOrder } from './entities/work-order.entity.js';
import { type CreateWorkOrderInput, WorkOrdersService } from './work-orders.service.js';

const MAX_DESCRIPTION_LENGTH = 10_000;

export interface WorkOrderResponse {
  id: string;
  tenantId: string;
  title: string;
  description: string | null;
  status: WorkOrderStatus;
  assignedUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
}

export interface WorkOrderListResponse {
  items: WorkOrderResponse[];
  page: number;
  limit: number;
  total: number;
}

export interface WorkOrderLogResponse {
  id: string;
  previousStatus: WorkOrderStatus | null;
  newStatus: WorkOrderStatus;
  changedByUserId: string;
  createdAt: Date;
}

function toResponse(workOrder: WorkOrder): WorkOrderResponse {
  return {
    id: workOrder.id,
    tenantId: workOrder.tenantId,
    title: workOrder.title,
    description: workOrder.description ?? null,
    status: workOrder.status,
    assignedUserId: workOrder.assignedUserId ?? null,
    createdAt: workOrder.createdAt,
    updatedAt: workOrder.updatedAt,
    completedAt: workOrder.completedAt ?? null,
  };
}

function toLogResponse(log: WorkOrderLog): WorkOrderLogResponse {
  return {
    id: log.id,
    previousStatus: log.previousStatus,
    newStatus: log.newStatus,
    changedByUserId: log.changedByUserId,
    createdAt: log.createdAt,
  };
}

function parseCreateWorkOrder(body: unknown): CreateWorkOrderInput {
  const { title, description, assignedUserId } = asObject(body);
  return {
    title: requiredString('title', title, 255),
    description: optionalString('description', description, MAX_DESCRIPTION_LENGTH),
    assignedUserId: optionalUuid('assignedUserId', assignedUserId),
  };
}

@Controller('work-orders')
export class WorkOrdersController {
  constructor(private readonly workOrders: WorkOrdersService) {}

  @Post()
  async create(@Body() body: unknown, @CurrentUser() identity: AuthenticatedUser): Promise<WorkOrderResponse> {
    return toResponse(await this.workOrders.create(parseCreateWorkOrder(body), identity));
  }

  @Get()
  async list(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('updated_since') updatedSince?: string,
  ): Promise<WorkOrderListResponse> {
    assertPagination(page, limit);
    const result = await this.workOrders.list({ page, limit, updatedSince: parseTimestamp('updated_since', updatedSince) });
    return { ...result, items: result.items.map(toResponse) };
  }

  @Get(':id')
  async get(@Param('id', ParseUUIDPipe) id: string): Promise<WorkOrderResponse> {
    return toResponse(await this.workOrders.get(id));
  }

  @Get(':id/logs')
  async history(@Param('id', ParseUUIDPipe) id: string): Promise<WorkOrderLogResponse[]> {
    return (await this.workOrders.history(id)).map(toLogResponse);
  }

  @Patch(':id/assign')
  async assign(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @CurrentUser() identity: AuthenticatedUser,
  ): Promise<WorkOrderResponse> {
    const { assigned_user_id: assignedUserId } = asObject(body);
    if (assignedUserId === undefined) {
      throw new BadRequestException('assigned_user_id is required (UUID, or null to unassign)');
    }
    return toResponse(await this.workOrders.assign(id, optionalUuid('assigned_user_id', assignedUserId), identity));
  }

  @Patch(':id/status')
  async updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @CurrentUser() identity: AuthenticatedUser,
  ): Promise<WorkOrderResponse> {
    const { status } = asObject(body);
    if (!isWorkOrderStatus(status)) {
      throw new BadRequestException(`status must be one of ${WORK_ORDER_STATUSES.join(', ')}`);
    }
    return toResponse(await this.workOrders.updateStatus(id, status, identity));
  }
}
