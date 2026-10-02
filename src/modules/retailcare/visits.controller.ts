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
  isUuid,
  optionalString,
  optionalUuid,
  parseTimestamp,
} from '../core/http/validation.js';
import type { MerchandisingVisit } from './entities/merchandising-visit.entity.js';
import { VISIT_STATUSES, type VisitStatus, isVisitStatus } from './entities/visit-status.js';
import { type CreateVisitInput, VisitsService } from './visits.service.js';

const MAX_NOTES_LENGTH = 10_000;

export interface VisitResponse {
  id: string;
  tenantId: string;
  storeId: string;
  fieldRepId: string;
  workOrderId: string | null;
  visitDate: Date;
  notes: string | null;
  status: VisitStatus;
  createdAt: Date;
  updatedAt: Date;
}

function toResponse(visit: MerchandisingVisit): VisitResponse {
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

@Controller('visits')
export class VisitsController {
  constructor(private readonly visits: VisitsService) {}

  @Post()
  async create(@Body() body: unknown, @CurrentUser() identity: AuthenticatedUser): Promise<VisitResponse> {
    return toResponse(await this.visits.create(parseCreateVisit(body), identity));
  }

  @Get()
  async list(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('store_id') storeId?: string,
    @Query('updated_since') updatedSince?: string,
  ): Promise<{ items: VisitResponse[]; page: number; limit: number; total: number }> {
    assertPagination(page, limit);
    const result = await this.visits.list({
      page,
      limit,
      storeId: optionalUuid('store_id', storeId),
      updatedSince: parseTimestamp('updated_since', updatedSince),
    });
    return { ...result, items: result.items.map(toResponse) };
  }

  @Patch(':id/status')
  async updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @CurrentUser() identity: AuthenticatedUser,
  ): Promise<VisitResponse> {
    const { status } = asObject(body);
    if (!isVisitStatus(status)) {
      throw new BadRequestException(`status must be one of ${VISIT_STATUSES.join(', ')}`);
    }
    return toResponse(await this.visits.updateStatus(id, status, identity));
  }
}
