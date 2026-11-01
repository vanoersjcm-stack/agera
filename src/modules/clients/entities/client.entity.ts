import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export const CLIENT_STATUSES = ['active', 'archived'] as const;
export type ClientStatus = (typeof CLIENT_STATUSES)[number];
export const CREDIT_STATUSES = ['approved', 'review_required', 'locked'] as const;
export type CreditStatus = (typeof CREDIT_STATUSES)[number];

/** RLS-protected: access only through TenantTransaction. */
@Entity({ name: 'clients' })
export class Client {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'varchar', length: 200 })
  name!: string;

  @Column({ name: 'legal_name', type: 'varchar', length: 200, nullable: true })
  legalName!: string | null;

  @Column({ name: 'vat_number', type: 'varchar', length: 50, nullable: true })
  vatNumber!: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  city!: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  country!: string | null;

  @Column({ type: 'varchar', length: 20, default: 'active' })
  status!: ClientStatus;

  @Column({ name: 'kvk_number', type: 'varchar', length: 20, nullable: true })
  kvkNumber!: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  sector!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  address!: string | null;

  @Column({ name: 'payment_terms', type: 'varchar', length: 100, default: 'Net 30 days' })
  paymentTerms!: string;

  @Column({ name: 'credit_limit', type: 'numeric', precision: 14, scale: 2, default: 0 })
  creditLimit!: string;

  @Column({ name: 'credit_status', type: 'varchar', length: 20, default: 'approved' })
  creditStatus!: CreditStatus;

  @Column({ name: 'erp_id', type: 'varchar', length: 50, nullable: true })
  erpId!: string | null;

  @Column({ name: 'account_manager_id', type: 'uuid', nullable: true })
  accountManagerId!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz', precision: 3 })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz', precision: 3 })
  updatedAt!: Date;
}
