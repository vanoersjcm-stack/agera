import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { jobRoleOf } from '../auth/job-roles.js';
import { AuditService } from '../core/audit/audit.service.js';
import { TenantContext } from '../core/tenancy/tenant-context.service.js';
import { TenantTransaction } from '../core/tenancy/tenant-transaction.service.js';
import { OfficeService } from '../office/office.service.js';
import { UserService } from '../user/user.service.js';
import { AgendaResourcesService, isAgendaAdmin } from './agenda-resources.service.js';

export const VISIBILITIES = ['team', 'private'] as const;
export const RESPONSES = ['accepted', 'declined', 'unable'] as const;
export const NOTE_LANGUAGES = ['en', 'nl'] as const;
export const CALENDAR_SCOPES = ['mine', 'team'] as const;
export const PLANNING_MODES = ['fixed', 'find', 'mandatory'] as const;
export const VISIT_CONFLICTS = ['flag', 'move'] as const;
export const ROOM_CONFLICTS = ['free_only', 'take_over'] as const;

/** HQ admins, platform admins and account managers may plan a mandatory meeting. */
export function canMandate(identity: AuthenticatedUser): boolean {
  const role = jobRoleOf(identity.roles);
  return role === 'PLATFORM_ADMIN' || role === 'HQ_ADMIN' || role === 'ACCOUNT_MANAGER' || (role === null && identity.roles.includes('admin'));
}

const TZ = 'Europe/Amsterdam';
/** Wall-clock parts of a moment in the Amsterdam office time zone. */
function localParts(d: Date): { y: number; mo: number; day: number; h: number; mi: number; wd: number } {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short' })
    .formatToParts(d).map((x) => [x.type, x.value]));
  return { y: +p.year, mo: +p.month, day: +p.day, h: +p.hour, mi: +p.minute, wd: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday) };
}
/** The moment for a wall-clock time in Amsterdam (DST-aware). */
function atLocal(y: number, mo: number, day: number, h: number, mi: number): Date {
  const guess = new Date(Date.UTC(y, mo - 1, day, h, mi));
  const p = localParts(guess);
  const drift = Date.UTC(p.y, p.mo - 1, p.day, p.h, p.mi) - guess.getTime();
  return new Date(guess.getTime() - drift);
}

const PERSON = (a: string) => `COALESCE(NULLIF(btrim(concat_ws(' ', ${a}.first_name, ${a}.last_name)), ''), ${a}.email)`;

export interface EventInput {
  title: string; description: string | null; location: string | null; startsAt: Date; endsAt: Date; allDay: boolean;
  visibility: (typeof VISIBILITIES)[number]; clientId: string | null; storeId: string | null; attendeeIds: string[];
  assets?: { assetId: string; bufferMinutes: number }[];
  planningMode?: (typeof PLANNING_MODES)[number]; optionalIds?: string[];
  visitConflicts?: (typeof VISIT_CONFLICTS)[number]; roomConflicts?: (typeof ROOM_CONFLICTS)[number];
}

/** One entry on the calendar: an Agera appointment or a dated record from another module. */
export interface CalendarItem {
  id: string; kind: 'appointment' | 'visit' | 'round' | 'milestone' | 'leave'; title: string; start: string; end: string; allDay: boolean; link: string | null;
  ownerName: string | null; status: string | null; detail: string | null;
}

const EVENT_SQL = `
  SELECT e.id, e.title, e.description, e.location, e.starts_at AS "startsAt", e.ends_at AS "endsAt", e.all_day AS "allDay", e.visibility, e.status, e.planning_mode AS "planningMode",
         e.client_id AS "clientId", c.name AS "clientName", e.store_id AS "storeId", s.name AS "storeName",
         e.created_by AS "createdBy", ${PERSON('u')} AS "createdByName", e.created_at AS "createdAt",
         COALESCE((SELECT json_agg(json_build_object('userId', a.user_id, 'name', ${PERSON('au')}, 'response', a.response, 'required', a.required, 'reason', a.reason) ORDER BY au.first_name)
                     FROM calendar_event_attendees a JOIN users au ON au.id = a.user_id WHERE a.event_id = e.id), '[]') AS attendees,
         COALESCE((SELECT json_agg(json_build_object('id', d.id, 'title', d.title, 'fileFormat', d.file_format, 'kind', ed.kind, 'clientName', dc.name, 'addedBy', ed.added_by) ORDER BY ed.kind DESC, ed.created_at)
                     FROM calendar_event_documents ed JOIN room_documents d ON d.tenant_id = ed.tenant_id AND d.id = ed.document_id
                     LEFT JOIN clients dc ON dc.id = d.client_id WHERE ed.event_id = e.id), '[]') AS documents,
         COALESCE((SELECT json_agg(json_build_object('assetId', ea.asset_id, 'name', ba.name, 'category', ba.category, 'bookingMode', ba.booking_mode, 'bufferMinutes', ea.buffer_minutes, 'bookedBy', ea.booked_by) ORDER BY ba.name)
                     FROM calendar_event_assets ea JOIN bookable_assets ba ON ba.id = ea.asset_id WHERE ea.event_id = e.id), '[]') AS assets,
         COALESCE((SELECT json_agg(json_build_object('kind', o.target_kind, 'action', o.action, 'detail', o.detail) ORDER BY o.created_at)
                     FROM calendar_overrides o WHERE o.event_id = e.id), '[]') AS overrides,
         COALESCE((SELECT json_agg(json_build_object('eventId', me.id, 'title', me.title, 'startsAt', me.starts_at) ORDER BY me.starts_at)
                     FROM calendar_overrides o JOIN calendar_events me ON me.id = o.event_id
                    WHERE o.target_kind = 'event' AND o.target_id = e.id AND me.status = 'scheduled'), '[]') AS "overriddenBy"
    FROM calendar_events e JOIN users u ON u.id = e.created_by
    LEFT JOIN clients c ON c.id = e.client_id LEFT JOIN stores s ON s.id = e.store_id`;

/** Private appointments are only visible to their creator and attendees. */
const VISIBLE = `(e.visibility = 'team' OR e.created_by = $2 OR EXISTS (SELECT 1 FROM calendar_event_attendees x WHERE x.event_id = e.id AND x.user_id = $2))`;
const MINE = `(e.created_by = $2 OR EXISTS (SELECT 1 FROM calendar_event_attendees x WHERE x.event_id = e.id AND x.user_id = $2))`;

const NOTES_TEXT = {
  en: { title: 'Meeting notes', when: 'Date and time', allDay: 'all day', location: 'Location', organiser: 'Organiser', attendees: 'Attendees', client: 'Client', agenda: 'Agenda', notes: 'Notes', actions: 'Action items', action: 'Action', owner: 'Who', due: 'When' },
  nl: { title: 'Notulen', when: 'Datum en tijd', allDay: 'hele dag', location: 'Locatie', organiser: 'Organisator', attendees: 'Deelnemers', client: 'Klant', agenda: 'Agenda', notes: 'Aantekeningen', actions: 'Actiepunten', action: 'Actie', owner: 'Wie', due: 'Wanneer' },
} as const;

/** Raw UPDATE/DELETE ... RETURNING results come back as [rows, count] from TypeORM. */
const returnedRows = <T>(r: unknown): T[] => (Array.isArray(r) && r.length === 2 && Array.isArray(r[0]) && typeof r[1] === 'number' ? r[0] : r) as T[];

const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

@Injectable()
export class CalendarService {
  constructor(
    private readonly context: TenantContext,
    private readonly tx: TenantTransaction,
    private readonly users: UserService,
    private readonly audit: AuditService,
    private readonly office: OfficeService,
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
      const leave = await m.query(
        `SELECT l.id, l.leave_type AS "leaveType", to_char(d, 'YYYY-MM-DD') AS day, ${PERSON('u')} AS "userName"
           FROM leave_requests l JOIN users u ON u.id = l.user_id
           CROSS JOIN LATERAL generate_series(GREATEST(l.start_date, $3::date), LEAST(l.end_date, ($4::timestamptz - interval '1 second')::date), interval '1 day') AS d
          WHERE l.tenant_id = $1 AND l.status = 'approved' AND l.start_date < $4::date + 1 AND l.end_date >= $3::date AND extract(isodow FROM d) < 6
            ${mine ? 'AND l.user_id = $2' : 'AND $2::uuid IS NOT NULL'}`,
        [this.t, me, from, to],
      );
      for (const l of leave) {
        out.push({ id: `${l.id}-${l.day}`, kind: 'leave', title: l.userName, start: l.day, end: l.day, allDay: true, link: '/calendar?tab=leave', ownerName: l.userName, status: l.leaveType, detail: null });
      }
      return out.sort((a, b) => String(a.start).localeCompare(String(b.start)));
    });
  }

  /** Busy periods of colleagues (agenda items, approved leave, store visits) and of rooms/equipment, for planning a meeting. */
  async availability(userIds: string[], assetIds: string[], from: Date, to: Date, identity: AuthenticatedUser): Promise<unknown> {
    const me = (await this.users.resolveActor(identity)).id;
    return this.tx.run(async (m) => {
      const people = userIds.length
        ? await m.query(`SELECT id AS "userId", ${PERSON('u')} AS name FROM users u WHERE u.tenant_id = $1 AND u.id = ANY($2::uuid[]) AND u.is_active ORDER BY u.first_name`, [this.t, userIds])
        : [];
      if (people.length !== new Set(userIds).size) throw new BadRequestException('userIds must be active colleagues in this organisation');
      const busy = userIds.length
        ? await m.query(`SELECT user_id AS "userId", starts_at AS "start", ends_at AS "end", source, ref_id AS "refId", title, mandatory FROM calendar_busy($1::uuid[], $2, $3) ORDER BY starts_at`, [userIds, from, to])
        : [];
      const assets = assetIds.length
        ? await m.query(`SELECT id AS "assetId", name, booking_mode AS "bookingMode" FROM bookable_assets WHERE tenant_id = $1 AND id = ANY($2::uuid[]) AND active ORDER BY name`, [this.t, assetIds])
        : [];
      const bookings = assetIds.length
        ? await m.query(
          `SELECT ea.asset_id AS "assetId", ea.starts_at AS "start", ea.blocked_until AS "end", ea.event_id AS "refId", e.title, ea.booked_by AS "bookedBy"
             FROM calendar_event_assets ea LEFT JOIN calendar_events e ON e.id = ea.event_id
            WHERE ea.tenant_id = $1 AND ea.asset_id = ANY($2::uuid[]) AND ea.starts_at < $4 AND ea.blocked_until > $3 ORDER BY ea.starts_at`,
          [this.t, assetIds, from, to])
        : [];
      return {
        people: people.map((p: { userId: string; name: string }) => ({ ...p, busy: busy.filter((b: { userId: string }) => b.userId === p.userId) })),
        assets: assets.map((a: { assetId: string }) => ({ ...a, busy: bookings.filter((b: { assetId: string }) => b.assetId === a.assetId) })),
        me,
      };
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

  private async notify(m: EntityManager, userId: string, title: string, body: string | null, link: string): Promise<void> {
    await m.query('INSERT INTO notifications (tenant_id, user_id, title, body, link) VALUES ($1,$2,$3,$4,$5)', [this.t, userId, title.slice(0, 250), body, link]);
  }

  /**
   * A mandatory meeting overrides the invitees' planning: their clashing agenda items are flagged, clashing store visits
   * are flagged or moved to the first free slot, booked rooms/equipment are taken over when chosen. Approved leave is
   * never overridden: those invitees are marked unable to attend. Nothing is deleted.
   */
  private async override(m: EntityManager, eventId: string, input: EventInput, me: string): Promise<void> {
    const start = input.startsAt; const end = input.endsAt; const link = `/calendar?event=${eventId}`;
    const record = (kind: string, target: string, owner: string | null, action: string, detail: string | null) => m.query(
      'INSERT INTO calendar_overrides (tenant_id, event_id, target_kind, target_id, owner_id, action, detail) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [this.t, eventId, kind, target, owner, action, detail?.slice(0, 300) ?? null]);
    if (input.roomConflicts === 'take_over') {
      for (const b of input.assets ?? []) {
        const until = new Date(end.getTime() + b.bufferMinutes * 60_000);
        const taken: { eventId: string; bookedBy: string; name: string }[] = await m.query(
          `DELETE FROM calendar_event_assets ea USING bookable_assets ba
            WHERE ea.tenant_id = $1 AND ea.asset_id = $2 AND ba.id = ea.asset_id AND ea.event_id <> $5
              AND tstzrange(ea.starts_at, ea.blocked_until, '[)') && tstzrange($3, $4, '[)')
          RETURNING ea.event_id AS "eventId", ea.booked_by AS "bookedBy", ba.name`,
          [this.t, b.assetId, start, until, eventId]).then((r) => returnedRows<{ eventId: string; bookedBy: string; name: string }>(r));
        for (const x of taken) {
          await record('asset', x.eventId, x.bookedBy, 'taken_over', x.name);
          if (x.bookedBy !== me) await this.notify(m, x.bookedBy, `${x.name} taken over by mandatory meeting: ${input.title}`, start.toISOString(), `/calendar?event=${x.eventId}`);
        }
      }
    }
    const people = [...new Set(input.attendeeIds)].filter((u) => u !== me);
    if (!people.length) return;
    const busy: { userId: string; start: Date; end: Date; source: string; refId: string; title: string | null }[] = await m.query(
      'SELECT user_id AS "userId", starts_at AS "start", ends_at AS "end", source, ref_id AS "refId", title FROM calendar_busy($1::uuid[], $2, $3)', [people, start, end]);
    for (const b of busy) {
      if (b.source === 'leave') {
        await m.query(`UPDATE calendar_event_attendees SET response = 'unable', reason = 'On approved leave' WHERE tenant_id = $1 AND event_id = $2 AND user_id = $3`, [this.t, eventId, b.userId]);
      } else if (b.source === 'event' && b.refId !== eventId) {
        await record('event', b.refId, b.userId, 'flagged', b.title);
        await this.notify(m, b.userId, `Mandatory meeting overlaps your agenda: ${input.title}`, `Please reschedule ${b.title ?? 'your private agenda item'}`, link);
      } else if (b.source === 'visit') {
        const moved = input.visitConflicts === 'move' ? await this.moveVisit(m, b.refId, b.userId, new Date(b.start), end) : null;
        await record('visit', b.refId, b.userId, moved ? 'moved' : 'flagged', moved ? `${b.title}: ${new Date(b.start).toISOString()} -> ${moved.toISOString()}` : b.title);
        await this.notify(m, b.userId, moved ? `Store visit ${b.title} moved for mandatory meeting: ${input.title}` : `Mandatory meeting overlaps your store visit ${b.title}: please re-plan it`, moved ? moved.toISOString() : null, `/retailpower/store-visits/${b.refId}`);
      }
    }
  }

  /** First free hour for a store visit: the same day after the meeting (by 17:30), else the same time on the next weekdays. */
  private async moveVisit(m: EntityManager, visitId: string, rep: string, was: Date, meetingEnd: Date): Promise<Date | null> {
    const candidates: Date[] = [];
    const e = localParts(meetingEnd);
    const after = atLocal(e.y, e.mo, e.day, e.h, Math.ceil(e.mi / 15) * 15);
    const latest = atLocal(e.y, e.mo, e.day, 17, 30);
    if (after.getTime() + 3_600_000 <= latest.getTime()) candidates.push(after);
    const w = localParts(was);
    for (let i = 1; i <= 14; i++) {
      const d = new Date(Date.UTC(w.y, w.mo - 1, w.day + i));
      if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
      candidates.push(atLocal(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), w.h, w.mi));
    }
    for (const c of candidates) {
      const clash: { refId: string }[] = await m.query('SELECT ref_id AS "refId" FROM calendar_busy($1::uuid[], $2, $3)', [[rep], c, new Date(c.getTime() + 3_600_000)]);
      if (clash.some((x) => x.refId !== visitId)) continue;
      await m.query('UPDATE merchandising_visits SET visit_date = $3, updated_at = NOW() WHERE tenant_id = $1 AND id = $2', [this.t, visitId, c]);
      return c;
    }
    return null;
  }

  async create(input: EventInput, identity: AuthenticatedUser): Promise<unknown> {
    const me = (await this.users.resolveActor(identity)).id;
    if (input.planningMode === 'mandatory' && !canMandate(identity)) throw new ForbiddenException('Only HQ admins, platform admins and account managers can plan a mandatory meeting');
    const row = await this.tx.run(async (m) => {
      await this.assertLinks(m, input);
      const [e] = await m.query(
        `INSERT INTO calendar_events (tenant_id, title, description, location, starts_at, ends_at, all_day, visibility, client_id, store_id, created_by, planning_mode)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
        [this.t, input.title, input.description, input.location, input.startsAt, input.endsAt, input.allDay, input.visibility, input.clientId, input.storeId, me, input.planningMode ?? 'fixed'],
      );
      await this.invite(m, e.id, input.title, input.startsAt, [...new Set(input.attendeeIds)], me);
      if (input.optionalIds?.length) {
        await m.query('UPDATE calendar_event_attendees SET required = FALSE WHERE tenant_id = $1 AND event_id = $2 AND user_id = ANY($3::uuid[])', [this.t, e.id, input.optionalIds]);
      }
      if (input.planningMode === 'mandatory') await this.override(m, e.id, input, me);
      for (const b of input.assets ?? []) {
        await AgendaResourcesService.insertBooking(m, this.t, { id: e.id, startsAt: input.startsAt, endsAt: input.endsAt }, b.assetId, b.bufferMinutes, me, isAgendaAdmin(identity));
      }
      return this.load(m, e.id, me);
    });
    this.audit.logAction(this.t, me, 'calendar_event.created', { eventId: row.id, attendees: input.attendeeIds.length, visibility: input.visibility, assets: (input.assets ?? []).map((b) => b.assetId), planningMode: input.planningMode ?? 'fixed', overrides: (row.overrides as unknown[]).length });
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
      if (changes.startsAt || changes.endsAt) await AgendaResourcesService.moveBookings(m, this.t, id, new Date(next.startsAt as Date), new Date(next.endsAt as Date));
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
      await m.query('DELETE FROM calendar_event_assets WHERE tenant_id = $1 AND event_id = $2', [this.t, id]);
      const attendees = (cur.attendees as { userId: string }[]).filter((a) => a.userId !== me);
      for (const a of attendees) {
        await m.query('INSERT INTO notifications (tenant_id, user_id, title, body, link) VALUES ($1,$2,$3,NULL,$4)', [this.t, a.userId, `Cancelled: ${cur.title}`.slice(0, 250), '/calendar']);
      }
      return this.load(m, id, me);
    });
    this.audit.logAction(this.t, me, 'calendar_event.cancelled', { eventId: id });
    return row;
  }

  async respond(id: string, response: (typeof RESPONSES)[number], identity: AuthenticatedUser, reason: string | null = null): Promise<unknown> {
    const me = (await this.users.resolveActor(identity)).id;
    const row = await this.tx.run(async (m) => {
      const cur = await this.load(m, id, me);
      if (cur.planningMode === 'mandatory' && response === 'declined') throw new BadRequestException("This is a mandatory meeting: answer 'unable' with a reason instead of declining");
      if (response === 'unable' && !reason) throw new BadRequestException('reason is required when you cannot attend');
      const updated = returnedRows(await m.query('UPDATE calendar_event_attendees SET response = $4, reason = $5 WHERE tenant_id = $1 AND event_id = $2 AND user_id = $3 RETURNING event_id', [this.t, id, me, response, response === 'unable' ? reason : null]));
      if (!updated.length) throw new NotFoundException('You are not invited to this appointment');
      if (response === 'unable' && cur.createdBy !== me) await this.notify(m, String(cur.createdBy), `Can't attend: ${cur.title}`, reason, `/calendar?event=${id}`);
      return this.load(m, id, me);
    });
    this.audit.logAction(this.t, me, 'calendar_event.responded', { eventId: id, response });
    return row;
  }

  // Documents and meeting notes -------------------------------------------------------------------------------

  private participant(e: Record<string, unknown>, me: string): boolean {
    return e.createdBy === me || (e.attendees as { userId: string }[]).some((a) => a.userId === me);
  }

  /** Organiser and invitees link an existing document they can open; everyone who sees the appointment can then open it. */
  async attach(id: string, documentId: string, identity: AuthenticatedUser): Promise<unknown> {
    const me = (await this.users.resolveActor(identity)).id;
    const row = await this.tx.run(async (m) => {
      const cur = await this.load(m, id, me);
      if (!this.participant(cur, me)) throw new ForbiddenException('Only the organiser and invitees can link documents');
      if (!(await m.query('SELECT 1 FROM room_documents WHERE tenant_id = $1 AND id = $2', [this.t, documentId])).length) throw new NotFoundException('Document not found');
      await m.query(`INSERT INTO calendar_event_documents (tenant_id, event_id, document_id, added_by) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`, [this.t, id, documentId, me]);
      return this.load(m, id, me);
    });
    this.audit.logAction(this.t, me, 'calendar_event.document_attached', { eventId: id, documentId });
    return row;
  }

  /** The organiser, or whoever linked it, removes the link; the document itself is kept. */
  async detach(id: string, documentId: string, identity: AuthenticatedUser): Promise<unknown> {
    const me = (await this.users.resolveActor(identity)).id;
    const row = await this.tx.run(async (m) => {
      const cur = await this.load(m, id, me);
      const link = (cur.documents as { id: string; addedBy: string }[]).find((d) => d.id === documentId);
      if (!link) throw new NotFoundException('Document is not linked to this appointment');
      if (cur.createdBy !== me && link.addedBy !== me) throw new ForbiddenException('Only the organiser or whoever linked it can remove this document');
      await m.query('DELETE FROM calendar_event_documents WHERE tenant_id = $1 AND event_id = $2 AND document_id = $3', [this.t, id, documentId]);
      return this.load(m, id, me);
    });
    this.audit.logAction(this.t, me, 'calendar_event.document_detached', { eventId: id, documentId });
    return row;
  }

  /** One-click meeting notes: a pre-filled Agera.text document linked to the appointment (once per appointment). */
  async meetingNotes(id: string, language: (typeof NOTE_LANGUAGES)[number], identity: AuthenticatedUser): Promise<unknown> {
    const me = (await this.users.resolveActor(identity)).id;
    const cur = await this.tx.run(async (m) => this.load(m, id, me));
    if (!this.participant(cur, me)) throw new ForbiddenException('Only the organiser and invitees can create meeting notes');
    if ((cur.documents as { kind: string }[]).some((d) => d.kind === 'notes')) return cur;
    const l = NOTES_TEXT[language];
    const tz = { timeZone: 'Europe/Amsterdam' } as const;
    const loc = language === 'nl' ? 'nl-NL' : 'en-GB';
    const start = new Date(cur.startsAt as string);
    const end = new Date(cur.endsAt as string);
    const when = cur.allDay
      ? `${start.toLocaleDateString(loc, { ...tz, dateStyle: 'full' })} (${l.allDay})`
      : `${start.toLocaleString(loc, { ...tz, dateStyle: 'full', timeStyle: 'short' })} – ${end.toLocaleTimeString(loc, { ...tz, timeStyle: 'short' })}`;
    const people = (cur.attendees as { name: string }[]).map((a) => a.name).join(', ') || '—';
    const row = (k: string, v: unknown) => `<tr><td style="padding:1mm 4mm 1mm 0;font-weight:bold;vertical-align:top">${esc(k)}</td><td style="padding:1mm 0">${esc(String(v ?? '—'))}</td></tr>`;
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(l.title)} – ${esc(String(cur.title))}</title></head>
<body style="font-family:Arial,sans-serif;font-size:11pt"><h1 style="font-size:16pt">${esc(l.title)}: ${esc(String(cur.title))}</h1>
<table style="border-collapse:collapse;margin-bottom:6mm">${row(l.when, when)}${row(l.location, cur.location)}${row(l.organiser, cur.createdByName)}${row(l.attendees, people)}${row(l.client, cur.clientName)}</table>
<h2 style="font-size:13pt">${esc(l.agenda)}</h2><p>&nbsp;</p><h2 style="font-size:13pt">${esc(l.notes)}</h2><p>&nbsp;</p>
<h2 style="font-size:13pt">${esc(l.actions)}</h2><table style="border-collapse:collapse;width:100%"><tr><th style="text-align:left;border-bottom:1px solid #999">${esc(l.action)}</th><th style="text-align:left;border-bottom:1px solid #999">${esc(l.owner)}</th><th style="text-align:left;border-bottom:1px solid #999">${esc(l.due)}</th></tr><tr><td>&nbsp;</td><td></td><td></td></tr></table>
</body></html>`;
    const doc = await this.office.create(
      {
        clientId: (cur.clientId as string | null) ?? null, contactId: null, dealId: null, clientRoomId: null,
        title: `${l.title} – ${String(cur.title)} – ${start.toLocaleDateString(loc, tz)}`.slice(0, 200), format: 'docx', templateId: null, starterCsv: null, html,
      },
      identity,
    );
    const result = await this.tx.run(async (m) => {
      await m.query(`INSERT INTO calendar_event_documents (tenant_id, event_id, document_id, kind, added_by) VALUES ($1,$2,$3,'notes',$4)`, [this.t, id, doc.id, me]);
      return this.load(m, id, me);
    });
    this.audit.logAction(this.t, me, 'calendar_event.meeting_notes_created', { eventId: id, documentId: doc.id });
    return result;
  }
}
