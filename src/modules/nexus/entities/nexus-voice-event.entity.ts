import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export const VOICE_EVENT_STATUSES = ['pending', 'processing', 'completed', 'failed'] as const;
export type VoiceEventStatus = (typeof VOICE_EVENT_STATUSES)[number];

/** RLS-protected: access only through TenantTransaction. */
@Entity({ name: 'nexus_voice_events' })
export class NexusVoiceEvent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ name: 'context_route', type: 'varchar', length: 255 })
  contextRoute!: string;

  /** Storage key of the clip, never a public URL. */
  @Column({ name: 'audio_payload_url', type: 'varchar', length: 500 })
  audioPayloadUrl!: string;

  @Column({ name: 'audio_mime_type', type: 'varchar', length: 100 })
  audioMimeType!: string;

  @Column({ name: 'audio_size_bytes', type: 'bigint', transformer: { to: (v: number) => v, from: (v: string) => Number(v) } })
  audioSizeBytes!: number;

  @Column({ type: 'varchar', length: 30, default: 'pending' })
  status!: VoiceEventStatus;

  @Column({ name: 'transcript_text', type: 'text', nullable: true })
  transcriptText!: string | null;

  @Column({ name: 'extracted_action_json', type: 'jsonb', default: () => "'{}'" })
  extractedActionJson!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz', precision: 3 })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz', precision: 3 })
  updatedAt!: Date;
}
