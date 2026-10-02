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
import type { WorkOrderLog } from './entities/work-order-log.entity.js';
import { WORK_ORDER_STATUSES, type WorkOrderStatus, isWorkOrderStatus } from './entities/work-order-status.js';
import type { WorkOrder } from './entities/work-order.entity.js';
import { type CreateWorkOrderInput, WorkOrdersService } from './work-orders.service.js';

const MAX_LIMIT = 100;
const MAX_DESCRIPTION_LENGTH = 10_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:\d{2})$/;

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

function asObject(body: unknown): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new BadRequestException('Body must be a JSON object');
  }
  return body as Record<string, unknown>;
}

function parseCreateWorkOrder(body: unknown): CreateWorkOrderInput {
  const { title, description, assignedUserId } = asObject(body);
  if (typeof title !== 'string' || title.trim().length === 0 || title.trim().length > 255) {
    throw new BadRequestException('title must be a non-empty string of at most 255 characters');
  }
  if (description !== undefined && description !== null) {
    if (typeof description !== 'string' || description.length > MAX_DESCRIPTION_LENGTH) {
      throw new BadRequestException(`description must be a string of at most ${MAX_DESCRIPTION_LENGTH} characters`);
    }
  }
  if (assignedUserId !== undefined && assignedUserId !== null) {
    if (typeof assignedUserId !== 'string' || !UUID_PATTERN.test(assignedUserId)) {
      throw new BadRequestException('assignedUserId must be a UUID');
    }
  }
  return {
    title: title.trim(),
    description: typeof description === 'string' ? description : null,
    assignedUserId: typeof assignedUserId === 'string' ? assignedUserId : null,
  };
}

function parseUpdatedSince(value: string | undefined): Date | null {
  if (value === undefined) {
    return null;
  }
  const date = new Date(value);
  if (!ISO_TIMESTAMP_PATTERN.test(value) || Number.isNaN(date.getTime())) {
    throw new BadRequestException('updated_since must be an ISO 8601 timestamp with timezone');
  }
  return date;
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
    if (page < 1 || limit < 1 || limit > MAX_LIMIT) {
      throw new BadRequestException(`page must be >= 1 and limit between 1 and ${MAX_LIMIT}`);
    }
    const result = await this.workOrders.list({ page, limit, updatedSince: parseUpdatedSince(updatedSince) });
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
