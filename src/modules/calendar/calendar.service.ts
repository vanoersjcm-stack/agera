import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { jobRoleOf } from '../auth/job-roles.js';
import { AuditService } from '../core/audit/audit.service.js';
import { TenantContext } from '../core/tenancy/tenant-context.service.js';
import { TenantTransaction } from '../core/tenancy/tenant-transaction.service.js';
import { UserService } from '../user/user.service.js';

export const VISIBILITIES = ['team', 'private'] as const;
export const RESPONSES = ['accepted', 'declined'] as const;
export const CALENDAR_SCOPES = ['mine', 'team'] as const;

const PERSON = (a: string) => `COALESCE(NULLIF(btrim(concat_ws(' ', ${a}.first_name, ${a}.last_name)), ''), ${a}.email)`;

export interface EventInput {
  title: string; description: string | null; location: string | null; startsAt: Date; endsAt: Date; allDay: boolean;
  visibility: (typeof VISIBILITIES)[number]; clientId: string | null; storeId: string | null; attendeeIds: string[];
}

/** One entry on the calendar: an Agera appointment or a dated record from another module. */
export interface CalendarItem {
  id: string; kind: 'appointment' | 'visit' | 'round' | 'milestone'; title: string; start: string; end: string; allDay: boolean; link: string | null;
  ownerName: string | null; status: string | null; detail: string | null;
}

const EVENT_SQL = `
  SELECT e.id, e.title, e.description, e.location, e.starts_at AS "startsAt", e.ends_at AS "endsAt", e.all_day AS "allDay", e.visibility, e.status,
         e.client_id AS "clientId", c.name AS "clientName", e.store_id AS "storeId", s.name AS "storeName",
         e.created_by AS "createdBy", ${PERSON('u')} AS "createdByName", e.created_at AS "createdAt",
         COALESCE((SELECT json_agg(json_build_object('userId', a.user_id, 'name', ${PERSON('au')}, 'response', a.response) ORDER BY au.first_name)
                     FROM calendar_event_attendees a JOIN users au ON au.id = a.user_id WHERE a.event_id = e.id), '[]') AS attendees
    FROM calendar_events e JOIN users u ON u.id = e.created_by
    LEFT JOIN clients c ON c.id = e.client_id LEFT JOIN stores s ON s.id = e.store_id`;

/** Private appointments are only visible to their creator and attendees. */
const VISIBLE = `(e.visibility = 'team' OR e.created_by = $2 OR EXISTS (SELECT 1 FROM calendar_event_attendees x WHERE x.event_id = e.id AND x.user_id = $2))`;
const MINE = `(e.created_by = $2 OR EXISTS (SELECT 1 FROM calendar_event_attendees x WHERE x.event_id = e.id AND x.user_id = $2))`;

@Injectable()
export class CalendarService {
  constructor(
    private readonly context: TenantContext,
    private readonly tx: TenantTransaction,
    private readonly users: UserService,
    private readonly audit: AuditService,
  ) {}

  private get t(): string {
    return this.context.tenantId;
  }

  /** Field representatives always see their own calendar; others choose mine or team. */
  async items(from: Date, to: Date, scope: (typeof CALENDAR_SCOPES)[number], identity: AuthenticatedUser): Promise<CalendarItem[]> {
    if (to.getTime() - from.getTime() > 92 * 86_400_000) throw new BadRequestException('Ask for at most 92 days at a time');
    const me = (await this.users.resolveActor(identity)).id;
    const field = jobRoleOf(identity.roles) === 'FIELD_REPRESENTATIVE';
    const mine = field || scope === 'mine';
    return this.tx.run(async (m) => {
      const out: CalendarItem[] = [];
      const events = await m.query(
        `${EVENT_SQL} WHERE e.tenant_id = $1 AND ${mine ? MINE : VISIBLE} AND e.status = 'scheduled' AND e.starts_at < $4 AND e.ends_at >= $3 ORDER BY e.starts_at`,
        [this.t, me, from, to],
      );
      for (const e of events) {
        out.push({ id: e.id, kind: 'appointment', title: e.title, start: e.startsAt, end: e.endsAt, allDay: e.allDay, link: `/calendar?event=${e.id}`, ownerName: e.createdByName, status: e.visibility, detail: [e.location, e.clientName ?? e.storeName].filter(Boolean).join(' · ') || null });
      }
      const visits = await m.query(
        `SELECT v.id, v.visit_date AS "visitDate", v.status, s.name AS "storeName", ${PERSON('u')} AS "repName", r.name AS "roundName"
           FROM merchandising_visits v JOIN stores s ON s.id = v.store_id JOIN users u ON u.id = v.field_rep_id LEFT JOIN audit_rounds r ON r.id = v.audit_round_id
          WHERE v.tenant_id = $1 AND v.status <> 'CANCELLED' AND v.visit_date >= $3 AND v.visit_date < $4 ${mine ? 'AND v.field_rep_id = $2' : 'AND $2::uuid IS NOT NULL'}
          ORDER BY v.visit_date LIMIT 1000`,
        [this.t, me, from, to],
      );
      for (const v of visits) {
        const start = new Date(v.visitDate);
        out.push({ id: v.id, kind: 'visit', title: v.storeName, start: start.toISOString(), end: new Date(start.getTime() + 3_600_000).toISOString(), allDay: false, link: `/retailpower/store-visits/${v.id}`, ownerName: v.repName, status: v.status, detail: v.roundName });
      }
      const rounds = await m.query(
        `SELECT r.id, r.name, r.round_type AS "roundType", to_char(r.due_date, 'YYYY-MM-DD') AS "dueDate", r.status
           FROM audit_rounds r WHERE r.tenant_id = $1 AND r.due_date >= $3::date AND r.due_date < $4::date
            ${mine ? 'AND ($2 = ANY(r.merchandiser_ids) OR r.created_by = $2)' : 'AND $2::uuid IS NOT NULL'}`,
        [this.t, me, from, to],
      );
      for (const r of rounds) {
        out.push({ id: r.id, kind: 'round', title: r.name, start: r.dueDate, end: r.dueDate, allDay: true, link: `/retailpower/audit-rounds/${r.id}`, ownerName: null, status: r.roundType, detail: r.status });
      }
      if (!mine) {
        const milestones = await m.query(
          `SELECT ms.id, ms.title, to_char(ms.due_date, 'YYYY-MM-DD') AS "dueDate", ms.client_room_id AS "roomId", d.room_name AS "roomName", ms.owner_side AS "ownerSide"
             FROM client_room_milestones ms JOIN digital_sales_rooms d ON d.id = ms.client_room_id
            WHERE ms.tenant_id = $1 AND NOT ms.completed AND ms.due_date >= $3::date AND ms.due_date < $4::date AND $2::uuid IS NOT NULL`,
          [this.t, me, from, to],
        );
        for (const x of milestones) {
          out.push({ id: x.id, kind: 'milestone', title: x.title, start: x.dueDate, end: x.dueDate, allDay: true, link: `/nexus/client-rooms/${x.roomId}?tab=plan`, ownerName: null, status: x.ownerSide, detail: x.roomName });
        }
      }
      return out.sort((a, b) => String(a.start).localeCompare(String(b.start)));
    });
  }

  async event(id: string, identity: AuthenticatedUser): Promise<unknown> {
    const me = (await this.users.resolveActor(identity)).id;
    return this.tx.run((m) => this.load(m, id, me));
  }

  private async load(m: EntityManager, id: string, me: string): Promise<Record<string, unknown>> {
    const [e] = await m.query(`${EVENT_SQL} WHERE e.tenant_id = $1 AND ${VISIBLE} AND e.id = $3`, [this.t, me, id]);
    if (!e) throw new NotFoundException('Appointment not found');
    return e;
  }

  private async assertLinks(m: EntityManager, input: Pick<EventInput, 'clientId' | 'storeId' | 'attendeeIds'>): Promise<void> {
    if (input.clientId && !(await m.query('SELECT 1 FROM clients WHERE tenant_id = $1 AND id = $2', [this.t, input.clientId])).length) throw new BadRequestException('clientId is not a client of this organisation');
    if (input.storeId && !(await m.query('SELECT 1 FROM stores WHERE tenant_id = $1 AND id = $2', [this.t, input.storeId])).length) throw new BadRequestException('storeId is not a store of this organisation');
    const ids = [...new Set(input.attendeeIds)];
    if (ids.length) {
      const rows = await m.query('SELECT id FROM users WHERE tenant_id = $1 AND id = ANY($2::uuid[]) AND is_active', [this.t, ids]);
      if (rows.length !== ids.length) throw new BadRequestException('attendeeIds must be active colleagues in this organisation');
    }
  }

  private async invite(m: EntityManager, eventId: string, title: string, start: Date, userIds: string[], me: string): Promise<void> {
    for (const userId of userIds) {
      await m.query('INSERT INTO calendar_event_attendees (tenant_id, event_id, user_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [this.t, eventId, userId]);
      if (userId !== me) {
        await m.query('INSERT INTO notifications (tenant_id, user_id, title, body, link) VALUES ($1,$2,$3,$4,$5)', [
          this.t, userId, `Invitation: ${title}`.slice(0, 250), start.toISOString(), `/calendar?event=${eventId}`,
        ]);
      }
    }
  }

  async create(input: EventInput, identity: AuthenticatedUser): Promise<unknown> {
    const me = (await this.users.resolveActor(identity)).id;
    const row = await this.tx.run(async (m) => {
      await this.assertLinks(m, input);
      const [e] = await m.query(
        `INSERT INTO calendar_events (tenant_id, title, description, location, starts_at, ends_at, all_day, visibility, client_id, store_id, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
        [this.t, input.title, input.description, input.location, input.startsAt, input.endsAt, input.allDay, input.visibility, input.clientId, input.storeId, me],
      );
      await this.invite(m, e.id, input.title, input.startsAt, [...new Set(input.attendeeIds)], me);
      return this.load(m, e.id, me);
    });
    this.audit.logAction(this.t, me, 'calendar_event.created', { eventId: row.id, attendees: input.attendeeIds.length, visibility: input.visibility });
    return row;
  }

  /** Only the creator changes or cancels an appointment. */
  async update(id: string, changes: Partial<EventInput>, identity: AuthenticatedUser): Promise<unknown> {
    const me = (await this.users.resolveActor(identity)).id;
    const row = await this.tx.run(async (m) => {
      const cur = await this.load(m, id, me);
      if (cur.createdBy !== me) throw new ForbiddenException('Only the organiser can change this appointment');
      if (cur.status === 'cancelled') throw new ConflictException('This appointment is cancelled');
      const next = { title: cur.title, description: cur.description, location: cur.location, startsAt: cur.startsAt, endsAt: cur.endsAt, allDay: cur.allDay, visibility: cur.visibility, clientId: cur.clientId, storeId: cur.storeId, ...changes };
      if (new Date(next.endsAt as Date).getTime() < new Date(next.startsAt as Date).getTime()) throw new BadRequestException('endsAt must be after startsAt');
      await this.assertLinks(m, { clientId: next.clientId as string | null, storeId: next.storeId as string | null, attendeeIds: changes.attendeeIds ?? [] });
      await m.query(
        `UPDATE calendar_events SET title=$3, description=$4, location=$5, starts_at=$6, ends_at=$7, all_day=$8, visibility=$9, client_id=$10, store_id=$11 WHERE tenant_id=$1 AND id=$2`,
        [this.t, id, next.title, next.description, next.location, next.startsAt, next.endsAt, next.allDay, next.visibility, next.clientId, next.storeId],
      );
      if (changes.attendeeIds) {
        const keep = [...new Set(changes.attendeeIds)];
        await m.query('DELETE FROM calendar_event_attendees WHERE tenant_id = $1 AND event_id = $2 AND NOT (user_id = ANY($3::uuid[]))', [this.t, id, keep]);
        await this.invite(m, id, String(next.title), new Date(next.startsAt as Date), keep, me);
      }
      return this.load(m, id, me);
    });
    this.audit.logAction(this.t, me, 'calendar_event.updated', { eventId: id, changes: Object.keys(changes) });
    return row;
  }

  async cancel(id: string, identity: AuthenticatedUser): Promise<unknown> {
    const me = (await this.users.resolveActor(identity)).id;
    const row = await this.tx.run(async (m) => {
      const cur = await this.load(m, id, me);
      if (cur.createdBy !== me) throw new ForbiddenException('Only the organiser can cancel this appointment');
      await m.query(`UPDATE calendar_events SET status = 'cancelled' WHERE tenant_id = $1 AND id = $2`, [this.t, id]);
      const attendees = (cur.attendees as { userId: string }[]).filter((a) => a.userId !== me);
      for (const a of attendees) {
        await m.query('INSERT INTO notifications (tenant_id, user_id, title, body, link) VALUES ($1,$2,$3,NULL,$4)', [this.t, a.userId, `Cancelled: ${cur.title}`.slice(0, 250), '/calendar']);
      }
      return this.load(m, id, me);
    });
    this.audit.logAction(this.t, me, 'calendar_event.cancelled', { eventId: id });
    return row;
  }

  async respond(id: string, response: (typeof RESPONSES)[number], identity: AuthenticatedUser): Promise<unknown> {
    const me = (await this.users.resolveActor(identity)).id;
    const row = await this.tx.run(async (m) => {
      const updated = await m.query('UPDATE calendar_event_attendees SET response = $4 WHERE tenant_id = $1 AND event_id = $2 AND user_id = $3 RETURNING event_id', [this.t, id, me, response]);
      if (!updated.length) throw new NotFoundException('You are not invited to this appointment');
      return this.load(m, id, me);
    });
    this.audit.logAction(this.t, me, 'calendar_event.responded', { eventId: id, response });
    return row;
  }
}
