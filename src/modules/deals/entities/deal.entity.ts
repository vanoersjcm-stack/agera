import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export const DEAL_STAGES = ['lead_ingest', 'proposal_sent', 'contract_negotiation', 'ops_handoff'] as const;
export type DealStage = (typeof DEAL_STAGES)[number];
export const DEAL_PRIORITIES = ['low', 'medium', 'high'] as const;
export type DealPriority = (typeof DEAL_PRIORITIES)[number];

/** RLS-protected (internal only): access only through TenantTransaction. */
@Entity({ name: 'deals' })
export class Deal {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'client_id', type: 'uuid' })
  clientId!: string;

  @Column({ type: 'varchar', length: 200 })
  title!: string;

  @Column({ type: 'numeric', precision: 14, scale: 2, default: 0 })
  value!: string;

  @Column({ type: 'varchar', length: 30, default: 'lead_ingest' })
  stage!: DealStage;

  @Column({ name: 'owner_id', type: 'uuid', nullable: true })
  ownerId!: string | null;

  @Column({ type: 'varchar', length: 10, default: 'medium' })
  priority!: DealPriority;

  @Column({ name: 'client_room_id', type: 'uuid', nullable: true })
  clientRoomId!: string | null;

  @Column({ name: 'due_date', type: 'date', nullable: true })
  dueDate!: string | null;

  @Column({ type: 'text', nullable: true })
  notes!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz', precision: 3 })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz', precision: 3 })
  updatedAt!: Date;
}
