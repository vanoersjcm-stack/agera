import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  type Relation,
  UpdateDateColumn,
} from 'typeorm';
import { Tenant } from '../../core/entities/index.js';
import type { WorkOrderStatus } from './work-order-status.js';

@Entity({ name: 'work_orders' })
export class WorkOrder {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @ManyToOne(() => Tenant, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'tenant_id' })
  tenant?: Relation<Tenant>;

  @Column({ type: 'varchar', length: 255 })
  title!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'varchar', length: 50, default: 'PENDING' })
  status!: WorkOrderStatus;

  @Column({ name: 'assigned_user_id', type: 'uuid', nullable: true })
  assignedUserId!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz', precision: 3 })
  createdAt!: Date;

  /** Maintained by the trg_work_orders_timestamps trigger. */
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz', precision: 3 })
  updatedAt!: Date;

  /** Set/cleared by the trg_work_orders_timestamps trigger when status enters/leaves COMPLETED. */
  @Column({ name: 'completed_at', type: 'timestamptz', precision: 3, nullable: true, insert: false, update: false })
  completedAt!: Date | null;
}
