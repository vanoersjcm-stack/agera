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
import {
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { ApiErrors, ApiPagination, ApiUpdatedSince, BEARER_AUTH } from '../core/http/api-docs.js';
import {
  asObject,
  assertPagination,
  optionalString,
  optionalUuid,
  parseTimestamp,
  requiredString,
} from '../core/http/validation.js';
import {
  AssignWorkOrderDto,
  CreateWorkOrderDto,
  MAX_DESCRIPTION_LENGTH,
  UpdateWorkOrderStatusDto,
  WorkOrderDto,
  WorkOrderLogDto,
  WorkOrderPageDto,
} from './dto/work-order.dto.js';
import type { WorkOrderLog } from './entities/work-order-log.entity.js';
import { WORK_ORDER_STATUSES, isWorkOrderStatus } from './entities/work-order-status.js';
import type { WorkOrder } from './entities/work-order.entity.js';
import { type CreateWorkOrderInput, WorkOrdersService } from './work-orders.service.js';

function toResponse(workOrder: WorkOrder): WorkOrderDto {
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

function toLogResponse(log: WorkOrderLog): WorkOrderLogDto {
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

@ApiTags('work-orders')
@ApiBearerAuth(BEARER_AUTH)
@ApiErrors(401, 403)
@Controller('work-orders')
export class WorkOrdersController {
  constructor(private readonly workOrders: WorkOrdersService) {}

  @Post()
  @ApiOperation({ summary: 'Create a PENDING work order in the active tenant (audit: work_order.created)' })
  @ApiBody({ type: CreateWorkOrderDto })
  @ApiCreatedResponse({ type: WorkOrderDto })
  @ApiErrors(400)
  async create(@Body() body: unknown, @CurrentUser() identity: AuthenticatedUser): Promise<WorkOrderDto> {
    return toResponse(await this.workOrders.create(parseCreateWorkOrder(body), identity));
  }

  @Get()
  @ApiOperation({ summary: 'List work orders of the active tenant (newest first, or oldest first with updatedSince)' })
  @ApiPagination()
  @ApiUpdatedSince()
  @ApiOkResponse({ type: WorkOrderPageDto })
  @ApiErrors(400)
  async list(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('updatedSince') updatedSince?: string,
  ): Promise<WorkOrderPageDto> {
    assertPagination(page, limit);
    const result = await this.workOrders.list({ page, limit, updatedSince: parseTimestamp('updatedSince', updatedSince) });
    return { ...result, items: result.items.map(toResponse) };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a work order' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: WorkOrderDto })
  @ApiErrors(400, 404)
  async get(@Param('id', ParseUUIDPipe) id: string): Promise<WorkOrderDto> {
    return toResponse(await this.workOrders.get(id));
  }

  @Get(':id/logs')
  @ApiOperation({ summary: 'Status history of a work order, oldest first' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: [WorkOrderLogDto] })
  @ApiErrors(400, 404)
  async history(@Param('id', ParseUUIDPipe) id: string): Promise<WorkOrderLogDto[]> {
    return (await this.workOrders.history(id)).map(toLogResponse);
  }

  @Patch(':id/assign')
  @ApiOperation({
    summary: 'Assign or unassign a work order (audit: work_order.assigned)',
    description: 'The assignee must be an active user of the same tenant (400 otherwise). Final work orders return 409.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody({ type: AssignWorkOrderDto })
  @ApiOkResponse({ type: WorkOrderDto })
  @ApiErrors(400, 404, 409)
  async assign(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @CurrentUser() identity: AuthenticatedUser,
  ): Promise<WorkOrderDto> {
    const { assignedUserId } = asObject(body);
    if (assignedUserId === undefined) {
      throw new BadRequestException('assignedUserId is required (UUID, or null to unassign)');
    }
    return toResponse(await this.workOrders.assign(id, optionalUuid('assignedUserId', assignedUserId), identity));
  }

  @Patch(':id/status')
  @ApiOperation({
    summary: 'Change the status of a work order (audit: work_order.status_changed)',
    description: 'Writes a work_order_logs row; COMPLETED sets completedAt. Invalid transitions return 409.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody({ type: UpdateWorkOrderStatusDto })
  @ApiOkResponse({ type: WorkOrderDto })
  @ApiErrors(400, 404, 409)
  async updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @CurrentUser() identity: AuthenticatedUser,
  ): Promise<WorkOrderDto> {
    const { status } = asObject(body);
    if (!isWorkOrderStatus(status)) {
      throw new BadRequestException(`status must be one of ${WORK_ORDER_STATUSES.join(', ')}`);
    }
    return toResponse(await this.workOrders.updateStatus(id, status, identity));
  }
}
