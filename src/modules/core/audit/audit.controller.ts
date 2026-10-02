import { Controller, DefaultValuePipe, Get, ParseIntPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import type { AuditLog } from '../entities/index.js';
import { ApiErrors, ApiPagination, BEARER_AUTH, PageMetaDto } from '../http/api-docs.js';
import { assertPagination } from '../http/validation.js';
import { AuditService } from './audit.service.js';

export class AuditLogDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  tenantId!: string;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  userId!: string | null;

  @ApiProperty({ example: 'work_order.status_changed' })
  action!: string;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    nullable: true,
    example: { workOrderId: 'b1c2…', previousStatus: 'PENDING', newStatus: 'IN_PROGRESS' },
  })
  details!: Record<string, unknown> | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;
}

export class AuditLogPageDto extends PageMetaDto {
  @ApiProperty({ type: [AuditLogDto] })
  items!: AuditLogDto[];
}

function toResponse(log: AuditLog): AuditLogDto {
  return {
    id: log.id,
    tenantId: log.tenantId,
    userId: log.userId,
    action: log.action,
    details: log.details,
    createdAt: log.createdAt,
  };
}

@ApiTags('audit-logs')
@ApiBearerAuth(BEARER_AUTH)
@ApiErrors(401, 403)
@Controller('audit-logs')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @ApiOperation({ summary: 'Audit log of the active tenant, newest first' })
  @ApiPagination()
  @ApiOkResponse({ type: AuditLogPageDto })
  @ApiErrors(400)
  async list(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ): Promise<AuditLogPageDto> {
    assertPagination(page, limit);
    const result = await this.audit.findForActiveTenant(page, limit);
    return { ...result, items: result.items.map(toResponse) };
  }
}
