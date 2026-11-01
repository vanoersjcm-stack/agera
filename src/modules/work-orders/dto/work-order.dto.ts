import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PageMetaDto } from '../../core/http/api-docs.js';
import { WORK_ORDER_STATUSES, type WorkOrderStatus } from '../entities/work-order-status.js';
import { WORK_ORDER_PRIORITIES, type WorkOrderPriority } from '../entities/work-order.entity.js';

export const MAX_DESCRIPTION_LENGTH = 10_000;

export class CreateWorkOrderDto {
  @ApiProperty({ maxLength: 255, example: 'Replace filter' })
  title!: string;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: MAX_DESCRIPTION_LENGTH, example: 'Unit 3' })
  description?: string | null;

  @ApiPropertyOptional({ enum: WORK_ORDER_PRIORITIES, default: 'normal' })
  priority?: WorkOrderPriority;

  @ApiPropertyOptional({
    type: String,
    format: 'uuid',
    nullable: true,
    description: 'Active user of the caller tenant',
  })
  assignedUserId?: string | null;
}

export class UpdateWorkOrderDto {
  @ApiPropertyOptional({ maxLength: 255 })
  title?: string;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: MAX_DESCRIPTION_LENGTH })
  description?: string | null;

  @ApiPropertyOptional({ enum: WORK_ORDER_PRIORITIES })
  priority?: WorkOrderPriority;
}

export class AssignWorkOrderDto {
  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description: 'Active user of the work order tenant; null removes the assignee',
  })
  assignedUserId!: string | null;
}

export class UpdateWorkOrderStatusDto {
  @ApiProperty({
    enum: WORK_ORDER_STATUSES,
    enumName: 'WorkOrderStatus',
    description: 'COMPLETED and CANCELLED are final',
  })
  status!: WorkOrderStatus;
}

export class WorkOrderDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  tenantId!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty({ type: String, nullable: true })
  description!: string | null;

  @ApiProperty({ enum: WORK_ORDER_STATUSES, enumName: 'WorkOrderStatus' })
  status!: WorkOrderStatus;

  @ApiProperty({ enum: WORK_ORDER_PRIORITIES })
  priority!: WorkOrderPriority;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  assignedUserId!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: String, format: 'date-time', description: 'Changes on every update; use for updatedSince' })
  updatedAt!: Date;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, description: 'Set when status becomes COMPLETED' })
  completedAt!: Date | null;
}

export class WorkOrderPageDto extends PageMetaDto {
  @ApiProperty({ type: [WorkOrderDto] })
  items!: WorkOrderDto[];
}

export class WorkOrderLogDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: WORK_ORDER_STATUSES, enumName: 'WorkOrderStatus', nullable: true, description: 'null on creation' })
  previousStatus!: WorkOrderStatus | null;

  @ApiProperty({ enum: WORK_ORDER_STATUSES, enumName: 'WorkOrderStatus' })
  newStatus!: WorkOrderStatus;

  @ApiProperty({ format: 'uuid' })
  changedByUserId!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;
}
