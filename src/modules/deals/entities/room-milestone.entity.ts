import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export const MILESTONE_OWNER_SIDES = ['internal', 'client'] as const;
export type MilestoneOwnerSide = (typeof MILESTONE_OWNER_SIDES)[number];

/** Mutual action plan step in a client room. RLS: client contacts read their rooms and complete client-side steps. */
@Entity({ name: 'client_room_milestones' })
export class RoomMilestone {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'client_room_id', type: 'uuid' })
  clientRoomId!: string;

  @Column({ type: 'varchar', length: 200 })
  title!: string;

  @Column({ name: 'owner_side', type: 'varchar', length: 10, default: 'internal' })
  ownerSide!: MilestoneOwnerSide;

  @Column({ name: 'due_date', type: 'date', nullable: true })
  dueDate!: string | null;

  @Column({ type: 'boolean', default: false })
  completed!: boolean;

  @Column({ name: 'completed_at', type: 'timestamptz', precision: 3, nullable: true })
  completedAt!: Date | null;

  @Column({ name: 'completed_by', type: 'uuid', nullable: true })
  completedBy!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz', precision: 3 })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz', precision: 3 })
  updatedAt!: Date;
}
