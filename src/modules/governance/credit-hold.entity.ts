import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** Emergency credit lock. client_id null = organisation-wide hold. RLS: internal only. */
@Entity({ name: 'credit_holds' })
export class CreditHold {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'client_id', type: 'uuid', nullable: true })
  clientId!: string | null;

  @Column({ type: 'text' })
  reason!: string;

  @Column({ name: 'set_by', type: 'uuid', nullable: true })
  setBy!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz', precision: 3 })
  createdAt!: Date;

  @Column({ name: 'released_at', type: 'timestamptz', precision: 3, nullable: true })
  releasedAt!: Date | null;

  @Column({ name: 'released_by', type: 'uuid', nullable: true })
  releasedBy!: string | null;
}
