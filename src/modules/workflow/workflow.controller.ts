import { BadRequestException, Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { ApiErrors, BEARER_AUTH } from '../core/http/api-docs.js';
import { asObject, oneOf, optionalString, optionalUuid, requiredString } from '../core/http/validation.js';
import { APPROVAL_ENTITIES, EXCEPTION_STATUSES, type ExceptionStatus, SEVERITIES, WorkflowService } from './workflow.service.js';

const OBJ = { schema: { type: 'object' } };

@ApiTags('workflow')
@ApiBearerAuth(BEARER_AUTH)
@ApiErrors(401, 403)
@Controller({ version: '1' })
export class WorkflowController {
  constructor(private readonly workflow: WorkflowService) {}

  @Get('approvals')
  @ApiOperation({ summary: 'Approval requests (mine=true: waiting for my decision)' })
  @ApiQuery({ name: 'mine', required: false, type: Boolean })
  @ApiQuery({ name: 'entityId', required: false })
  @ApiQuery({ name: 'status', required: false, enum: ['pending', 'approved', 'rejected', 'cancelled'] })
  @ApiOkResponse(OBJ)
  approvals(@CurrentUser() identity: AuthenticatedUser, @Query('mine') mine?: string, @Query('entityId') entityId?: string, @Query('status') status?: string): Promise<unknown[]> {
    return this.workflow.approvals(
      { mine: mine === 'true', entityId: optionalUuid('entityId', entityId), status: status ? oneOf('status', status, ['pending', 'approved', 'rejected', 'cancelled'] as const) : null },
      identity,
    );
  }

  @Get('approvals/:id')
  @ApiOperation({ summary: 'Approval request with its steps' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse(OBJ)
  @ApiErrors(404)
  approval(@Param('id', ParseUUIDPipe) id: string): Promise<unknown> {
    return this.workflow.approval(id);
  }

  @Post('approvals')
  @ApiOperation({ summary: 'Send a draft plan or an agreement awaiting approval through an ordered approval chain (audit: approval.requested)' })
  @ApiBody(OBJ)
  @ApiCreatedResponse(OBJ)
  @ApiErrors(400, 409)
  request(@Body() body: unknown, @CurrentUser() identity: AuthenticatedUser): Promise<unknown> {
    const raw = asObject(body);
    const entityId = optionalUuid('entityId', raw.entityId);
    if (!entityId) throw new BadRequestException('entityId is required');
    if (!Array.isArray(raw.approverIds) || raw.approverIds.length < 1 || raw.approverIds.length > 5) throw new BadRequestException('approverIds must list 1 to 5 colleagues in order');
    const approvers = raw.approverIds.map((v, i) => {
      const id = optionalUuid(`approverIds[${i}]`, v);
      if (!id) throw new BadRequestException(`approverIds[${i}] must be a uuid`);
      return id;
    });
    if (new Set(approvers).size !== approvers.length) throw new BadRequestException('each approver may appear only once');
    return this.workflow.requestApproval(oneOf('entityType', raw.entityType, APPROVAL_ENTITIES), entityId, approvers, optionalString('note', raw.note, 2000), identity);
  }

  @Post('approvals/:id/decision')
  @ApiOperation({ summary: 'Approve or reject as the current approver; the last approval performs the status change (audit: approval.approved / rejected)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody(OBJ)
  @ApiCreatedResponse(OBJ)
  @ApiErrors(400, 404, 409)
  decide(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @CurrentUser() identity: AuthenticatedUser): Promise<unknown> {
    const raw = asObject(body);
    return this.workflow.decide(id, oneOf('decision', raw.decision, ['approved', 'rejected'] as const), optionalString('comment', raw.comment, 2000), identity);
  }

  @Post('approvals/:id/cancel')
  @ApiOperation({ summary: 'Withdraw a pending approval request (audit: approval.cancelled)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiCreatedResponse(OBJ)
  @ApiErrors(404, 409)
  cancel(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() identity: AuthenticatedUser): Promise<unknown> {
    return this.workflow.cancelApproval(id, identity);
  }

  @Get('exceptions')
  @ApiOperation({ summary: 'Manual exceptions' })
  @ApiQuery({ name: 'status', required: false, enum: [...EXCEPTION_STATUSES, 'unresolved'] })
  @ApiOkResponse(OBJ)
  @ApiErrors(400)
  exceptions(@Query('status') status?: string): Promise<unknown[]> {
    return this.workflow.exceptions(status ? oneOf('status', status, [...EXCEPTION_STATUSES, 'unresolved'] as const) : null);
  }

  @Get('exceptions/:id')
  @ApiOperation({ summary: 'One exception' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse(OBJ)
  @ApiErrors(404)
  exception(@Param('id', ParseUUIDPipe) id: string): Promise<unknown> {
    return this.workflow.exception(id);
  }

  @Post('exceptions')
  @ApiOperation({ summary: 'Log an exception with three responsible parties: client contact (clientContactId), Agera account manager (ownerId) and responsible Agera executive (executiveId) (audit: exception.created)' })
  @ApiBody(OBJ)
  @ApiCreatedResponse(OBJ)
  @ApiErrors(400)
  createException(@Body() body: unknown, @CurrentUser() identity: AuthenticatedUser): Promise<unknown> {
    const raw = asObject(body);
    return this.workflow.createException(
      {
        title: requiredString('title', raw.title, 200),
        description: optionalString('description', raw.description, 4000),
        severity: raw.severity === undefined ? 'medium' : oneOf('severity', raw.severity, SEVERITIES),
        ownerId: optionalUuid('ownerId', raw.ownerId),
        clientContactId: optionalUuid('clientContactId', raw.clientContactId),
        executiveId: optionalUuid('executiveId', raw.executiveId),
        storeId: optionalUuid('storeId', raw.storeId),
        clientId: optionalUuid('clientId', raw.clientId),
        source: optionalString('source', raw.source, 200),
      },
      identity,
    );
  }

  @Patch('exceptions/:id')
  @ApiOperation({ summary: 'Update, reassign or resolve an exception (audit: exception.updated)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody(OBJ)
  @ApiOkResponse(OBJ)
  @ApiErrors(400, 404)
  updateException(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @CurrentUser() identity: AuthenticatedUser): Promise<unknown> {
    const raw = asObject(body);
    return this.workflow.updateException(
      id,
      {
        ...(raw.title !== undefined ? { title: requiredString('title', raw.title, 200) } : {}),
        ...(raw.description !== undefined ? { description: optionalString('description', raw.description, 4000) } : {}),
        ...(raw.severity !== undefined ? { severity: oneOf('severity', raw.severity, SEVERITIES) } : {}),
        ...(raw.status !== undefined ? { status: oneOf('status', raw.status, EXCEPTION_STATUSES) as ExceptionStatus } : {}),
        ...(raw.ownerId !== undefined ? { ownerId: optionalUuid('ownerId', raw.ownerId) } : {}),
        ...(raw.clientContactId !== undefined ? { clientContactId: optionalUuid('clientContactId', raw.clientContactId) } : {}),
        ...(raw.executiveId !== undefined ? { executiveId: optionalUuid('executiveId', raw.executiveId) } : {}),
        ...(raw.resolution !== undefined ? { resolution: optionalString('resolution', raw.resolution, 4000) } : {}),
      },
      identity,
    );
  }

  @Get('notifications')
  @ApiOperation({ summary: 'My latest notifications and unread count' })
  @ApiOkResponse(OBJ)
  notifications(@CurrentUser() identity: AuthenticatedUser): Promise<unknown> {
    return this.workflow.notifications(identity);
  }

  @Post('notifications/read')
  @HttpCode(204)
  @ApiOperation({ summary: 'Mark one notification (id) or all as read' })
  @ApiBody(OBJ)
  @ApiErrors(400)
  async read(@Body() body: unknown, @CurrentUser() identity: AuthenticatedUser): Promise<void> {
    await this.workflow.markRead(optionalUuid('id', asObject(body ?? {}).id), identity);
  }

  @Get('clients-health')
  @ApiOperation({ summary: 'Account health score (0–100) and engagement per active client, with the factors behind it' })
  @ApiOkResponse(OBJ)
  health(): Promise<unknown[]> {
    return this.workflow.health();
  }

  @Get('nexus/client-rooms/:roomId/engagement-score')
  @ApiOperation({ summary: 'Engagement score (0–100) of a client room over the last 30 days' })
  @ApiParam({ name: 'roomId', format: 'uuid' })
  @ApiOkResponse(OBJ)
  roomEngagement(@Param('roomId', ParseUUIDPipe) roomId: string): Promise<unknown> {
    return this.workflow.roomEngagement(roomId);
  }
}
