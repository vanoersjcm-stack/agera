import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import { AllowExternal } from '../auth/allow-external.decorator.js';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { ApiErrors, BEARER_AUTH } from '../core/http/api-docs.js';
import { asObject, optionalUuid, requiredString } from '../core/http/validation.js';
import {
  AgreementDto,
  AnomaliesDto,
  ANOMALY_TYPES,
  type AnomalyType,
  CreateAgreementDto,
  UpdateAgreementDto,
  CreateDsrDto,
  DigitalSalesRoomDto,
  UpdateAgreementStatusDto,
  UpdateDsrStatusDto,
} from './dto/sales-rooms.dto.js';
import { type Agreement, AGREEMENT_STATUSES, type AgreementStatus, isAgreementStatus } from './entities/agreement.entity.js';
import { type DigitalSalesRoom, DSR_STATUSES, type DsrStatusValue, isDsrStatus } from './entities/digital-sales-room.entity.js';
import { SalesRoomsService } from './sales-rooms.service.js';

function toAgreementResponse(a: Agreement): AgreementDto {
  return {
    id: a.id,
    tenantId: a.tenantId,
    clientId: a.clientId,
    title: a.title,
    status: a.status,
    documentUrl: a.documentUrl,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  };
}

function toRoomResponse(r: DigitalSalesRoom): DigitalSalesRoomDto {
  return {
    id: r.id,
    tenantId: r.tenantId,
    clientId: r.clientId,
    agreementId: r.agreementId ?? null,
    roomName: r.roomName,
    status: r.status,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

function requiredUuid(name: string, value: unknown): string {
  const id = optionalUuid(name, value);
  if (id === null) {
    throw new BadRequestException(`${name} must be a UUID`);
  }
  return id.toLowerCase();
}

function parseDocumentUrl(value: unknown): string {
  const raw = requiredString('documentUrl', value, 500);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new BadRequestException('documentUrl must be an absolute http(s) URL');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new BadRequestException('documentUrl must be an absolute http(s) URL');
  }
  return raw;
}

function parseStatus<S extends string>(value: unknown, allowed: readonly S[], guard: (v: unknown) => v is S): S {
  if (!guard(value)) {
    throw new BadRequestException(`status must be one of ${allowed.join(', ')}`);
  }
  return value;
}

function optionalStatus<S extends string>(value: unknown, allowed: readonly S[], guard: (v: unknown) => v is S): S | null {
  return value === undefined ? null : parseStatus(value, allowed, guard);
}

@ApiTags('agreements')
@ApiBearerAuth(BEARER_AUTH)
@ApiErrors(401, 403)
@Controller({ path: 'agreements', version: '1' })
export class AgreementsController {
  constructor(private readonly service: SalesRoomsService) {}

  @Post()
  @ApiOperation({ summary: 'Create an agreement for an external client (internal users; audit: agreement.created)' })
  @ApiBody({ type: CreateAgreementDto })
  @ApiCreatedResponse({ type: AgreementDto })
  @ApiErrors(400)
  async create(@Body() body: unknown, @CurrentUser() identity: AuthenticatedUser): Promise<AgreementDto> {
    const { clientId, title, documentUrl, status } = asObject(body);
    const agreement = await this.service.createAgreement(
      {
        clientId: requiredUuid('clientId', clientId),
        title: requiredString('title', title, 200),
        documentUrl: parseDocumentUrl(documentUrl),
        status: optionalStatus(status, AGREEMENT_STATUSES, isAgreementStatus) ?? 'pending_approval',
      },
      identity,
    );
    return toAgreementResponse(agreement);
  }

  @Get()
  @AllowExternal()
  @ApiOperation({ summary: 'List agreements', description: 'External users (External_Client) only see their own client\'s agreements.' })
  @ApiQuery({ name: 'clientId', required: false, format: 'uuid' })
  @ApiQuery({ name: 'status', required: false, enum: AGREEMENT_STATUSES })
  @ApiOkResponse({ type: [AgreementDto] })
  @ApiErrors(400)
  async list(@Query('clientId') clientId?: string, @Query('status') status?: string): Promise<AgreementDto[]> {
    const rows = await this.service.listAgreements({
      clientId: optionalUuid('clientId', clientId),
      status: optionalStatus<AgreementStatus>(status, AGREEMENT_STATUSES, isAgreementStatus),
    });
    return rows.map(toAgreementResponse);
  }

  @Get(':id')
  @AllowExternal()
  @ApiOperation({ summary: 'One agreement' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: AgreementDto })
  @ApiErrors(400, 404)
  async get(@Param('id', ParseUUIDPipe) id: string): Promise<AgreementDto> {
    return toAgreementResponse(await this.service.getAgreement(id));
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Edit title or document link of an agreement (audit: agreement.updated)', description: 'Expired agreements return 409.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody({ type: UpdateAgreementDto })
  @ApiOkResponse({ type: AgreementDto })
  @ApiErrors(400, 404, 409)
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @CurrentUser() identity: AuthenticatedUser): Promise<AgreementDto> {
    const raw = asObject(body);
    const changes: { title?: string; documentUrl?: string } = {};
    if (raw.title !== undefined) changes.title = requiredString('title', raw.title, 200);
    if (raw.documentUrl !== undefined) changes.documentUrl = parseDocumentUrl(raw.documentUrl);
    if (Object.keys(changes).length === 0) {
      throw new BadRequestException('Provide at least one field to change');
    }
    return toAgreementResponse(await this.service.updateAgreement(id, changes, identity));
  }

  @Patch(':id/status')
  @ApiOperation({
    summary: 'Change agreement status (audit: agreement.status_changed)',
    description: 'pending_approval → active | expired, active → expired; expired is final (409).',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody({ type: UpdateAgreementStatusDto })
  @ApiOkResponse({ type: AgreementDto })
  @ApiErrors(400, 404, 409)
  async updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @CurrentUser() identity: AuthenticatedUser,
  ): Promise<AgreementDto> {
    const status = parseStatus(asObject(body).status, AGREEMENT_STATUSES, isAgreementStatus);
    return toAgreementResponse(await this.service.updateAgreementStatus(id, status, identity));
  }
}

@ApiTags('digital-sales-rooms')
@ApiBearerAuth(BEARER_AUTH)
@ApiErrors(401, 403)
@Controller({ path: 'dsrs', version: '1' })
export class SalesRoomsController {
  constructor(private readonly service: SalesRoomsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a Digital Sales Room (internal users; audit: dsr.created)' })
  @ApiBody({ type: CreateDsrDto })
  @ApiCreatedResponse({ type: DigitalSalesRoomDto })
  @ApiErrors(400)
  async create(@Body() body: unknown, @CurrentUser() identity: AuthenticatedUser): Promise<DigitalSalesRoomDto> {
    const { clientId, roomName, agreementId } = asObject(body);
    const room = await this.service.createRoom(
      {
        clientId: requiredUuid('clientId', clientId),
        roomName: requiredString('roomName', roomName, 150),
        agreementId: optionalUuid('agreementId', agreementId)?.toLowerCase() ?? null,
      },
      identity,
    );
    return toRoomResponse(room);
  }

  @Get()
  @AllowExternal()
  @ApiOperation({ summary: 'List Digital Sales Rooms', description: 'External users only see their own client\'s active rooms.' })
  @ApiQuery({ name: 'clientId', required: false, format: 'uuid' })
  @ApiQuery({ name: 'status', required: false, enum: DSR_STATUSES })
  @ApiOkResponse({ type: [DigitalSalesRoomDto] })
  @ApiErrors(400)
  async list(@Query('clientId') clientId?: string, @Query('status') status?: string): Promise<DigitalSalesRoomDto[]> {
    const rows = await this.service.listRooms({
      clientId: optionalUuid('clientId', clientId),
      status: optionalStatus<DsrStatusValue>(status, DSR_STATUSES, isDsrStatus),
    });
    return rows.map(toRoomResponse);
  }

  @Get(':id')
  @AllowExternal()
  @ApiOperation({ summary: 'One Digital Sales Room' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: DigitalSalesRoomDto })
  @ApiErrors(400, 404)
  async get(@Param('id', ParseUUIDPipe) id: string): Promise<DigitalSalesRoomDto> {
    return toRoomResponse(await this.service.getRoom(id));
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Archive or reactivate a Digital Sales Room (audit: dsr.status_changed)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody({ type: UpdateDsrStatusDto })
  @ApiOkResponse({ type: DigitalSalesRoomDto })
  @ApiErrors(400, 404)
  async updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @CurrentUser() identity: AuthenticatedUser,
  ): Promise<DigitalSalesRoomDto> {
    const status = parseStatus(asObject(body).status, DSR_STATUSES, isDsrStatus);
    return toRoomResponse(await this.service.updateRoomStatus(id, status, identity));
  }
}

@ApiTags('nexus')
@ApiBearerAuth(BEARER_AUTH)
@ApiErrors(401, 403)
@Controller({ path: 'nexus', version: '1' })
export class AnomaliesController {
  constructor(private readonly service: SalesRoomsService) {}

  @Get('anomalies')
  @ApiOperation({
    summary: 'Operational anomaly alerts (internal users)',
    description:
      '`financial_variance`: a line of an approved model with actuals more than 10% unfavourable vs. projection ' +
      '(revenue/license_fee below, cogs/opex above). `dsr_stagnation`: an active room without stakeholder ' +
      'interaction (opened, zone_viewed, briefing_played) for more than 7 days. `store_compliance`: a store whose ' +
      'latest visit report has `auditData.complianceStatus` set to anything other than `compliant`. ' +
      'Pull-based; nothing is pushed.',
  })
  @ApiQuery({ name: 'type', required: false, enum: ANOMALY_TYPES })
  @ApiOkResponse({ type: AnomaliesDto })
  @ApiErrors(400)
  async anomalies(@Query('type') type?: string): Promise<AnomaliesDto> {
    if (type !== undefined && !ANOMALY_TYPES.includes(type as AnomalyType)) {
      throw new BadRequestException(`type must be one of ${ANOMALY_TYPES.join(', ')}`);
    }
    const anomalies = await this.service.anomalies((type as AnomalyType | undefined) ?? null);
    return { generatedAt: new Date(), anomalies };
  }
}
