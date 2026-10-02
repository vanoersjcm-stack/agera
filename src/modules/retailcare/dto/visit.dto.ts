import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PageMetaDto } from '../../core/http/api-docs.js';
import { VISIT_STATUSES, type VisitStatus } from '../entities/visit-status.js';

export const MAX_NOTES_LENGTH = 10_000;

export class CreateVisitDto {
  @ApiProperty({ format: 'uuid', description: 'Store of the caller tenant' })
  storeId!: string;

  @ApiProperty({ type: String, format: 'date-time', example: '2026-11-02T09:30:00.000Z', description: 'Timezone required' })
  visitDate!: string;

  @ApiPropertyOptional({
    type: String,
    format: 'uuid',
    nullable: true,
    description: 'Active user of the caller tenant; defaults to the caller',
  })
  fieldRepId?: string | null;

  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true, description: 'Work order of the caller tenant' })
  workOrderId?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: MAX_NOTES_LENGTH })
  notes?: string | null;
}

export class UpdateVisitStatusDto {
  @ApiProperty({ enum: VISIT_STATUSES, enumName: 'VisitStatus', description: 'COMPLETED and CANCELLED are final' })
  status!: VisitStatus;
}

export class VisitDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  tenantId!: string;

  @ApiProperty({ format: 'uuid' })
  storeId!: string;

  @ApiProperty({ format: 'uuid' })
  fieldRepId!: string;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  workOrderId!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  visitDate!: Date;

  @ApiProperty({ type: String, nullable: true })
  notes!: string | null;

  @ApiProperty({ enum: VISIT_STATUSES, enumName: 'VisitStatus' })
  status!: VisitStatus;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: String, format: 'date-time', description: 'Changes on every update; use for updatedSince' })
  updatedAt!: Date;
}

export class VisitPageDto extends PageMetaDto {
  @ApiProperty({ type: [VisitDto] })
  items!: VisitDto[];
}
