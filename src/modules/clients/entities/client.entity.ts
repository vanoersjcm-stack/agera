import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export const CLIENT_STATUSES = ['active', 'archived'] as const;
export type ClientStatus = (typeof CLIENT_STATUSES)[number];
export const CREDIT_STATUSES = ['approved', 'review_required', 'locked'] as const;
export type CreditStatus = (typeof CREDIT_STATUSES)[number];

export const ENTITY_CATEGORIES = [
  'client', 'vendor_client', 'vendor_non_client', 'vendor_prospect', 'accountant', 'notary', 'lawyer', 'consultant',
  'shareholder', 'bank', 'insurer', 'agent', 'distributor', 'landlord', 'tenant', 'office_outfitter', 'sister_company',
  'subsidiary', 'office_supplier', 'apparel_supplier', 'apparel_printer', 'taxi_company', 'telecom_domain_provider', 'private',
] as const;
export type EntityCategory = (typeof ENTITY_CATEGORIES)[number];
export const ORGANIZATION_TYPES = ['commercial_enterprise', 'sole_proprietor', 'foundation_nonprofit', 'government', 'semi_government'] as const;
export type OrganizationType = (typeof ORGANIZATION_TYPES)[number];
export const COMPANY_SIZES = ['SME', 'Mid-Market', 'Large', 'Enterprise'] as const;
export type CompanySize = (typeof COMPANY_SIZES)[number];

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

  @Column({ name: 'entity_category', type: 'varchar', length: 30, default: 'client' })
  entityCategory!: EntityCategory;

  @Column({ name: 'organization_type', type: 'varchar', length: 30, nullable: true })
  organizationType!: OrganizationType | null;

  @Column({ name: 'company_size', type: 'varchar', length: 20, nullable: true })
  companySize!: CompanySize | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  phone!: string | null;

  /** Private entities are visible only to this user (RLS). */
  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz', precision: 3 })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz', precision: 3 })
  updatedAt!: Date;
}
