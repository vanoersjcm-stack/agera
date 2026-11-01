import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PageMetaDto } from '../../core/http/api-docs.js';
import { STORE_STATUSES, type StoreStatus } from '../entities/store.entity.js';

export class CreateStoreDto {
  @ApiProperty({ maxLength: 50, example: 'MAD-001', description: 'Unique within the tenant' })
  storeCode!: string;

  @ApiProperty({ maxLength: 200, example: 'Madrid Centro' })
  name!: string;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 255, example: 'Calle Mayor 1' })
  address?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 100, example: 'Madrid' })
  city?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 20, example: '28013' })
  postalCode?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 100, default: 'ES' })
  country?: string | null;
}

export class UpdateStoreDto {
  @ApiPropertyOptional({ maxLength: 50 })
  storeCode?: string;

  @ApiPropertyOptional({ maxLength: 200 })
  name?: string;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 255 })
  address?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 100 })
  city?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 20 })
  postalCode?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 100 })
  country?: string | null;

  @ApiPropertyOptional({ enum: STORE_STATUSES })
  status?: StoreStatus;
}

export class StoreDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  tenantId!: string;

  @ApiProperty()
  storeCode!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ type: String, nullable: true })
  address!: string | null;

  @ApiProperty({ type: String, nullable: true })
  city!: string | null;

  @ApiProperty({ type: String, nullable: true })
  postalCode!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'ES' })
  country!: string | null;

  @ApiProperty({ enum: STORE_STATUSES })
  status!: StoreStatus;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: Date;
}

export class StorePageDto extends PageMetaDto {
  @ApiProperty({ type: [StoreDto] })
  items!: StoreDto[];
}
