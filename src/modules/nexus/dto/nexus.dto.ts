import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AUDIO_MIME_TYPES } from '../audio-type.js';
import { NEXUS_INTENTS, type NexusIntent } from '../command-intents.js';
import { DSR_ACTIVITY_TYPES, type DsrActivityType } from '../entities/dsr-activity.entity.js';
import { VOICE_EVENT_STATUSES, type VoiceEventStatus } from '../entities/nexus-voice-event.entity.js';

export class RecordDsrActivityDto {
  @ApiProperty({ format: 'uuid', description: 'Digital Sales Room id' })
  dsrId!: string;

  @ApiProperty({ format: 'email', maxLength: 255, example: 'buyer@retailer.example' })
  stakeholderEmail!: string;

  @ApiProperty({ enum: DSR_ACTIVITY_TYPES })
  activityType!: DsrActivityType;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true, example: { document: 'proposal-v2.pdf' } })
  details?: Record<string, unknown>;
}

export class DsrActivityDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  tenantId!: string;

  @ApiProperty({ format: 'uuid' })
  dsrId!: string;

  @ApiProperty()
  stakeholderEmail!: string;

  @ApiProperty({ enum: DSR_ACTIVITY_TYPES })
  activityType!: DsrActivityType;

  @ApiProperty({ type: 'object', additionalProperties: true })
  details!: Record<string, unknown>;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;
}

export class StakeholderStateDto {
  @ApiProperty()
  email!: string;

  @ApiProperty({
    enum: ['accepted', 'rejected', 'engaged'],
    description: 'Latest terms decision; engaged = active without a decision',
  })
  status!: string;

  @ApiProperty()
  activityCount!: number;

  @ApiProperty({ enum: DSR_ACTIVITY_TYPES })
  lastActivityType!: DsrActivityType;

  @ApiProperty({ type: String, format: 'date-time' })
  lastActivityAt!: Date;
}

export class DsrStateDto {
  @ApiProperty({ format: 'uuid' })
  dsrId!: string;

  @ApiProperty()
  activityCount!: number;

  @ApiProperty()
  stakeholderCount!: number;

  @ApiProperty({ type: String, format: 'date-time' })
  lastActivityAt!: Date;

  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'integer' },
    example: {
      opened: 3,
      zone_viewed: 5,
      briefing_played: 1,
      view: 4,
      download: 1,
      comment: 0,
      terms_accepted: 1,
      terms_rejected: 0,
    },
  })
  activityCounts!: Record<string, number>;

  @ApiProperty({ type: [StakeholderStateDto] })
  stakeholders!: StakeholderStateDto[];
}

export class DsrStatusSummaryDto {
  @ApiProperty()
  activeDsrs!: number;

  @ApiProperty()
  stakeholders!: number;

  @ApiProperty()
  accepted!: number;

  @ApiProperty()
  rejected!: number;

  @ApiProperty({ description: 'Stakeholders without a terms decision' })
  pending!: number;
}

export class DsrStatusDto {
  @ApiProperty({ type: String, format: 'date-time' })
  generatedAt!: Date;

  @ApiProperty({ example: 30 })
  windowDays!: number;

  @ApiProperty({ type: DsrStatusSummaryDto })
  summary!: DsrStatusSummaryDto;

  @ApiProperty({ type: [DsrStateDto], description: 'Most recently active first (at most 100)' })
  dsrs!: DsrStateDto[];
}

export class NexusCommandDto {
  @ApiProperty({ maxLength: 500, example: 'show P&L variance 2026-Q1' })
  command!: string;

  @ApiProperty({ maxLength: 255, example: '/financials', description: 'Route the command bar was opened on' })
  contextRoute!: string;
}

export class NexusCommandContextDto {
  @ApiProperty({ format: 'uuid' })
  tenantId!: string;

  @ApiProperty({ format: 'uuid' })
  userId!: string;

  @ApiProperty({ type: [String] })
  roles!: string[];

  @ApiProperty()
  contextRoute!: string;
}

export class NexusCommandResultDto {
  @ApiProperty({ enum: NEXUS_INTENTS })
  intent!: NexusIntent;

  @ApiProperty({ type: String, nullable: true, example: '/financials?period=2026-Q1' })
  navigateTo!: string | null;

  @ApiProperty({ type: 'object', additionalProperties: { type: 'string' }, example: { period: '2026-Q1' } })
  parameters!: Record<string, string>;

  @ApiProperty({ type: NexusCommandContextDto, description: 'Resolved server-side from the token, never from the client' })
  context!: NexusCommandContextDto;
}

export class UploadVoiceEventDto {
  @ApiProperty({ type: 'string', format: 'binary', description: `Audio clip: ${AUDIO_MIME_TYPES.join(', ')}` })
  file!: unknown;

  @ApiProperty({ maxLength: 255, example: '/dsr' })
  contextRoute!: string;
}

export class VoiceEventDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  tenantId!: string;

  @ApiProperty({ format: 'uuid' })
  userId!: string;

  @ApiProperty()
  contextRoute!: string;

  @ApiProperty({ enum: AUDIO_MIME_TYPES })
  audioMimeType!: string;

  @ApiProperty()
  audioSizeBytes!: number;

  @ApiProperty({ enum: VOICE_EVENT_STATUSES })
  status!: VoiceEventStatus;

  @ApiProperty({ type: String, nullable: true })
  transcriptText!: string | null;

  @ApiProperty({ type: 'object', additionalProperties: true })
  extractedAction!: Record<string, unknown>;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: Date;
}
