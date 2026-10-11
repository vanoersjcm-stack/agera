import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

export const DSR_ACTIVITY_TYPES = [
  'opened',
  'zone_viewed',
  'briefing_played',
  'view',
  'download',
  'comment',
  'terms_accepted',
  'terms_rejected',
] as const;
export type DsrActivityType = (typeof DSR_ACTIVITY_TYPES)[number];

export function isDsrActivityType(value: unknown): value is DsrActivityType {
  return DSR_ACTIVITY_TYPES.includes(value as DsrActivityType);
}

/** RLS-protected: access only through TenantTransaction. */
@Entity({ name: 'dsr_activities' })
export class DsrActivity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'dsr_id', type: 'uuid' })
  dsrId!: string;

  @Column({ name: 'stakeholder_email', type: 'varchar', length: 255 })
  stakeholderEmail!: string;

  @Column({ name: 'activity_type', type: 'varchar', length: 50 })
  activityType!: DsrActivityType;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  details!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz', precision: 3 })
  createdAt!: Date;
}
