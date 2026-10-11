import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { FINANCIAL_CATEGORIES, type FinancialCategory } from '../entities/financial-line-item.entity.js';
import { FINANCIAL_MODEL_STATUSES, type FinancialModelStatus } from '../entities/financial-model.entity.js';

const AMOUNT_DOC = 'Decimal amount (NUMERIC(15,2)), sent as JSON number or string, returned as string';

export class CreateFinancialModelDto {
  @ApiProperty({ maxLength: 100, example: 'FY2026 base case' })
  modelName!: string;

  @ApiProperty({ minimum: 2000, maximum: 2100, example: 2026 })
  fiscalYear!: number;

  @ApiPropertyOptional({ enum: FINANCIAL_MODEL_STATUSES, default: 'draft' })
  status?: FinancialModelStatus;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true, example: { scenario: 'base' } })
  metadata?: Record<string, unknown>;
}

export class UpdateFinancialModelStatusDto {
  @ApiProperty({ enum: FINANCIAL_MODEL_STATUSES })
  status!: FinancialModelStatus;
}

export class FinancialModelDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  tenantId!: string;

  @ApiProperty()
  modelName!: string;

  @ApiProperty({ example: 2026 })
  fiscalYear!: number;

  @ApiProperty({ enum: FINANCIAL_MODEL_STATUSES })
  status!: FinancialModelStatus;

  @ApiProperty({ type: 'object', additionalProperties: true })
  metadata!: Record<string, unknown>;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: Date;
}

export class CreateFinancialLineItemDto {
  @ApiProperty({ enum: FINANCIAL_CATEGORIES })
  category!: FinancialCategory;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 100, example: 'Retail licences' })
  subcategory?: string | null;

  @ApiProperty({ example: '2026-Q1', description: 'YYYY-Qn or YYYY-MM' })
  periodCode!: string;

  @ApiProperty({ type: String, example: '125000.00', description: AMOUNT_DOC })
  projectedAmount!: string;

  @ApiPropertyOptional({ type: String, nullable: true, example: null, description: `${AMOUNT_DOC}; null until actuals are known` })
  actualAmount?: string | null;

  @ApiPropertyOptional({ default: 'EUR', example: 'EUR', description: 'ISO 4217 code' })
  currency?: string;
}

export class UpdateFinancialLineItemDto {
  @ApiPropertyOptional({ type: String, example: '125000.00', description: AMOUNT_DOC })
  projectedAmount?: string;

  @ApiPropertyOptional({ type: String, nullable: true, example: '131250.50', description: `${AMOUNT_DOC}; null clears the actual` })
  actualAmount?: string | null;
}

export class FinancialLineItemDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  tenantId!: string;

  @ApiProperty({ format: 'uuid' })
  modelId!: string;

  @ApiProperty({ enum: FINANCIAL_CATEGORIES })
  category!: FinancialCategory;

  @ApiProperty({ type: String, nullable: true })
  subcategory!: string | null;

  @ApiProperty({ example: '2026-Q1' })
  periodCode!: string;

  @ApiProperty({ example: '125000.00' })
  projectedAmount!: string;

  @ApiProperty({ type: String, nullable: true, example: '131250.50' })
  actualAmount!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '6250.50', description: 'actualAmount - projectedAmount; null without actuals' })
  variance!: string | null;

  @ApiProperty({ example: 'EUR' })
  currency!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: Date;
}

export class PnlAggregateDto {
  @ApiProperty({ type: String, nullable: true, example: '2026-Q1', description: 'null in totals' })
  periodCode!: string | null;

  @ApiProperty({ enum: FINANCIAL_CATEGORIES })
  category!: FinancialCategory;

  @ApiProperty({ example: 'EUR' })
  currency!: string;

  @ApiProperty({ example: 3 })
  lineCount!: number;

  @ApiProperty({ example: '250000.00' })
  projected!: string;

  @ApiProperty({ type: String, nullable: true, example: '262500.00', description: 'null when no line has actuals' })
  actual!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '12500.00',
    description: 'Sum of (actual - projected) over lines that have actuals',
  })
  variance!: string | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    example: 5,
    description: 'variance as % of the projection of the lines that have actuals',
  })
  variancePercent!: number | null;
}

export class PnlFiltersDto {
  @ApiProperty({ type: String, format: 'uuid', nullable: true, description: 'null = all approved models' })
  modelId!: string | null;

  @ApiProperty({ type: Number, nullable: true })
  fiscalYear!: number | null;

  @ApiProperty({ type: String, nullable: true, example: '2026-Q1' })
  period!: string | null;
}

export class PnlDto {
  @ApiProperty({ type: PnlFiltersDto })
  filters!: PnlFiltersDto;

  @ApiProperty({ type: [PnlAggregateDto], description: 'Per period, category and currency' })
  rows!: PnlAggregateDto[];

  @ApiProperty({ type: [PnlAggregateDto], description: 'Per category and currency over the whole selection' })
  totals!: PnlAggregateDto[];
}
