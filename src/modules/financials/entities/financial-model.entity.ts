import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export const FINANCIAL_MODEL_STATUSES = ['draft', 'approved', 'archived'] as const;
export type FinancialModelStatus = (typeof FINANCIAL_MODEL_STATUSES)[number];

export function isFinancialModelStatus(value: unknown): value is FinancialModelStatus {
  return FINANCIAL_MODEL_STATUSES.includes(value as FinancialModelStatus);
}

/** RLS-protected: access only through TenantTransaction. */
@Entity({ name: 'financial_models' })
export class FinancialModel {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'model_name', type: 'varchar', length: 100 })
  modelName!: string;

  @Column({ name: 'fiscal_year', type: 'int' })
  fiscalYear!: number;

  @Column({ type: 'varchar', length: 30, default: 'draft' })
  status!: FinancialModelStatus;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  metadata!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz', precision: 3 })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz', precision: 3 })
  updatedAt!: Date;
}
