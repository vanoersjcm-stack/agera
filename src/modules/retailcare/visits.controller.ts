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
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { ApiErrors, ApiPagination, ApiUpdatedSince, BEARER_AUTH } from '../core/http/api-docs.js';
import {
  asObject,
  assertPagination,
  isUuid,
  optionalString,
  optionalUuid,
  parseTimestamp,
} from '../core/http/validation.js';
import { CreateVisitDto, MAX_NOTES_LENGTH, UpdateVisitStatusDto, VisitDto, VisitPageDto } from './dto/visit.dto.js';
import type { MerchandisingVisit } from './entities/merchandising-visit.entity.js';
import { VISIT_STATUSES, isVisitStatus } from './entities/visit-status.js';
import { type CreateVisitInput, VisitsService } from './visits.service.js';

function toResponse(visit: MerchandisingVisit): VisitDto {
  return {
    id: visit.id,
    tenantId: visit.tenantId,
    storeId: visit.storeId,
    fieldRepId: visit.fieldRepId,
    workOrderId: visit.workOrderId ?? null,
    visitDate: visit.visitDate,
    notes: visit.notes ?? null,
    status: visit.status,
    createdAt: visit.createdAt,
    updatedAt: visit.updatedAt,
  };
}

function parseCreateVisit(body: unknown): CreateVisitInput {
  const { storeId, fieldRepId, workOrderId, visitDate, notes } = asObject(body);
  if (!isUuid(storeId)) {
    throw new BadRequestException('storeId must be a UUID');
  }
  const parsedVisitDate = parseTimestamp('visitDate', visitDate);
  if (parsedVisitDate === null) {
    throw new BadRequestException('visitDate is required');
  }
  return {
    storeId,
    fieldRepId: optionalUuid('fieldRepId', fieldRepId),
    workOrderId: optionalUuid('workOrderId', workOrderId),
    visitDate: parsedVisitDate,
    notes: optionalString('notes', notes, MAX_NOTES_LENGTH),
  };
}

@ApiTags('visits')
@ApiBearerAuth(BEARER_AUTH)
@ApiErrors(401, 403)
@Controller('visits')
export class VisitsController {
  constructor(private readonly visits: VisitsService) {}

  @Post()
  @ApiOperation({
    summary: 'Plan a merchandising visit (audit: visit.planned)',
    description: 'Store, field rep and work order must belong to the active tenant (400 otherwise).',
  })
  @ApiBody({ type: CreateVisitDto })
  @ApiCreatedResponse({ type: VisitDto })
  @ApiErrors(400)
  async create(@Body() body: unknown, @CurrentUser() identity: AuthenticatedUser): Promise<VisitDto> {
    return toResponse(await this.visits.create(parseCreateVisit(body), identity));
  }

  @Get()
  @ApiOperation({ summary: 'List visits of the active tenant (newest first, or oldest first with updatedSince)' })
  @ApiPagination()
  @ApiQuery({ name: 'storeId', required: false, schema: { type: 'string', format: 'uuid' }, description: 'Only visits of this store' })
  @ApiUpdatedSince()
  @ApiOkResponse({ type: VisitPageDto })
  @ApiErrors(400)
  async list(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('storeId') storeId?: string,
    @Query('updatedSince') updatedSince?: string,
  ): Promise<VisitPageDto> {
    assertPagination(page, limit);
    const result = await this.visits.list({
      page,
      limit,
      storeId: optionalUuid('storeId', storeId),
      updatedSince: parseTimestamp('updatedSince', updatedSince),
    });
    return { ...result, items: result.items.map(toResponse) };
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Change the status of a visit (audit: visit.status_changed)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody({ type: UpdateVisitStatusDto })
  @ApiOkResponse({ type: VisitDto })
  @ApiErrors(400, 404, 409)
  async updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @CurrentUser() identity: AuthenticatedUser,
  ): Promise<VisitDto> {
    const { status } = asObject(body);
    if (!isVisitStatus(status)) {
      throw new BadRequestException(`status must be one of ${VISIT_STATUSES.join(', ')}`);
    }
    return toResponse(await this.visits.updateStatus(id, status, identity));
  }
}
