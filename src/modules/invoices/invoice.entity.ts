import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export const INVOICE_STATUSES = ['draft', 'issued', 'paid', 'cancelled'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

/** Allowed status changes; paid and cancelled are final. */
export const INVOICE_TRANSITIONS: Record<InvoiceStatus, InvoiceStatus[]> = {
  draft: ['issued', 'cancelled'],
  issued: ['paid', 'cancelled'],
  paid: [],
  cancelled: [],
};

/** RLS-protected (internal only): access only through TenantTransaction. */
@Entity({ name: 'invoices' })
export class Invoice {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'client_id', type: 'uuid' })
  clientId!: string;

  @Column({ name: 'invoice_number', type: 'varchar', length: 50 })
  invoiceNumber!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  description!: string | null;

  @Column({ name: 'issue_date', type: 'date' })
  issueDate!: string;

  @Column({ name: 'due_date', type: 'date', nullable: true })
  dueDate!: string | null;

  @Column({ name: 'amount_excl_vat', type: 'numeric', precision: 14, scale: 2 })
  amountExclVat!: string;

  @Column({ name: 'vat_amount', type: 'numeric', precision: 14, scale: 2, default: 0 })
  vatAmount!: string;

  @Column({ type: 'varchar', length: 20, default: 'draft' })
  status!: InvoiceStatus;

  @Column({ name: 'paid_at', type: 'timestamptz', precision: 3, nullable: true })
  paidAt!: Date | null;

  /** IDMS lifecycle (V28); changed only through /v1/idms transitions and the retention job. */
  @Column({ name: 'idms_status', type: 'varchar', length: 15, default: 'DRAFT', insert: false, update: false })
  idmsStatus!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz', precision: 3 })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz', precision: 3 })
  updatedAt!: Date;
}
