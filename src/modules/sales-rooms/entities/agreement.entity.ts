import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export const AGREEMENT_STATUSES = ['pending_approval', 'active', 'expired'] as const;
export type AgreementStatus = (typeof AGREEMENT_STATUSES)[number];

export function isAgreementStatus(value: unknown): value is AgreementStatus {
  return AGREEMENT_STATUSES.includes(value as AgreementStatus);
}

/** RLS-protected: access only through TenantTransaction. */
@Entity({ name: 'agreements' })
export class Agreement {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'client_id', type: 'uuid' })
  clientId!: string;

  @Column({ type: 'varchar', length: 200 })
  title!: string;

  @Column({ type: 'varchar', length: 30, default: 'pending_approval' })
  status!: AgreementStatus;

  @Column({ name: 'document_url', type: 'varchar', length: 500 })
  documentUrl!: string;

  @Column({ name: 'annual_value', type: 'numeric', precision: 14, scale: 2, default: 0 })
  annualValue!: string;

  @Column({ name: 'churn_risk', type: 'numeric', precision: 14, scale: 2, default: 0 })
  churnRisk!: string;

  @Column({ name: 'end_date', type: 'date', nullable: true })
  endDate!: string | null;

  /** IDMS lifecycle (V28); changed only through /v1/idms transitions and the retention job. */
  @Column({ name: 'idms_status', type: 'varchar', length: 15, default: 'DRAFT', insert: false, update: false })
  idmsStatus!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz', precision: 3 })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz', precision: 3 })
  updatedAt!: Date;
}
