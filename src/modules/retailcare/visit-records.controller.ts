import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  StreamableFile,
  UploadedFile,
  UseFilters,
  UseInterceptors,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import { AllowApiKey } from '../auth/allow-api-key.decorator.js';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { ApiErrors, BEARER_AUTH } from '../core/http/api-docs.js';
import { asObject, optionalString } from '../core/http/validation.js';
import {
  MAX_SUMMARY_LENGTH,
  SaveVisitReportDto,
  UploadVisitMediaDto,
  VisitMediaDto,
  VisitReportDto,
  VisitSummaryDto,
} from './dto/visit-record.dto.js';
import type { VisitMedia } from './entities/visit-media.entity.js';
import type { VisitReport } from './entities/visit-report.entity.js';
import {
  IMAGE_EXTENSIONS,
  IMAGE_MIME_TYPES,
  MAX_UPLOAD_BYTES,
  detectImageMimeType,
  isImageMimeType,
} from './media/image-type.js';
import { UploadExceptionFilter } from './media/upload-exception.filter.js';
import { type SaveReportInput, VisitRecordsService } from './visit-records.service.js';
import { toVisitResponse } from './visits.controller.js';

/** Subset of the multer file object (multer keeps uploads in memory when no storage is configured). */
interface UploadedImage {
  mimetype: string;
  size: number;
  buffer: Buffer;
}

export function toReportResponse(report: VisitReport): VisitReportDto {
  return {
    id: report.id,
    tenantId: report.tenantId,
    visitId: report.visitId,
    summary: report.summary ?? null,
    auditData: report.auditData,
    createdAt: report.createdAt,
    updatedAt: report.updatedAt,
  };
}

export function toMediaResponse(media: VisitMedia, apiPrefix = ''): VisitMediaDto {
  return {
    id: media.id,
    visitId: media.visitId,
    mimeType: media.mimeType,
    fileSizeBytes: media.fileSizeBytes,
    url: `${apiPrefix ? `/${apiPrefix}` : ''}/visits/${media.visitId}/media/${media.id}`,
    createdAt: media.createdAt,
  };
}

function parseSaveReport(body: unknown): SaveReportInput {
  const { summary, auditData } = asObject(body);
  if (auditData !== undefined && (auditData === null || typeof auditData !== 'object' || Array.isArray(auditData))) {
    throw new BadRequestException('auditData must be a JSON object');
  }
  const data = { ...((auditData as Record<string, unknown> | undefined) ?? {}) };
  if (data.outOfStockItems !== undefined) {
    const raw = data.outOfStockItems;
    if (!Array.isArray(raw) || raw.length > 50 || raw.some((i) => typeof i !== 'string' || i.trim() === '' || i.length > 150)) {
      throw new BadRequestException('auditData.outOfStockItems must be a list of up to 50 product names (max 150 characters each)');
    }
    data.outOfStockItems = [...new Set(raw.map((i: string) => i.trim()))];
  }
  if (data.planogramChecks !== undefined) {
    const raw = data.planogramChecks;
    const ok = (n: unknown, min: number) => typeof n === 'number' && Number.isInteger(n) && n >= min && n <= 999;
    if (
      !Array.isArray(raw) ||
      raw.length > 200 ||
      raw.some((c) => !c || typeof c !== 'object' || typeof c.productId !== 'string' || !ok(c.expectedFacings, 1) || !ok(c.actualFacings, 0))
    ) {
      throw new BadRequestException('auditData.planogramChecks must be a list of {productId, expectedFacings ≥ 1, actualFacings ≥ 0}');
    }
    const checks = raw as { expectedFacings: number; actualFacings: number }[];
    const expected = checks.reduce((s, c) => s + c.expectedFacings, 0);
    const matched = checks.reduce((s, c) => s + Math.min(c.actualFacings, c.expectedFacings), 0);
    data.planogramScore = expected > 0 ? Math.round((matched / expected) * 100) : null;
  }
  return {
    summary: optionalString('summary', summary, MAX_SUMMARY_LENGTH),
    auditData: data,
  };
}

@ApiTags('visits')
@ApiBearerAuth(BEARER_AUTH)
@ApiErrors(401, 403)
@Controller('visits/:id')
export class VisitRecordsController {
  private readonly apiPrefix: string;

  constructor(
    private readonly records: VisitRecordsService,
    config: ConfigService,
  ) {
    this.apiPrefix = config.get<string>('apiPrefix') ?? '';
  }

  @Post('report')
  @ApiOperation({
    summary: 'Create or replace the report of a visit (audit: visit.report_saved)',
    description: 'One report per visit; the whole report is replaced. Returns 201 when created, 200 when replaced.',
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'Visit id' })
  @ApiBody({ type: SaveVisitReportDto })
  @ApiCreatedResponse({ type: VisitReportDto, description: 'Report created' })
  @ApiOkResponse({ type: VisitReportDto, description: 'Report replaced' })
  @ApiErrors(400, 404, 409)
  async saveReport(
    @Param('id', ParseUUIDPipe) visitId: string,
    @Body() body: unknown,
    @CurrentUser() identity: AuthenticatedUser,
    @Res({ passthrough: true }) response: { status(code: number): unknown },
  ): Promise<VisitReportDto> {
    const { report, created, replenishmentRoomId } = await this.records.saveReport(visitId, parseSaveReport(body), identity);
    response.status(created ? 201 : 200);
    return replenishmentRoomId ? { ...toReportResponse(report), replenishmentRoomId } : toReportResponse(report);
  }

  @Post('media')
  @UseFilters(UploadExceptionFilter)
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 10 } }),
  )
  @ApiOperation({
    summary: 'Upload a photo for a visit (audit: visit.media_uploaded)',
    description: `multipart/form-data with one \`file\` part: ${IMAGE_MIME_TYPES.join(', ')}, at most ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB.`,
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'Visit id' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ type: UploadVisitMediaDto })
  @ApiCreatedResponse({ type: VisitMediaDto })
  @ApiErrors(400, 404, 409)
  async uploadMedia(
    @Param('id', ParseUUIDPipe) visitId: string,
    @UploadedFile() file: UploadedImage | undefined,
    @CurrentUser() identity: AuthenticatedUser,
  ): Promise<VisitMediaDto> {
    if (!file || file.size === 0) {
      throw new BadRequestException('file is required');
    }
    const detected = detectImageMimeType(file.buffer);
    if (!isImageMimeType(file.mimetype) || detected === null) {
      throw new BadRequestException(`file must be one of ${IMAGE_MIME_TYPES.join(', ')}`);
    }
    return toMediaResponse(
      await this.records.addMedia(visitId, { data: file.buffer, mimeType: detected }, identity),
      this.apiPrefix,
    );
  }

  @Get('media/:mediaId')
  @AllowApiKey()
  @Header('X-Content-Type-Options', 'nosniff')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'Download a visit photo' })
  @ApiParam({ name: 'id', format: 'uuid', description: 'Visit id' })
  @ApiParam({ name: 'mediaId', format: 'uuid' })
  @ApiProduces(...IMAGE_MIME_TYPES)
  @ApiOkResponse({ description: 'The image', schema: { type: 'string', format: 'binary' } })
  @ApiErrors(400, 404)
  async downloadMedia(
    @Param('id', ParseUUIDPipe) visitId: string,
    @Param('mediaId', ParseUUIDPipe) mediaId: string,
  ): Promise<StreamableFile> {
    const { media, stream } = await this.records.openMedia(visitId, mediaId);
    return new StreamableFile(stream, {
      type: media.mimeType,
      length: media.fileSizeBytes,
      disposition: `inline; filename="${media.id}.${IMAGE_EXTENSIONS[media.mimeType]}"`,
    });
  }

  @Delete('media/:mediaId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a visit photo and its file (audit: visit.media_deleted)' })
  @ApiParam({ name: 'id', format: 'uuid', description: 'Visit id' })
  @ApiParam({ name: 'mediaId', format: 'uuid' })
  @ApiNoContentResponse({ description: 'Deleted' })
  @ApiErrors(400, 404)
  async deleteMedia(
    @Param('id', ParseUUIDPipe) visitId: string,
    @Param('mediaId', ParseUUIDPipe) mediaId: string,
    @CurrentUser() identity: AuthenticatedUser,
  ): Promise<void> {
    await this.records.deleteMedia(visitId, mediaId, identity);
  }

  @Get('summary')
  @AllowApiKey()
  @ApiOperation({ summary: 'Visit with its report and media references in one payload' })
  @ApiParam({ name: 'id', format: 'uuid', description: 'Visit id' })
  @ApiOkResponse({ type: VisitSummaryDto })
  @ApiErrors(400, 404)
  async summary(@Param('id', ParseUUIDPipe) visitId: string): Promise<VisitSummaryDto> {
    const { visit, report, media } = await this.records.summary(visitId);
    return {
      visit: toVisitResponse(visit),
      report: report ? toReportResponse(report) : null,
      media: media.map((item) => toMediaResponse(item, this.apiPrefix)),
    };
  }
}
