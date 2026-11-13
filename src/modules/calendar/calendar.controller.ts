import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { AllowJobRoles } from '../auth/job-roles.js';
import { ApiErrors, BEARER_AUTH } from '../core/http/api-docs.js';
import { asObject, oneOf, optionalString, optionalUuid, parseTimestamp, requiredString } from '../core/http/validation.js';
import { CALENDAR_SCOPES, CalendarService, type EventInput, RESPONSES, VISIBILITIES } from './calendar.service.js';

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
  if (out.startsAt && out.endsAt && out.endsAt < out.startsAt) throw new BadRequestException('endsAt must be after startsAt');
  return out;
}

@ApiTags('Calendar')
@ApiBearerAuth(BEARER_AUTH)
@ApiErrors(401, 403)
@AllowJobRoles('HQ_ADMIN', 'ACCOUNT_MANAGER', 'FIELD_REPRESENTATIVE')
@Controller({ path: 'calendar', version: '1' })
export class CalendarController {
  constructor(private readonly calendar: CalendarService) {}

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

  @Post('events')
  @ApiOperation({ summary: 'Create an appointment; invitees get a notification (audit: calendar_event.created)' })
  @ApiBody(OBJ)
  @ApiErrors(400)
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
  @ApiOperation({ summary: 'Attendee: accept or decline (audit: calendar_event.responded)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody(OBJ)
  @ApiErrors(400, 404)
  respond(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @CurrentUser() identity: AuthenticatedUser): Promise<unknown> {
    return this.calendar.respond(id, oneOf('response', asObject(body).response, RESPONSES), identity);
  }
}
