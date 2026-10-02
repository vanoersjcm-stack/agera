import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PageMetaDto } from '../../core/http/api-docs.js';

export class CreateApiKeyDto {
  @ApiProperty({ maxLength: 100, example: 'Portal Production Key' })
  name!: string;

  @ApiPropertyOptional({ format: 'uuid', description: "Tenant the key grants access to; defaults to the caller's tenant" })
  tenantId?: string;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true, description: 'Must be in the future; null = no expiry' })
  expiresAt?: string | null;
}

export class ApiKeyDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  tenantId!: string;

  @ApiProperty({ example: 'Portal Production Key' })
  name!: string;

  @ApiProperty({ example: 'agk_3fQx9Lm2', description: 'First characters of the key, for recognition only' })
  keyPrefix!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  expiresAt!: Date | null;
}

export class CreatedApiKeyDto extends ApiKeyDto {
  @ApiProperty({
    example: 'agk_3fQx9Lm2…',
    description: 'The secret for the X-API-Key header. Returned only once; store it securely.',
  })
  key!: string;
}

export class ApiKeyPageDto extends PageMetaDto {
  @ApiProperty({ type: [ApiKeyDto] })
  items!: ApiKeyDto[];
}
