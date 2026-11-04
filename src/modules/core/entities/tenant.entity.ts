import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/** Vanguard = mid-market edition (seat-capped); Symphony = enterprise edition. Same backend. */
export const LICENSE_TIERS = ['vanguard', 'symphony'] as const;
export type LicenseTier = (typeof LICENSE_TIERS)[number];
export const VANGUARD_DEFAULT_SEATS = 50;

@Entity({ name: 'tenants' })
export class Tenant {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 100 })
  name!: string;

  @Column({ type: 'varchar', length: 150, unique: true })
  domain!: string;

  @Column({ name: 'license_tier', type: 'varchar', length: 20, default: 'symphony' })
  licenseTier!: LicenseTier;

  @Column({ name: 'max_seats', type: 'int', nullable: true })
  maxSeats!: number | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
