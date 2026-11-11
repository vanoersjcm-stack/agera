import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOkResponse, ApiOperation, ApiParam, ApiProperty, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { IDMS_STATUSES, type IdmsStatus } from '../core/idms/idms.js';
import { ApiErrors, BEARER_AUTH } from '../core/http/api-docs.js';
import { asObject, oneOf } from '../core/http/validation.js';
import {
  DOCUMENT_CLASSES,
  ERASURE_MODES,
  IDMS_KINDS,
  IdmsService,
  type IdmsTransitionView,
  type RetentionPolicyView,
  type RetentionRunResult,
} from './idms.service.js';

class IdmsTransitionDto {
  @ApiProperty({ enum: IDMS_STATUSES, description: 'Must be the next status: DRAFT → IN_REVIEW → FINAL_LOCKED → ARCHIVED_WORM' }) to!: IdmsStatus;
}

class RetentionPolicyInputDto {
  @ApiProperty({ minimum: 1, maximum: 100, example: 7 }) wormRetentionYears!: number;
  @ApiProperty({ type: Number, nullable: true, minimum: 1, description: 'Visit reports and survey responses: erase personal data after this many days; null = off' })
  autoPurgeDays!: number | null;
  @ApiProperty({ enum: ERASURE_MODES }) erasureMode!: string;
}

function integer(name: string, raw: unknown, min: number, max: number): number {
  const n = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < min || n > max) {
    throw new BadRequestException(`${name} must be a whole number from ${min} to ${max}`);
  }
  return n;
}

@ApiTags('IDMS lifecycle')
@ApiBearerAuth(BEARER_AUTH)
@Controller('v1/idms')
export class IdmsController {
  constructor(private readonly idms: IdmsService) {}

  @Post(':kind/:id/transition')
  @ApiOperation({
    summary: 'Move a record one step forward in the IDMS lifecycle (audit: idms.transitioned)',
    description: 'kind: documents | agreements | financial_models | invoices. FINAL_LOCKED and ARCHIVED_WORM freeze the content (403 on edits). EXPIRED_PURGE is set by the retention job only.',
  })
  @ApiParam({ name: 'kind', enum: IDMS_KINDS })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody({ type: IdmsTransitionDto })
  @ApiErrors(400, 403, 404, 409)
  transition(@Param('kind') kind: string, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @CurrentUser() identity: AuthenticatedUser): Promise<IdmsTransitionView> {
    return this.idms.transition(oneOf('kind', kind, IDMS_KINDS), id, oneOf('to', asObject(body).to, IDMS_STATUSES), identity);
  }
}

/** Retention & erasure policies (Symphony): HQ admins change them; account managers may read them. */
@ApiTags('IDMS lifecycle')
@ApiBearerAuth(BEARER_AUTH)
@Controller('v1/idms')
export class RetentionController {
  constructor(private readonly idms: IdmsService) {}

  @Get('retention-policies')
  @ApiOperation({ summary: 'Retention policy per document class of this organisation' })
  @ApiOkResponse()
  policies(): Promise<RetentionPolicyView[]> {
    return this.idms.policies();
  }

  @Put('retention-policies/:documentClass')
  @ApiOperation({ summary: 'Change a retention policy (audit: retention_policy.updated)' })
  @ApiParam({ name: 'documentClass', enum: DOCUMENT_CLASSES })
  @ApiBody({ type: RetentionPolicyInputDto })
  @ApiErrors(400, 403)
  update(@Param('documentClass') documentClass: string, @Body() body: unknown, @CurrentUser() identity: AuthenticatedUser): Promise<RetentionPolicyView> {
    const raw = asObject(body);
    return this.idms.updatePolicy(
      oneOf('documentClass', documentClass, DOCUMENT_CLASSES),
      {
        wormRetentionYears: integer('wormRetentionYears', raw.wormRetentionYears, 1, 100),
        autoPurgeDays: raw.autoPurgeDays === null || raw.autoPurgeDays === undefined || raw.autoPurgeDays === '' ? null : integer('autoPurgeDays', raw.autoPurgeDays, 1, 36500),
        erasureMode: oneOf('erasureMode', raw.erasureMode ?? 'pseudonymize', ERASURE_MODES),
      },
      identity,
    );
  }

  @Post('retention/run')
  @ApiOperation({ summary: 'Run the retention / erasure job now for this organisation (audit: idms.purged per record)' })
  @ApiErrors(403)
  run(): Promise<RetentionRunResult> {
    return this.idms.runNow();
  }
}
