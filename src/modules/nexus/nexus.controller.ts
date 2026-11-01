import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UploadedFile,
  UseFilters,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { AllowExternal } from '../auth/allow-external.decorator.js';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { ApiErrors, BEARER_AUTH } from '../core/http/api-docs.js';
import { asObject, optionalUuid, requiredString } from '../core/http/validation.js';
import { AudioUploadExceptionFilter } from './audio-upload-exception.filter.js';
import { AUDIO_MIME_TYPES, MAX_AUDIO_BYTES, detectAudioMimeType } from './audio-type.js';
import {
  DsrActivityDto,
  DsrStatusDto,
  NexusCommandDto,
  NexusCommandResultDto,
  RecordDsrActivityDto,
  UploadVoiceEventDto,
  VoiceEventDto,
} from './dto/nexus.dto.js';
import { type DsrActivity, DSR_ACTIVITY_TYPES, isDsrActivityType } from './entities/dsr-activity.entity.js';
import type { NexusVoiceEvent } from './entities/nexus-voice-event.entity.js';
import { NexusService, type RecordActivityInput } from './nexus.service.js';

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+$/;
const DEFAULT_WINDOW_DAYS = 30;
const MAX_WINDOW_DAYS = 365;

/** Subset of the multer file object (kept in memory). */
interface UploadedAudio {
  size: number;
  buffer: Buffer;
}

function toActivityResponse(activity: DsrActivity): DsrActivityDto {
  return {
    id: activity.id,
    tenantId: activity.tenantId,
    dsrId: activity.dsrId,
    stakeholderEmail: activity.stakeholderEmail,
    activityType: activity.activityType,
    details: activity.details,
    createdAt: activity.createdAt,
  };
}

function toVoiceEventResponse(event: NexusVoiceEvent): VoiceEventDto {
  return {
    id: event.id,
    tenantId: event.tenantId,
    userId: event.userId,
    contextRoute: event.contextRoute,
    audioMimeType: event.audioMimeType,
    audioSizeBytes: event.audioSizeBytes,
    status: event.status,
    transcriptText: event.transcriptText ?? null,
    extractedAction: event.extractedActionJson,
    createdAt: event.createdAt,
    updatedAt: event.updatedAt,
  };
}

function parseContextRoute(value: unknown): string {
  const route = requiredString('contextRoute', value, 255);
  if (!route.startsWith('/')) {
    throw new BadRequestException('contextRoute must be an application route starting with /');
  }
  return route;
}

function parseRecordActivity(body: unknown): RecordActivityInput {
  const { dsrId, stakeholderEmail, activityType, details } = asObject(body);
  const id = optionalUuid('dsrId', dsrId);
  if (id === null) {
    throw new BadRequestException('dsrId must be a UUID');
  }
  const email = requiredString('stakeholderEmail', stakeholderEmail, 255).toLowerCase();
  if (!EMAIL_PATTERN.test(email)) {
    throw new BadRequestException('stakeholderEmail must be an email address');
  }
  if (!isDsrActivityType(activityType)) {
    throw new BadRequestException(`activityType must be one of ${DSR_ACTIVITY_TYPES.join(', ')}`);
  }
  if (details !== undefined && (typeof details !== 'object' || details === null || Array.isArray(details))) {
    throw new BadRequestException('details must be a JSON object');
  }
  return {
    dsrId: id,
    stakeholderEmail: email,
    activityType,
    details: (details as Record<string, unknown> | undefined) ?? {},
  };
}

@ApiTags('nexus')
@ApiBearerAuth(BEARER_AUTH)
@ApiErrors(401, 403)
@Controller({ path: 'nexus', version: '1' })
export class NexusController {
  constructor(private readonly nexus: NexusService) {}

  @Get('dsr-status')
  @AllowExternal()
  @ApiOperation({
    summary: 'DSR engagement metrics and stakeholder statuses',
    description:
      'Digital Sales Rooms with activity in the last `windowDays` days, each with per-type activity counts and the ' +
      'latest state of every stakeholder. Pull-based: clients poll this endpoint; nothing is pushed.',
  })
  @ApiQuery({ name: 'windowDays', required: false, type: Number, example: DEFAULT_WINDOW_DAYS })
  @ApiQuery({ name: 'dsrId', required: false, format: 'uuid' })
  @ApiOkResponse({ type: DsrStatusDto })
  @ApiErrors(400)
  async dsrStatus(@Query('windowDays') windowDays?: string, @Query('dsrId') dsrId?: string): Promise<DsrStatusDto> {
    const days = windowDays === undefined ? DEFAULT_WINDOW_DAYS : Number(windowDays);
    if (!Number.isInteger(days) || days < 1 || days > MAX_WINDOW_DAYS) {
      throw new BadRequestException(`windowDays must be an integer between 1 and ${MAX_WINDOW_DAYS}`);
    }
    return this.nexus.dsrStatus(days, optionalUuid('dsrId', dsrId));
  }

  @Get('dsr-activities')
  @AllowExternal()
  @ApiOperation({
    summary: 'Activity stream of a DSR, newest first',
    description: 'Client users (External_Client) only see activities in their own rooms; other rooms return an empty list.',
  })
  @ApiQuery({ name: 'dsrId', required: true, format: 'uuid' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: '1–200, default 50' })
  @ApiOkResponse({ type: [DsrActivityDto] })
  @ApiErrors(400)
  async listActivities(@Query('dsrId') dsrId?: string, @Query('limit') limit?: string): Promise<DsrActivityDto[]> {
    const id = optionalUuid('dsrId', dsrId);
    if (id === null) {
      throw new BadRequestException('dsrId is required');
    }
    const take = limit === undefined ? 50 : Number(limit);
    if (!Number.isInteger(take) || take < 1 || take > 200) {
      throw new BadRequestException('limit must be an integer between 1 and 200');
    }
    return (await this.nexus.listActivities(id, take)).map(toActivityResponse);
  }

  @Post('dsr-activities')
  @AllowExternal()
  @ApiOperation({
    summary: 'Record a stakeholder activity in a DSR (audit: dsr.activity_recorded)',
    description:
      'External users (External_Client) may only record activities in their own active rooms (else 404); ' +
      'their stakeholderEmail is always their own token email.',
  })
  @ApiBody({ type: RecordDsrActivityDto })
  @ApiCreatedResponse({ type: DsrActivityDto })
  @ApiErrors(400, 404)
  async recordActivity(@Body() body: unknown, @CurrentUser() identity: AuthenticatedUser): Promise<DsrActivityDto> {
    return toActivityResponse(await this.nexus.recordActivity(parseRecordActivity(body), identity));
  }

  @Post('command')
  @ApiOperation({
    summary: 'Ingest a Nexus Command Bar command (audit: nexus.command)',
    description:
      'Routes the command to a view with deterministic keyword matching and records it in the audit log. ' +
      'Tenant, user and roles are taken from the access token.',
  })
  @ApiBody({ type: NexusCommandDto })
  @ApiCreatedResponse({ type: NexusCommandResultDto })
  @ApiErrors(400)
  async command(@Body() body: unknown, @CurrentUser() identity: AuthenticatedUser): Promise<NexusCommandResultDto> {
    const { command, contextRoute } = asObject(body);
    return this.nexus.command(
      { command: requiredString('command', command, 500), contextRoute: parseContextRoute(contextRoute) },
      identity,
    );
  }

  @Post('voice-event')
  @UseFilters(AudioUploadExceptionFilter)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_AUDIO_BYTES, files: 1, fields: 5 } }))
  @ApiOperation({
    summary: 'Queue a short voice clip for local Whisper processing (audit: nexus.voice_event_queued)',
    description: `multipart/form-data with \`file\` (${AUDIO_MIME_TYPES.join(', ')}, at most ${MAX_AUDIO_BYTES / (1024 * 1024)} MB) and \`contextRoute\`. The event is stored with status \`pending\`.`,
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ type: UploadVoiceEventDto })
  @ApiCreatedResponse({ type: VoiceEventDto })
  @ApiErrors(400)
  async voiceEvent(
    @UploadedFile() file: UploadedAudio | undefined,
    @Body() body: unknown,
    @CurrentUser() identity: AuthenticatedUser,
  ): Promise<VoiceEventDto> {
    const { contextRoute } = asObject(body);
    const route = parseContextRoute(contextRoute);
    if (!file || file.size === 0) {
      throw new BadRequestException('file is required');
    }
    const mimeType = detectAudioMimeType(file.buffer);
    if (mimeType === null) {
      throw new BadRequestException(`file must be one of ${AUDIO_MIME_TYPES.join(', ')}`);
    }
    return toVoiceEventResponse(await this.nexus.addVoiceEvent(route, { data: file.buffer, mimeType }, identity));
  }

  @Get('voice-events/:id')
  @ApiOperation({ summary: 'Poll the processing state of a voice event' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: VoiceEventDto })
  @ApiErrors(400, 404)
  async getVoiceEvent(@Param('id', ParseUUIDPipe) id: string): Promise<VoiceEventDto> {
    return toVoiceEventResponse(await this.nexus.getVoiceEvent(id));
  }
}
