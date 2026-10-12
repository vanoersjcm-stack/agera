import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AGREEMENT_STATUSES, type AgreementStatus } from '../entities/agreement.entity.js';
import { DSR_STATUSES, type DsrStatusValue } from '../entities/digital-sales-room.entity.js';

export const ANOMALY_TYPES = ['financial_variance', 'dsr_stagnation', 'store_compliance'] as const;
export type AnomalyType = (typeof ANOMALY_TYPES)[number];

export class CreateAgreementDto {
  @ApiProperty({ format: 'uuid', description: 'External client (client_id claim of its users)' })
  clientId!: string;

  @ApiProperty({ maxLength: 200, example: 'Shelf placement 2026' })
  title!: string;

  @ApiProperty({ maxLength: 500, example: 'https://symphony.example.lan/docs/agreement-2026.pdf' })
  documentUrl!: string;

  @ApiPropertyOptional({ enum: AGREEMENT_STATUSES, default: 'pending_approval' })
  status?: AgreementStatus;
}

export class UpdateAgreementStatusDto {
  @ApiProperty({ enum: AGREEMENT_STATUSES })
  status!: AgreementStatus;
}

export class AgreementDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) tenantId!: string;
  @ApiProperty({ format: 'uuid' }) clientId!: string;
  @ApiProperty() title!: string;
  @ApiProperty({ enum: AGREEMENT_STATUSES }) status!: AgreementStatus;
  @ApiProperty() documentUrl!: string;
  @ApiProperty({ format: 'date-time' }) createdAt!: Date;
  @ApiProperty({ format: 'date-time' }) updatedAt!: Date;
}

export class CreateDsrDto {
  @ApiProperty({ format: 'uuid' })
  clientId!: string;

  @ApiProperty({ maxLength: 150, example: 'Retailer X - spring range' })
  roomName!: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true, description: 'Agreement of the same client' })
  agreementId?: string | null;
}

export class UpdateDsrStatusDto {
  @ApiProperty({ enum: DSR_STATUSES })
  status!: DsrStatusValue;
}

export class DigitalSalesRoomDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) tenantId!: string;
  @ApiProperty({ format: 'uuid' }) clientId!: string;
  @ApiProperty({ format: 'uuid', nullable: true, type: String }) agreementId!: string | null;
  @ApiProperty() roomName!: string;
  @ApiProperty({ enum: DSR_STATUSES }) status!: DsrStatusValue;
  @ApiProperty({ format: 'date-time' }) createdAt!: Date;
  @ApiProperty({ format: 'date-time' }) updatedAt!: Date;
}

export class AnomalyDto {
  @ApiProperty({ enum: ANOMALY_TYPES }) anomalyType!: AnomalyType;
  @ApiProperty({ format: 'uuid', description: 'financial_line_items.id, digital_sales_rooms.id or stores.id' }) sourceId!: string;
  @ApiProperty({ example: 'P&L variance exceeded 10%: revenue 2026-01 -150.00 EUR (-15.0%)' }) description!: string;
  @ApiProperty({ format: 'date-time', description: 'Last change of the line, or last stakeholder interaction' })
  observedAt!: Date;
  @ApiProperty({ type: 'object', additionalProperties: true }) details!: Record<string, unknown>;
  @ApiProperty({ format: 'date-time' }) createdAt!: Date;
}

export class AnomaliesDto {
  @ApiProperty({ format: 'date-time' }) generatedAt!: Date;
  @ApiProperty({ type: [AnomalyDto] }) anomalies!: AnomalyDto[];
}
