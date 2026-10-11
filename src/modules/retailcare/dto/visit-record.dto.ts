import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IMAGE_MIME_TYPES, type ImageMimeType, MAX_UPLOAD_BYTES } from '../media/image-type.js';
import { VisitDto } from './visit.dto.js';

export const MAX_SUMMARY_LENGTH = 20_000;

export class SaveVisitReportDto {
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: MAX_SUMMARY_LENGTH, example: 'Shelf restocked' })
  summary?: string | null;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    description: 'Free-form questionnaire / shelf-audit answers (JSON object, stored as-is). Defaults to {}.',
    example: { facings: 12, priceTagsOk: true, outOfStock: ['SKU-123'] },
  })
  auditData?: Record<string, unknown>;
}

export class VisitReportDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  tenantId!: string;

  @ApiProperty({ format: 'uuid' })
  visitId!: string;

  @ApiProperty({ type: String, nullable: true })
  summary!: string | null;

  @ApiProperty({ type: 'object', additionalProperties: true })
  auditData!: Record<string, unknown>;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: Date;
}

export class UploadVisitMediaDto {
  @ApiProperty({
    type: 'string',
    format: 'binary',
    description: `JPEG, PNG or WebP image, at most ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB (type checked from file content)`,
  })
  file!: unknown;
}

export class VisitMediaDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  visitId!: string;

  @ApiProperty({ enum: IMAGE_MIME_TYPES, enumName: 'ImageMimeType' })
  mimeType!: ImageMimeType;

  @ApiProperty({ example: 48213 })
  fileSizeBytes!: number;

  @ApiProperty({ example: '/visits/5f0c…/media/9a1e…', description: 'Download path, including the API prefix if one is configured (requires the bearer token or an API key)' })
  url!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;
}

export class VisitSummaryDto {
  @ApiProperty({ type: VisitDto })
  visit!: VisitDto;

  @ApiProperty({ type: VisitReportDto, nullable: true })
  report!: VisitReportDto | null;

  @ApiProperty({ type: [VisitMediaDto], description: 'Oldest first' })
  media!: VisitMediaDto[];
}
