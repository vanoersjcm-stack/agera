import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';
import type { DealStage } from './deal.entity.js';

@Entity({ name: 'deal_stage_changes' })
export class DealStageChange {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'deal_id', type: 'uuid' })
  dealId!: string;

  @Column({ name: 'from_stage', type: 'varchar', length: 30, nullable: true })
  fromStage!: DealStage | null;

  @Column({ name: 'to_stage', type: 'varchar', length: 30 })
  toStage!: DealStage;

  @Column({ name: 'changed_by', type: 'uuid', nullable: true })
  changedBy!: string | null;

  @CreateDateColumn({ name: 'changed_at', type: 'timestamptz', precision: 3 })
  changedAt!: Date;
}
