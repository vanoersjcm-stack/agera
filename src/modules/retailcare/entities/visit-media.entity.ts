import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';
import type { ImageMimeType } from '../media/image-type.js';

@Entity({ name: 'visit_media' })
export class VisitMedia {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'visit_id', type: 'uuid' })
  visitId!: string;

  /** Relative to the upload root: `<tenantId>/<visitId>/<mediaId>.<ext>`. */
  @Column({ name: 'file_path', type: 'varchar', length: 500 })
  filePath!: string;

  @Column({ name: 'mime_type', type: 'varchar', length: 100 })
  mimeType!: ImageMimeType;

  @Column({
    name: 'file_size_bytes',
    type: 'bigint',
    transformer: { to: (value: number) => value, from: (value: string) => Number(value) },
  })
  fileSizeBytes!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz', precision: 3 })
  createdAt!: Date;
}
