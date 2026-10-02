import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'api_keys' })
export class ApiKey {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'varchar', length: 100 })
  name!: string;

  @Column({ name: 'key_prefix', type: 'varchar', length: 16 })
  keyPrefix!: string;

  /** SHA-256 (hex) of the full key. */
  @Column({ name: 'key_hash', type: 'varchar', length: 255 })
  keyHash!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz', precision: 3 })
  createdAt!: Date;

  @Column({ name: 'expires_at', type: 'timestamptz', precision: 3, nullable: true })
  expiresAt!: Date | null;
}
