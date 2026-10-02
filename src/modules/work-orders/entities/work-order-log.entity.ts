import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';
import type { WorkOrderStatus } from './work-order-status.js';

@Entity({ name: 'work_order_logs' })
export class WorkOrderLog {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'work_order_id', type: 'uuid' })
  workOrderId!: string;

  @Column({ name: 'previous_status', type: 'varchar', length: 50, nullable: true })
  previousStatus!: WorkOrderStatus | null;

  @Column({ name: 'new_status', type: 'varchar', length: 50 })
  newStatus!: WorkOrderStatus;

  @Column({ name: 'changed_by_user_id', type: 'uuid' })
  changedByUserId!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz', precision: 3 })
  createdAt!: Date;
}
