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

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz', precision: 3 })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz', precision: 3 })
  updatedAt!: Date;
}
