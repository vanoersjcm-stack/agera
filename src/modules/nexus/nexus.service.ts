import { randomUUID } from 'node:crypto';
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, type Repository } from 'typeorm';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { AuditService } from '../core/audit/audit.service.js';
import { StorageService } from '../core/storage/storage.service.js';
import { TenantContext } from '../core/tenancy/tenant-context.service.js';
import { TenantRepository } from '../core/tenancy/tenant-repository.js';
import { TenantTransaction } from '../core/tenancy/tenant-transaction.service.js';
import { UserService } from '../user/user.service.js';
import { AUDIO_EXTENSIONS, type AudioMimeType } from './audio-type.js';
import { type ParsedCommand, parseCommand } from './command-intents.js';
import { DSR_ACTIVITY_TYPES, DsrActivity, type DsrActivityType } from './entities/dsr-activity.entity.js';
import { NexusVoiceEvent } from './entities/nexus-voice-event.entity.js';

export const MAX_ACTIVE_DSRS = 100;
const PG_RLS_VIOLATION = '42501';

export interface RecordActivityInput {
  dsrId: string;
  stakeholderEmail: string;
  activityType: DsrActivityType;
  details: Record<string, unknown>;
}

export type StakeholderStatus = 'accepted' | 'rejected' | 'engaged';

export interface StakeholderState {
  email: string;
  status: StakeholderStatus;
  activityCount: number;
  lastActivityType: DsrActivityType;
  lastActivityAt: Date;
}

export interface DsrState {
  dsrId: string;
  activityCount: number;
  stakeholderCount: number;
  lastActivityAt: Date;
  activityCounts: Record<DsrActivityType, number>;
  stakeholders: StakeholderState[];
}

export interface DsrStatus {
  generatedAt: Date;
  windowDays: number;
  summary: {
    activeDsrs: number;
    stakeholders: number;
    accepted: number;
    rejected: number;
    pending: number;
  };
  dsrs: DsrState[];
}

export interface CommandInput {
  command: string;
  contextRoute: string;
}

export interface CommandResult extends ParsedCommand {
  context: { tenantId: string; userId: string; roles: string[]; contextRoute: string };
}

interface StakeholderRow {
  dsrId: string;
  email: string;
  activityCount: number;
  lastActivityAt: Date;
  lastActivityType: DsrActivityType;
  termsDecision: DsrActivityType | null;
  counts: Record<DsrActivityType, number>;
}

@Injectable()
export class NexusService {
  private readonly activities: TenantRepository<DsrActivity>;
  private readonly voiceEvents: TenantRepository<NexusVoiceEvent>;

  constructor(
    @InjectRepository(DsrActivity) activities: Repository<DsrActivity>,
    @InjectRepository(NexusVoiceEvent) voiceEvents: Repository<NexusVoiceEvent>,
    private readonly context: TenantContext,
    private readonly tx: TenantTransaction,
    private readonly storage: StorageService,
    private readonly userService: UserService,
    private readonly audit: AuditService,
  ) {
    this.activities = new TenantRepository(activities, context);
    this.voiceEvents = new TenantRepository(voiceEvents, context);
  }

  /** Newest first. Row-level security limits client users to activities in their own rooms. */
  listActivities(dsrId: string, limit: number): Promise<DsrActivity[]> {
    return this.tx.run((manager) =>
      this.activities.withManager(manager).find({ where: { dsrId }, order: { createdAt: 'DESC', id: 'DESC' }, take: limit }),
    );
  }

  async recordActivity(input: RecordActivityInput, identity: AuthenticatedUser): Promise<DsrActivity> {
    const actor = await this.userService.resolveActor(identity);
    const external = this.context.tenant.access.scope === 'external';
    const values = external ? { ...input, stakeholderEmail: identity.email } : input;
    let activity: DsrActivity;
    try {
      activity = await this.tx.run(async (manager) => {
        const repository = this.activities.withManager(manager);
        const saved = await repository.save(repository.create(values));
        const reloaded = await repository.findOneBy({ id: saved.id });
        if (!reloaded) {
          throw new NotFoundException('DSR activity not found');
        }
        return reloaded;
      });
    } catch (error) {
      if (external && error instanceof QueryFailedError && (error.driverError as { code?: string }).code === PG_RLS_VIOLATION) {
        throw new NotFoundException('Digital Sales Room not found');
      }
      throw error;
    }
    this.audit.logAction(this.context.tenantId, actor.id, 'dsr.activity_recorded', {
      dsrId: activity.dsrId,
      activityId: activity.id,
      activityType: activity.activityType,
    });
    return activity;
  }

  /** DSRs with activity in the last `windowDays` days, with every stakeholder's latest state. */
  dsrStatus(windowDays: number, dsrId: string | null): Promise<DsrStatus> {
    return this.tx.run(async (manager) => {
      const params: unknown[] = [this.context.tenantId, windowDays, MAX_ACTIVE_DSRS];
      const dsrFilter = dsrId === null ? '' : `AND dsr_id = $${params.push(dsrId)}`;
      const countColumns = DSR_ACTIVITY_TYPES.map(
        (type) => `'${type}', COUNT(*) FILTER (WHERE a.activity_type = '${type}')`,
      ).join(', ');
      const rows: StakeholderRow[] = await manager.query(
        `WITH active AS (
           SELECT dsr_id, MAX(created_at) AS last_at
             FROM dsr_activities
            WHERE tenant_id = $1 ${dsrFilter}
            GROUP BY dsr_id
           HAVING MAX(created_at) >= NOW() - make_interval(days => $2::int)
            ORDER BY last_at DESC
            LIMIT $3
         )
         SELECT a.dsr_id AS "dsrId",
                a.stakeholder_email AS email,
                COUNT(*)::int AS "activityCount",
                MAX(a.created_at) AS "lastActivityAt",
                (array_agg(a.activity_type ORDER BY a.created_at DESC, a.id DESC))[1] AS "lastActivityType",
                (array_agg(a.activity_type ORDER BY a.created_at DESC, a.id DESC)
                   FILTER (WHERE a.activity_type IN ('terms_accepted', 'terms_rejected')))[1] AS "termsDecision",
                jsonb_build_object(${countColumns}) AS counts
           FROM dsr_activities a
           JOIN active ON active.dsr_id = a.dsr_id
          WHERE a.tenant_id = $1
          GROUP BY a.dsr_id, a.stakeholder_email, active.last_at
          ORDER BY active.last_at DESC, a.dsr_id, MAX(a.created_at) DESC`,
        params,
      );
      return buildDsrStatus(rows, windowDays);
    });
  }

  async command(input: CommandInput, identity: AuthenticatedUser): Promise<CommandResult> {
    const actor = await this.userService.resolveActor(identity);
    const parsed = parseCommand(input.command);
    this.audit.logAction(this.context.tenantId, actor.id, 'nexus.command', {
      command: input.command,
      contextRoute: input.contextRoute,
      intent: parsed.intent,
    });
    return {
      ...parsed,
      context: {
        tenantId: this.context.tenantId,
        userId: actor.id,
        roles: identity.roles,
        contextRoute: input.contextRoute,
      },
    };
  }

  async addVoiceEvent(
    contextRoute: string,
    audio: { data: Buffer; mimeType: AudioMimeType },
    identity: AuthenticatedUser,
  ): Promise<NexusVoiceEvent> {
    const actor = await this.userService.resolveActor(identity);
    const id = randomUUID();
    const key = `${this.context.tenantId}/voice/${id}.${AUDIO_EXTENSIONS[audio.mimeType]}`;
    await this.storage.put(key, audio.data);
    try {
      const event = await this.tx.run(async (manager) => {
        const repository = this.voiceEvents.withManager(manager);
        await repository.save(
          repository.create({
            id,
            userId: actor.id,
            contextRoute,
            audioPayloadUrl: key,
            audioMimeType: audio.mimeType,
            audioSizeBytes: audio.data.length,
          }),
        );
        const saved = await repository.findOneBy({ id });
        if (!saved) {
          throw new NotFoundException('Voice event not found');
        }
        return saved;
      });
      this.audit.logAction(this.context.tenantId, actor.id, 'nexus.voice_event_queued', {
        voiceEventId: id,
        contextRoute,
        audioMimeType: audio.mimeType,
        audioSizeBytes: audio.data.length,
      });
      return event;
    } catch (error) {
      await this.storage.delete(key);
      throw error;
    }
  }

  getVoiceEvent(id: string): Promise<NexusVoiceEvent> {
    return this.tx.run(async (manager) => {
      const event = await this.voiceEvents.withManager(manager).findOneBy({ id });
      if (!event) {
        throw new NotFoundException('Voice event not found');
      }
      return event;
    });
  }
}

function stakeholderStatus(decision: DsrActivityType | null): StakeholderStatus {
  if (decision === 'terms_accepted') {
    return 'accepted';
  }
  return decision === 'terms_rejected' ? 'rejected' : 'engaged';
}

function emptyCounts(): Record<DsrActivityType, number> {
  return Object.fromEntries(DSR_ACTIVITY_TYPES.map((type) => [type, 0])) as Record<DsrActivityType, number>;
}

function buildDsrStatus(rows: StakeholderRow[], windowDays: number): DsrStatus {
  const dsrs = new Map<string, DsrState>();
  for (const row of rows) {
    let dsr = dsrs.get(row.dsrId);
    if (!dsr) {
      dsr = {
        dsrId: row.dsrId,
        activityCount: 0,
        stakeholderCount: 0,
        lastActivityAt: row.lastActivityAt,
        activityCounts: emptyCounts(),
        stakeholders: [],
      };
      dsrs.set(row.dsrId, dsr);
    }
    dsr.activityCount += row.activityCount;
    dsr.stakeholderCount += 1;
    if (row.lastActivityAt > dsr.lastActivityAt) {
      dsr.lastActivityAt = row.lastActivityAt;
    }
    for (const type of DSR_ACTIVITY_TYPES) {
      dsr.activityCounts[type] += Number(row.counts[type] ?? 0);
    }
    dsr.stakeholders.push({
      email: row.email,
      status: stakeholderStatus(row.termsDecision),
      activityCount: row.activityCount,
      lastActivityType: row.lastActivityType,
      lastActivityAt: row.lastActivityAt,
    });
  }
  const all = [...dsrs.values()];
  const stakeholders = all.flatMap((dsr) => dsr.stakeholders);
  const count = (status: StakeholderStatus): number => stakeholders.filter((s) => s.status === status).length;
  return {
    generatedAt: new Date(),
    windowDays,
    summary: {
      activeDsrs: all.length,
      stakeholders: stakeholders.length,
      accepted: count('accepted'),
      rejected: count('rejected'),
      pending: count('engaged'),
    },
    dsrs: all,
  };
}
