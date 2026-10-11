import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export const DSR_STATUSES = ['active', 'archived'] as const;
export type DsrStatusValue = (typeof DSR_STATUSES)[number];

export function isDsrStatus(value: unknown): value is DsrStatusValue {
  return DSR_STATUSES.includes(value as DsrStatusValue);
}

/** RLS-protected: access only through TenantTransaction. */
@Entity({ name: 'digital_sales_rooms' })
export class DigitalSalesRoom {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'client_id', type: 'uuid' })
  clientId!: string;

  @Column({ name: 'agreement_id', type: 'uuid', nullable: true })
  agreementId!: string | null;

  @Column({ name: 'room_name', type: 'varchar', length: 150 })
  roomName!: string;

  @Column({ type: 'varchar', length: 30, default: 'active' })
  status!: DsrStatusValue;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz', precision: 3 })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz', precision: 3 })
  updatedAt!: Date;
}
