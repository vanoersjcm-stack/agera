import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { AllowJobRoles } from '../auth/job-roles.js';
import { ApiErrors, BEARER_AUTH } from '../core/http/api-docs.js';
import { amsterdamDate, asObject, oneOf, optionalString, optionalUuid, parseTimestamp, requiredString } from '../core/http/validation.js';
import { ASSET_CATEGORIES, type AssetInput, AgendaResourcesService, BOOKING_MODES, BUFFERS, LEAVE_DECISIONS, LEAVE_TYPES } from './agenda-resources.service.js';
import { CALENDAR_SCOPES, CalendarService, type EventInput, NOTE_LANGUAGES, PLANNING_MODES, RESPONSES, ROOM_CONFLICTS, VISIBILITIES, VISIT_CONFLICTS } from './calendar.service.js';

const OBJ = { schema: { type: 'object' } };

function when(name: string, value: unknown): Date {
  const d = parseTimestamp(name, value);
  if (!d) throw new BadRequestException(`${name} is required`);
  return d;
}

function attendees(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 50) throw new BadRequestException('attendeeIds must be a list of at most 50 ids');
  return value.map((v, i) => {
    const id = optionalUuid(`attendeeIds[${i}]`, v);
    if (!id) throw new BadRequestException(`attendeeIds[${i}] must be a uuid`);
    return id;
  });
}

function bookings(value: unknown): { assetId: string; bufferMinutes: number }[] {
  if (!Array.isArray(value) || value.length > 10) throw new BadRequestException('assets must be a list of at most 10 bookings');
  const out = value.map((v, i) => {
    const raw = asObject(v);
    const assetId = optionalUuid(`assets[${i}].assetId`, raw.assetId);
    if (!assetId) throw new BadRequestException(`assets[${i}].assetId must be a uuid`);
    const bufferMinutes = raw.bufferMinutes === undefined ? 0 : Number(raw.bufferMinutes);
    if (!(BUFFERS as readonly number[]).includes(bufferMinutes)) throw new BadRequestException(`assets[${i}].bufferMinutes must be 0, 15 or 30`);
    return { assetId, bufferMinutes };
  });
  if (new Set(out.map((b) => b.assetId)).size !== out.length) throw new BadRequestException('Each room or equipment can be booked once per appointment');
  return out;
}

function fields(raw: Record<string, unknown>, partial: boolean): Partial<EventInput> {
  const out: Partial<EventInput> = {};
  if (!partial || raw.title !== undefined) out.title = requiredString('title', raw.title, 200);
  if (!partial || raw.description !== undefined) out.description = optionalString('description', raw.description, 4000);
  if (!partial || raw.location !== undefined) out.location = optionalString('location', raw.location, 200);
  if (!partial || raw.startsAt !== undefined) out.startsAt = when('startsAt', raw.startsAt);
  if (!partial || raw.endsAt !== undefined) out.endsAt = when('endsAt', raw.endsAt);
  if (!partial || raw.allDay !== undefined) {
    if (raw.allDay !== undefined && typeof raw.allDay !== 'boolean') throw new BadRequestException('allDay must be true or false');
    out.allDay = raw.allDay === true;
  }
  if (!partial || raw.visibility !== undefined) out.visibility = oneOf('visibility', raw.visibility ?? 'team', VISIBILITIES);
  if (!partial || raw.clientId !== undefined) out.clientId = optionalUuid('clientId', raw.clientId);
  if (!partial || raw.storeId !== undefined) out.storeId = optionalUuid('storeId', raw.storeId);
  if (!partial || raw.attendeeIds !== undefined) out.attendeeIds = attendees(raw.attendeeIds);
  if (!partial && raw.assets !== undefined && raw.assets !== null) out.assets = bookings(raw.assets);
  if (!partial) out.planningMode = oneOf('planningMode', raw.planningMode ?? 'fixed', PLANNING_MODES);
  if (!partial && out.planningMode === 'mandatory') {
    out.visitConflicts = oneOf('visitConflicts', raw.visitConflicts ?? 'flag', VISIT_CONFLICTS);
    out.roomConflicts = oneOf('roomConflicts', raw.roomConflicts ?? 'free_only', ROOM_CONFLICTS);
  }
  if (!partial && raw.optionalIds !== undefined && raw.optionalIds !== null) {
    out.optionalIds = attendees(raw.optionalIds);
    if (out.optionalIds.some((id) => !(out.attendeeIds ?? []).includes(id))) throw new BadRequestException('optionalIds must also be in attendeeIds');
  }
  if (out.startsAt && out.endsAt && out.endsAt < out.startsAt) throw new BadRequestException('endsAt must be after startsAt');
  if (out.startsAt && amsterdamDate(out.startsAt) < amsterdamDate(new Date())) throw new BadRequestException('startsAt cannot be in the past');
  return out;
}

function assetFields(raw: Record<string, unknown>, partial: boolean): Partial<AssetInput> {
  const out: Partial<AssetInput> = {};
  if (!partial || raw.name !== undefined) out.name = requiredString('name', raw.name, 120).trim();
  if (!partial || raw.category !== undefined) out.category = oneOf('category', raw.category ?? 'meeting_room', ASSET_CATEGORIES);
  if (!partial || raw.bookingMode !== undefined) out.bookingMode = oneOf('bookingMode', raw.bookingMode ?? 'self_service', BOOKING_MODES);
  if (!partial || raw.active !== undefined) {
    if (raw.active !== undefined && typeof raw.active !== 'boolean') throw new BadRequestException('active must be true or false');
    out.active = raw.active !== false;
  }
  if (!partial || raw.notes !== undefined) out.notes = optionalString('notes', raw.notes, 1000)?.trim() || null;
  if (partial && Object.keys(out).length === 0) throw new BadRequestException('Provide at least one field to change');
  return out;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
function day(name: string, value: unknown): string {
  if (typeof value !== 'string' || !DATE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) throw new BadRequestException(`${name} must be a date (YYYY-MM-DD)`);
  return value;
}

@ApiTags('Calendar')
@ApiBearerAuth(BEARER_AUTH)
@ApiErrors(401, 403)
@AllowJobRoles('HQ_ADMIN', 'ACCOUNT_MANAGER', 'FIELD_REPRESENTATIVE')
@Controller({ path: 'calendar', version: '1' })
export class CalendarController {
  constructor(
    private readonly calendar: CalendarService,
    private readonly resources: AgendaResourcesService,
  ) {}

  @Get('assets')
  @ApiOperation({ summary: 'Bookable rooms and equipment (meeting rooms, AV equipment); includeInactive=true also lists deactivated ones' })
  @ApiQuery({ name: 'includeInactive', required: false, type: Boolean })
  assets(@Query('includeInactive') includeInactive: string | undefined): Promise<unknown[]> {
    return this.resources.assets(includeInactive === 'true');
  }

  @Post('assets')
  @ApiOperation({ summary: 'HQ or platform admin: add a room or piece of equipment (audit: bookable_asset.created)' })
  @ApiBody(OBJ)
  @ApiErrors(400, 409)
  createAsset(@Body() body: unknown, @CurrentUser() identity: AuthenticatedUser): Promise<unknown> {
    return this.resources.createAsset(assetFields(asObject(body), false) as AssetInput, identity);
  }

  @Patch('assets/:id')
  @ApiOperation({ summary: 'HQ or platform admin: change, deactivate or reactivate a room or piece of equipment (audit: bookable_asset.updated)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody(OBJ)
  @ApiErrors(400, 404, 409)
  updateAsset(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @CurrentUser() identity: AuthenticatedUser): Promise<unknown> {
    return this.resources.updateAsset(id, assetFields(asObject(body), true), identity);
  }

  @Get('bookings')
  @ApiOperation({ summary: 'Room and equipment bookings in a period (max 92 days), with the meeting and who booked it' })
  @ApiQuery({ name: 'from', required: true })
  @ApiQuery({ name: 'to', required: true })
  @ApiErrors(400)
  bookings(@Query('from') from: string, @Query('to') to: string): Promise<unknown[]> {
    const start = when('from', from);
    const end = when('to', to);
    if (end <= start) throw new BadRequestException('to must be after from');
    return this.resources.bookings(start, end);
  }

  @Post('events/:id/assets')
  @ApiOperation({ summary: 'Book a room or equipment for the appointment with an optional 15/30-minute buffer; double bookings are refused (audit: calendar_event.asset_booked)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody(OBJ)
  @ApiErrors(400, 403, 404, 409)
  async book(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @CurrentUser() identity: AuthenticatedUser): Promise<unknown> {
    const raw = asObject(body);
    const assetId = optionalUuid('assetId', raw.assetId);
    if (!assetId) throw new BadRequestException('assetId is required');
    const buffer = raw.bufferMinutes === undefined ? 0 : Number(raw.bufferMinutes);
    if (!(BUFFERS as readonly number[]).includes(buffer)) throw new BadRequestException('bufferMinutes must be 0, 15 or 30');
    await this.resources.book(id, assetId, buffer, identity);
    return this.calendar.event(id, identity);
  }

  @Delete('events/:id/assets/:assetId')
  @ApiOperation({ summary: 'Organiser or admin: release a room or equipment (audit: calendar_event.asset_released)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiParam({ name: 'assetId', format: 'uuid' })
  @ApiErrors(403, 404)
  async unbook(@Param('id', ParseUUIDPipe) id: string, @Param('assetId', ParseUUIDPipe) assetId: string, @CurrentUser() identity: AuthenticatedUser): Promise<unknown> {
    await this.resources.unbook(id, assetId, identity);
    return this.calendar.event(id, identity);
  }

  @Get('leave')
  @ApiOperation({ summary: 'Leave & vacation grid: internal colleagues and leave in a period; approved leave for all, pending/rejected for the requester and admins' })
  @ApiQuery({ name: 'from', required: true, example: '2026-11-01' })
  @ApiQuery({ name: 'to', required: true, example: '2026-11-30' })
  @ApiErrors(400)
  leave(@Query('from') from: string, @Query('to') to: string, @CurrentUser() identity: AuthenticatedUser): Promise<unknown> {
    const start = day('from', from);
    const end = day('to', to);
    if (end < start || Date.parse(end) - Date.parse(start) > 92 * 86_400_000) throw new BadRequestException('Ask for at most 92 days, with to on or after from');
    return this.resources.leave(start, end, identity);
  }

  @Post('leave')
  @ApiOperation({ summary: 'Request leave (pending until an HQ or platform admin approves); an admin entering leave for a colleague approves it directly (audit: leave.requested)' })
  @ApiBody(OBJ)
  @ApiErrors(400, 403)
  requestLeave(@Body() body: unknown, @CurrentUser() identity: AuthenticatedUser): Promise<unknown> {
    const raw = asObject(body);
    const startDate = day('startDate', raw.startDate);
    const endDate = day('endDate', raw.endDate ?? raw.startDate);
    if (endDate < startDate) throw new BadRequestException('endDate must be on or after startDate');
    return this.resources.requestLeave({
      userId: optionalUuid('userId', raw.userId), leaveType: oneOf('leaveType', raw.leaveType ?? 'vacation', LEAVE_TYPES), startDate, endDate,
      note: optionalString('note', raw.note, 500)?.trim() || null,
    }, identity);
  }

  @Post('leave/:id/decision')
  @ApiOperation({ summary: 'HQ or platform admin: approve or reject a pending leave request (audit: leave.approved / leave.rejected)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody(OBJ)
  @ApiErrors(400, 403, 409)
  decideLeave(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @CurrentUser() identity: AuthenticatedUser): Promise<unknown> {
    return this.resources.decideLeave(id, oneOf('decision', asObject(body).decision, LEAVE_DECISIONS), identity);
  }

  @Post('leave/:id/cancel')
  @ApiOperation({ summary: 'Requester or admin: cancel a leave request (audit: leave.cancelled)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiErrors(404, 409)
  cancelLeave(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() identity: AuthenticatedUser): Promise<unknown> {
    return this.resources.cancelLeave(id, identity);
  }

  @Get()
  @ApiOperation({ summary: 'Agera Calendar for a date range (max 92 days): appointments plus store visits, campaign/audit round due dates and client-room milestones' })
  @ApiQuery({ name: 'from', required: true, example: '2026-11-01T00:00:00Z' })
  @ApiQuery({ name: 'to', required: true, example: '2026-12-01T00:00:00Z' })
  @ApiQuery({ name: 'scope', required: false, enum: CALENDAR_SCOPES, description: 'mine (default) or team; field representatives always get mine' })
  @ApiErrors(400)
  items(@Query('from') from: string, @Query('to') to: string, @Query('scope') scope: string | undefined, @CurrentUser() identity: AuthenticatedUser): Promise<unknown[]> {
    const start = when('from', from);
    const end = when('to', to);
    if (end <= start) throw new BadRequestException('to must be after from');
    return this.calendar.items(start, end, oneOf('scope', scope ?? 'mine', CALENDAR_SCOPES), identity);
  }

  @Post('availability')
  @HttpCode(200)
  @ApiOperation({ summary: 'Busy periods of colleagues (agenda items, approved leave, store visits; private items without details) and of rooms/equipment, for Fixed date and Find a time' })
  @ApiBody(OBJ)
  @ApiErrors(400)
  availability(@Body() body: unknown, @CurrentUser() identity: AuthenticatedUser): Promise<unknown> {
    const raw = asObject(body);
    const from = when('from', raw.from);
    const to = when('to', raw.to);
    if (to <= from || to.getTime() - from.getTime() > 92 * 86_400_000) throw new BadRequestException('to must be after from and at most 92 days later');
    const ids = (name: string, v: unknown) => {
      if (v === undefined || v === null) return [];
      if (!Array.isArray(v) || v.length > 50) throw new BadRequestException(`${name} must be a list of at most 50 ids`);
      return v.map((x, i) => { const id = optionalUuid(`${name}[${i}]`, x); if (!id) throw new BadRequestException(`${name}[${i}] must be a uuid`); return id; });
    };
    return this.calendar.availability([...new Set(ids('userIds', raw.userIds))], [...new Set(ids('assetIds', raw.assetIds))], from, to, identity);
  }

  @Post('events')
  @ApiOperation({ summary: 'Create an agenda item, optionally booking rooms/equipment in the same transaction (assets: [{assetId, bufferMinutes}]); invitees get a notification (audit: calendar_event.created)' })
  @ApiBody(OBJ)
  @ApiErrors(400, 403, 404, 409)
  create(@Body() body: unknown, @CurrentUser() identity: AuthenticatedUser): Promise<unknown> {
    return this.calendar.create(fields(asObject(body), false) as EventInput, identity);
  }

  @Get('events/:id')
  @ApiOperation({ summary: 'One appointment with its attendees and their responses' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiErrors(404)
  event(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() identity: AuthenticatedUser): Promise<unknown> {
    return this.calendar.event(id, identity);
  }

  @Patch('events/:id')
  @ApiOperation({ summary: 'Organiser: move or change an appointment (audit: calendar_event.updated)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody(OBJ)
  @ApiErrors(400, 404, 409)
  update(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @CurrentUser() identity: AuthenticatedUser): Promise<unknown> {
    const changes = fields(asObject(body), true);
    if (Object.keys(changes).length === 0) throw new BadRequestException('Provide at least one field to change');
    return this.calendar.update(id, changes, identity);
  }

  @Post('events/:id/cancel')
  @ApiOperation({ summary: 'Organiser: cancel an appointment; attendees get a notification (audit: calendar_event.cancelled)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiErrors(404)
  cancel(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() identity: AuthenticatedUser): Promise<unknown> {
    return this.calendar.cancel(id, identity);
  }

  @Post('events/:id/respond')
  @ApiOperation({ summary: "Attendee: accept, decline, or 'unable' with a reason (mandatory meetings cannot be declined; the organiser is notified) (audit: calendar_event.responded)" })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody(OBJ)
  @ApiErrors(400, 404)
  respond(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @CurrentUser() identity: AuthenticatedUser): Promise<unknown> {
    const raw = asObject(body);
    const reason = typeof raw.reason === 'string' && raw.reason.trim() ? raw.reason.trim().slice(0, 500) : null;
    return this.calendar.respond(id, oneOf('response', raw.response, RESPONSES), identity, reason);
  }

  @Post('events/:id/documents')
  @ApiOperation({ summary: 'Organiser or invitee: link an existing document (Agera.text/.calc/.slides or client-room document) to the appointment (audit: calendar_event.document_attached)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody(OBJ)
  @ApiErrors(400, 403, 404)
  attach(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @CurrentUser() identity: AuthenticatedUser): Promise<unknown> {
    const documentId = optionalUuid('documentId', asObject(body).documentId);
    if (!documentId) throw new BadRequestException('documentId is required');
    return this.calendar.attach(id, documentId, identity);
  }

  @Delete('events/:id/documents/:documentId')
  @ApiOperation({ summary: 'Organiser or whoever linked it: remove a document link; the document itself is kept (audit: calendar_event.document_detached)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiParam({ name: 'documentId', format: 'uuid' })
  @ApiErrors(403, 404)
  detach(@Param('id', ParseUUIDPipe) id: string, @Param('documentId', ParseUUIDPipe) documentId: string, @CurrentUser() identity: AuthenticatedUser): Promise<unknown> {
    return this.calendar.detach(id, documentId, identity);
  }

  @Post('events/:id/meeting-notes')
  @ApiOperation({ summary: 'Organiser or invitee: create pre-filled meeting notes (Agera.text) linked to the appointment, once per appointment (audit: calendar_event.meeting_notes_created)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody(OBJ)
  @ApiErrors(400, 403, 404, 503)
  meetingNotes(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @CurrentUser() identity: AuthenticatedUser): Promise<unknown> {
    const raw = asObject(body ?? {});
    return this.calendar.meetingNotes(id, raw.language === undefined ? 'en' : oneOf('language', raw.language, NOTE_LANGUAGES), identity);
  }
}
