import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiParam, ApiProperty, ApiQuery, ApiTags } from '@nestjs/swagger';
import { AllowExternal } from '../auth/allow-external.decorator.js';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { ApiErrors, BEARER_AUTH } from '../core/http/api-docs.js';
import { amount, asObject, isUuid, oneOf, optionalDate, optionalString, optionalUuid, requiredString } from '../core/http/validation.js';
import { type DealInput, type DealRecord, DealsService, type DealUpdate, type DealView, type MilestoneInput, MilestonesService, type MilestoneUpdate, type MilestoneView } from './deals.service.js';
import { DEAL_PRIORITIES, DEAL_STAGES, type DealPriority, type DealStage } from './entities/deal.entity.js';
import { MILESTONE_OWNER_SIDES, type MilestoneOwnerSide } from './entities/room-milestone.entity.js';

export class DealInputDto {
  @ApiProperty({ format: 'uuid' }) clientId!: string;
  @ApiProperty({ example: 'Replenishment Q3' }) title!: string;
  @ApiProperty({ required: false, example: '42000.00' }) value?: string;
  @ApiProperty({ required: false, enum: DEAL_STAGES, description: 'Only on create; afterwards use PATCH /deals/:id/stage' }) stage?: DealStage;
  @ApiProperty({ required: false, nullable: true, type: String, format: 'uuid' }) ownerId?: string | null;
  @ApiProperty({ required: false, enum: DEAL_PRIORITIES }) priority?: DealPriority;
  @ApiProperty({ required: false, nullable: true, type: String, format: 'uuid' }) clientRoomId?: string | null;
  @ApiProperty({ required: false, nullable: true, type: String, format: 'date' }) dueDate?: string | null;
  @ApiProperty({ required: false, nullable: true, type: String }) notes?: string | null;
}

export class DealDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) clientId!: string;
  @ApiProperty() clientName!: string;
  @ApiProperty() title!: string;
  @ApiProperty({ example: '42000.00' }) value!: string;
  @ApiProperty({ enum: DEAL_STAGES }) stage!: DealStage;
  @ApiProperty({ type: String, nullable: true, format: 'uuid' }) ownerId!: string | null;
  @ApiProperty({ type: String, nullable: true }) ownerName!: string | null;
  @ApiProperty({ enum: DEAL_PRIORITIES }) priority!: DealPriority;
  @ApiProperty({ type: String, nullable: true, format: 'uuid' }) clientRoomId!: string | null;
  @ApiProperty({ type: String, nullable: true }) clientRoomName!: string | null;
  @ApiProperty({ type: String, nullable: true, format: 'date' }) dueDate!: string | null;
  @ApiProperty({ type: String, nullable: true }) notes!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: Date;
  @ApiProperty({ format: 'date-time' }) updatedAt!: Date;
}

export class DealRecordDto extends DealDto {
  @ApiProperty({ type: 'array', items: { type: 'object' }, description: 'Stage changes, newest first' }) history!: unknown[];
}

export class StageDto {
  @ApiProperty({ enum: DEAL_STAGES }) stage!: DealStage;
}

export class MilestoneInputDto {
  @ApiProperty({ example: 'Legal review of the agreement' }) title!: string;
  @ApiProperty({ required: false, enum: MILESTONE_OWNER_SIDES, description: 'Who completes the step: the Agera team or the client' }) ownerSide?: MilestoneOwnerSide;
  @ApiProperty({ required: false, nullable: true, type: String, format: 'date' }) dueDate?: string | null;
}

export class MilestoneUpdateDto extends MilestoneInputDto {
  @ApiProperty({ required: false, description: 'Client contacts may only send this field, for client-side steps' }) completed?: boolean;
}

export class MilestoneDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) clientRoomId!: string;
  @ApiProperty() title!: string;
  @ApiProperty({ enum: MILESTONE_OWNER_SIDES }) ownerSide!: MilestoneOwnerSide;
  @ApiProperty({ type: String, nullable: true, format: 'date' }) dueDate!: string | null;
  @ApiProperty() completed!: boolean;
  @ApiProperty({ type: String, nullable: true, format: 'date-time' }) completedAt!: Date | null;
  @ApiProperty({ type: String, nullable: true }) completedByName!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: Date;
}

function dealFields(raw: Record<string, unknown>, partial: boolean): DealInput | DealUpdate {
  const out: DealUpdate & { stage?: DealStage } = {};
  if (!partial || raw.clientId !== undefined) {
    if (!isUuid(raw.clientId)) throw new BadRequestException('clientId must be a client id (UUID)');
    out.clientId = raw.clientId;
  }
  if (!partial || raw.title !== undefined) out.title = requiredString('title', raw.title, 200).trim();
  if (raw.value !== undefined) out.value = amount('value', raw.value);
  else if (!partial) out.value = '0.00';
  if (raw.priority !== undefined) out.priority = oneOf('priority', raw.priority, DEAL_PRIORITIES);
  else if (!partial) out.priority = 'medium';
  if (!partial || raw.ownerId !== undefined) out.ownerId = optionalUuid('ownerId', raw.ownerId);
  if (!partial || raw.clientRoomId !== undefined) out.clientRoomId = optionalUuid('clientRoomId', raw.clientRoomId);
  if (!partial || raw.dueDate !== undefined) out.dueDate = optionalDate('dueDate', raw.dueDate);
  if (!partial || raw.notes !== undefined) out.notes = optionalString('notes', raw.notes, 5000)?.trim() || null;
  if (raw.stage !== undefined) {
    if (partial) throw new BadRequestException('Change the stage with PATCH /v1/deals/:id/stage');
    out.stage = oneOf('stage', raw.stage, DEAL_STAGES);
  }
  if (partial && Object.keys(out).length === 0) throw new BadRequestException('Provide at least one field to change');
  return out;
}

@ApiTags('deals')
@ApiBearerAuth(BEARER_AUTH)
@ApiErrors(401, 403)
@Controller({ path: 'deals', version: '1' })
export class DealsController {
  constructor(private readonly deals: DealsService) {}

  @Get()
  @ApiOperation({ summary: 'Deal pipeline of the active tenant (Vanguard)' })
  @ApiQuery({ name: 'stage', required: false, enum: DEAL_STAGES })
  @ApiQuery({ name: 'clientId', required: false })
  @ApiOkResponse({ type: [DealDto] })
  @ApiErrors(400)
  list(@Query('stage') stage?: string, @Query('clientId') clientId?: string): Promise<DealView[]> {
    if (clientId !== undefined && !isUuid(clientId)) throw new BadRequestException('clientId must be a UUID');
    return this.deals.list({ stage: stage === undefined ? undefined : oneOf('stage', stage, DEAL_STAGES), clientId });
  }

  @Post()
  @ApiOperation({ summary: 'Create a deal (audit: deal.created)' })
  @ApiBody({ type: DealInputDto })
  @ApiCreatedResponse({ type: DealRecordDto })
  @ApiErrors(400)
  create(@Body() body: unknown, @CurrentUser() identity: AuthenticatedUser): Promise<DealRecord> {
    return this.deals.create(dealFields(asObject(body), false) as DealInput, identity);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Deal with its stage history' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: DealRecordDto })
  @ApiErrors(400, 404)
  get(@Param('id', ParseUUIDPipe) id: string): Promise<DealRecord> {
    return this.deals.get(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Edit a deal (audit: deal.updated)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody({ type: DealInputDto })
  @ApiOkResponse({ type: DealRecordDto })
  @ApiErrors(400, 404)
  update(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @CurrentUser() identity: AuthenticatedUser): Promise<DealRecord> {
    return this.deals.update(id, dealFields(asObject(body), true), identity);
  }

  @Patch(':id/stage')
  @ApiOperation({ summary: 'Move a deal to another pipeline stage (audit: deal.stage_changed)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody({ type: StageDto })
  @ApiOkResponse({ type: DealRecordDto })
  @ApiErrors(400, 404)
  stage(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @CurrentUser() identity: AuthenticatedUser): Promise<DealRecord> {
    return this.deals.changeStage(id, oneOf('stage', asObject(body).stage, DEAL_STAGES), identity);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a deal (audit: deal.deleted)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiNoContentResponse()
  @ApiErrors(400, 404)
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() identity: AuthenticatedUser): Promise<void> {
    return this.deals.remove(id, identity);
  }
}

function milestoneFields(raw: Record<string, unknown>, partial: boolean): MilestoneInput | MilestoneUpdate {
  const out: MilestoneUpdate = {};
  if (!partial || raw.title !== undefined) out.title = requiredString('title', raw.title, 200).trim();
  if (raw.ownerSide !== undefined) out.ownerSide = oneOf('ownerSide', raw.ownerSide, MILESTONE_OWNER_SIDES);
  else if (!partial) out.ownerSide = 'internal';
  if (!partial || raw.dueDate !== undefined) out.dueDate = optionalDate('dueDate', raw.dueDate);
  if (partial && raw.completed !== undefined) {
    if (typeof raw.completed !== 'boolean') throw new BadRequestException('completed must be true or false');
    out.completed = raw.completed;
  }
  if (partial && Object.keys(out).length === 0) throw new BadRequestException('Provide at least one field to change');
  return out;
}

@ApiTags('nexus')
@ApiBearerAuth(BEARER_AUTH)
@ApiErrors(401, 403)
@Controller({ path: 'nexus/client-rooms/:roomId/milestones', version: '1' })
export class MilestonesController {
  constructor(private readonly milestones: MilestonesService) {}

  @Get()
  @AllowExternal()
  @ApiOperation({ summary: 'Mutual action plan of a client room; client contacts see their own rooms' })
  @ApiParam({ name: 'roomId', format: 'uuid' })
  @ApiOkResponse({ type: [MilestoneDto] })
  @ApiErrors(400, 404)
  list(@Param('roomId', ParseUUIDPipe) roomId: string): Promise<MilestoneView[]> {
    return this.milestones.list(roomId);
  }

  @Post()
  @ApiOperation({ summary: 'Add a step to the action plan (audit: milestone.created)' })
  @ApiParam({ name: 'roomId', format: 'uuid' })
  @ApiBody({ type: MilestoneInputDto })
  @ApiCreatedResponse({ type: MilestoneDto })
  @ApiErrors(400, 404)
  create(@Param('roomId', ParseUUIDPipe) roomId: string, @Body() body: unknown, @CurrentUser() identity: AuthenticatedUser): Promise<MilestoneView> {
    return this.milestones.create(roomId, milestoneFields(asObject(body), false) as MilestoneInput, identity);
  }

  @Patch(':id')
  @AllowExternal()
  @ApiOperation({ summary: 'Edit or tick off a step; client contacts may only tick off client-side steps (audit: milestone.completed / reopened / updated)' })
  @ApiParam({ name: 'roomId', format: 'uuid' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody({ type: MilestoneUpdateDto })
  @ApiOkResponse({ type: MilestoneDto })
  @ApiErrors(400, 404)
  update(
    @Param('roomId', ParseUUIDPipe) roomId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @CurrentUser() identity: AuthenticatedUser,
  ): Promise<MilestoneView> {
    return this.milestones.update(roomId, id, milestoneFields(asObject(body), true), identity);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove a step (audit: milestone.deleted)' })
  @ApiParam({ name: 'roomId', format: 'uuid' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiNoContentResponse()
  @ApiErrors(400, 404)
  remove(@Param('roomId', ParseUUIDPipe) roomId: string, @Param('id', ParseUUIDPipe) id: string, @CurrentUser() identity: AuthenticatedUser): Promise<void> {
    return this.milestones.remove(roomId, id, identity);
  }
}
