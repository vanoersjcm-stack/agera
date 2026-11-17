import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { jobRoleOf } from '../auth/job-roles.js';
import { AuditService } from '../core/audit/audit.service.js';
import { TenantContext } from '../core/tenancy/tenant-context.service.js';
import { TenantTransaction } from '../core/tenancy/tenant-transaction.service.js';
import { UserService } from '../user/user.service.js';

export const ASSET_CATEGORIES = ['meeting_room', 'av_equipment', 'other'] as const;
export const BOOKING_MODES = ['self_service', 'coordinator_only'] as const;
export const BUFFERS = [0, 15, 30] as const;
export const LEAVE_TYPES = ['vacation', 'leave', 'sick', 'other'] as const;
export const LEAVE_DECISIONS = ['approved', 'rejected'] as const;

export interface AssetInput {
  name: string; category: (typeof ASSET_CATEGORIES)[number]; bookingMode: (typeof BOOKING_MODES)[number]; active: boolean; notes: string | null;
}
export interface LeaveInput {
  userId: string | null; leaveType: (typeof LEAVE_TYPES)[number]; startDate: string; endDate: string; note: string | null;
}

const PERSON = (a: string) => `COALESCE(NULLIF(btrim(concat_ws(' ', ${a}.first_name, ${a}.last_name)), ''), ${a}.email)`;
const ASSET_SQL = `SELECT id, name, category, booking_mode AS "bookingMode", active, notes FROM bookable_assets`;
const LEAVE_SQL = `
  SELECT l.id, l.user_id AS "userId", ${PERSON('u')} AS "userName", l.leave_type AS "leaveType", to_char(l.start_date, 'YYYY-MM-DD') AS "startDate",
         to_char(l.end_date, 'YYYY-MM-DD') AS "endDate", l.note, l.status, ${PERSON('d')} AS "decidedByName", l.decided_at AS "decidedAt", l.created_at AS "createdAt"
    FROM leave_requests l JOIN users u ON u.id = l.user_id LEFT JOIN users d ON d.id = l.decided_by`;
/** Internal colleagues (client contacts never appear on the leave grid). */
const INTERNAL = `NOT (u.realm_roles && ARRAY['External_Client', 'CLIENT_VIEWER']::text[])`;

/** UPDATE/DELETE … RETURNING through m.query yields [rows, count]. */
const returned = (r: unknown): Record<string, string>[] => (Array.isArray(r) && Array.isArray(r[0]) ? r[0] : (r as Record<string, string>[]));
const pgCode = (e: unknown): string | undefined => (e as { driverError?: { code?: string } }).driverError?.code ?? (e as { code?: string }).code;

/** HQ and platform admins (and the legacy admin role) manage rooms, coordinator-only equipment and leave approval. */
export function isAgendaAdmin(identity: AuthenticatedUser): boolean {
  const role = jobRoleOf(identity.roles);
  return role === 'PLATFORM_ADMIN' || role === 'HQ_ADMIN' || (role === null && identity.roles.includes('admin'));
}

@Injectable()
export class AgendaResourcesService {
  constructor(
    private readonly context: TenantContext,
    private readonly tx: TenantTransaction,
    private readonly users: UserService,
    private readonly audit: AuditService,
  ) {}

  private get t(): string {
    return this.context.tenantId;
  }

  private admin(identity: AuthenticatedUser, what: string): void {
    if (!isAgendaAdmin(identity)) throw new ForbiddenException(`Only HQ and platform admins can ${what}`);
  }

  // Rooms and equipment --------------------------------------------------------------------------------------

  assets(includeInactive: boolean): Promise<unknown[]> {
    return this.tx.run((m) => m.query(`${ASSET_SQL} WHERE tenant_id = $1 ${includeInactive ? '' : 'AND active'} ORDER BY category, name`, [this.t]));
  }

  async createAsset(input: AssetInput, identity: AuthenticatedUser): Promise<unknown> {
    this.admin(identity, 'manage rooms and equipment');
    const me = (await this.users.resolveActor(identity)).id;
    const row = await this.unique(() => this.tx.run(async (m) => {
      const [a] = await m.query(
        `INSERT INTO bookable_assets (tenant_id, name, category, booking_mode, active, notes) VALUES ($1,$2,$3,$4,$5,$6)
         RETURNING id, name, category, booking_mode AS "bookingMode", active, notes`,
        [this.t, input.name, input.category, input.bookingMode, input.active, input.notes],
      );
      return a;
    }));
    this.audit.logAction(this.t, me, 'bookable_asset.created', { assetId: row.id, name: row.name });
    return row;
  }

  async updateAsset(id: string, changes: Partial<AssetInput>, identity: AuthenticatedUser): Promise<unknown> {
    this.admin(identity, 'manage rooms and equipment');
    const me = (await this.users.resolveActor(identity)).id;
    const row = await this.unique(() => this.tx.run(async (m) => {
      const [cur] = await m.query(`${ASSET_SQL} WHERE tenant_id = $1 AND id = $2`, [this.t, id]);
      if (!cur) throw new NotFoundException('Room or equipment not found');
      const next = { ...cur, ...changes };
      const [a] = await m.query(
        `UPDATE bookable_assets SET name = $3, category = $4, booking_mode = $5, active = $6, notes = $7 WHERE tenant_id = $1 AND id = $2
         RETURNING id, name, category, booking_mode AS "bookingMode", active, notes`,
        [this.t, id, next.name, next.category, next.bookingMode, next.active, next.notes],
      );
      return returned(a)[0] ?? a;
    }));
    this.audit.logAction(this.t, me, 'bookable_asset.updated', { assetId: id, changes: Object.keys(changes) });
    return row;
  }

  /** Who has which room or equipment, and for which meeting; private meetings show only the organiser. */
  bookings(from: Date, to: Date): Promise<unknown[]> {
    if (to.getTime() - from.getTime() > 92 * 86_400_000) throw new BadRequestException('Ask for at most 92 days at a time');
    return this.tx.run((m) => m.query(
      `SELECT ea.asset_id AS "assetId", a.name AS "assetName", a.booking_mode AS "bookingMode", ea.event_id AS "eventId", e.title AS "eventTitle",
              (e.id IS NULL) AS private, ea.starts_at AS "startsAt", ea.ends_at AS "endsAt", ea.blocked_until AS "blockedUntil",
              ea.buffer_minutes AS "bufferMinutes", ${PERSON('u')} AS "bookedByName"
         FROM calendar_event_assets ea JOIN bookable_assets a ON a.id = ea.asset_id JOIN users u ON u.id = ea.booked_by
         LEFT JOIN calendar_events e ON e.id = ea.event_id
        WHERE ea.tenant_id = $1 AND ea.starts_at < $3 AND ea.blocked_until > $2 ORDER BY ea.starts_at, a.name`,
      [this.t, from, to],
    ));
  }

  /** Organiser books self-service rooms; coordinator-only equipment is assigned by HQ or platform admins. */
  async book(eventId: string, assetId: string, buffer: number, identity: AuthenticatedUser): Promise<void> {
    const me = (await this.users.resolveActor(identity)).id;
    const admin = isAgendaAdmin(identity);
    await this.tx.run(async (m) => {
      const [e] = await m.query('SELECT id, created_by AS "createdBy", status, starts_at AS "startsAt", ends_at AS "endsAt" FROM calendar_events WHERE tenant_id = $1 AND id = $2', [this.t, eventId]);
      if (!e) throw new NotFoundException('Appointment not found');
      if (e.status !== 'scheduled') throw new ConflictException('This appointment is cancelled');
      if (e.createdBy !== me && !admin) throw new ForbiddenException('Only the organiser or an admin can book rooms and equipment for this appointment');
      const [a] = await m.query(`${ASSET_SQL} WHERE tenant_id = $1 AND id = $2`, [this.t, assetId]);
      if (!a || !a.active) throw new NotFoundException('Room or equipment not found');
      if (a.bookingMode === 'coordinator_only' && !admin) throw new ForbiddenException(`${a.name} is assigned by HQ or platform admins only`);
      const until = new Date(new Date(e.endsAt).getTime() + buffer * 60_000);
      try {
        await m.query('SAVEPOINT book');
        await m.query(
          `INSERT INTO calendar_event_assets (tenant_id, event_id, asset_id, buffer_minutes, starts_at, ends_at, blocked_until, booked_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [this.t, eventId, assetId, buffer, e.startsAt, e.endsAt, until, me],
        );
      } catch (err) {
        await m.query('ROLLBACK TO SAVEPOINT book');
        if (pgCode(err) === '23505') throw new ConflictException(`${a.name} is already booked for this appointment`);
        if (pgCode(err) === '23P01') {
          const [clash] = await m.query(
            `SELECT to_char(ea.starts_at AT TIME ZONE 'Europe/Amsterdam', 'DD-MM HH24:MI') AS "from", to_char(ea.blocked_until AT TIME ZONE 'Europe/Amsterdam', 'HH24:MI') AS "until"
               FROM calendar_event_assets ea WHERE ea.tenant_id = $1 AND ea.asset_id = $2 AND tstzrange(ea.starts_at, ea.blocked_until, '[)') && tstzrange($3, $4, '[)') LIMIT 1`,
            [this.t, assetId, e.startsAt, until],
          );
          throw new ConflictException(`${a.name} is already booked${clash ? ` from ${clash.from} to ${clash.until}` : ''} (buffer included)`);
        }
        throw err;
      }
    });
    this.audit.logAction(this.t, me, 'calendar_event.asset_booked', { eventId, assetId, bufferMinutes: buffer });
  }

  async unbook(eventId: string, assetId: string, identity: AuthenticatedUser): Promise<void> {
    const me = (await this.users.resolveActor(identity)).id;
    await this.tx.run(async (m) => {
      const [e] = await m.query('SELECT created_by AS "createdBy" FROM calendar_events WHERE tenant_id = $1 AND id = $2', [this.t, eventId]);
      if (!e) throw new NotFoundException('Appointment not found');
      if (e.createdBy !== me && !isAgendaAdmin(identity)) throw new ForbiddenException('Only the organiser or an admin can release rooms and equipment');
      const gone = returned(await m.query('DELETE FROM calendar_event_assets WHERE tenant_id = $1 AND event_id = $2 AND asset_id = $3 RETURNING asset_id', [this.t, eventId, assetId]));
      if (!gone.length) throw new NotFoundException('This room or equipment is not booked for the appointment');
    });
    this.audit.logAction(this.t, me, 'calendar_event.asset_released', { eventId, assetId });
  }

  /** Keeps room and equipment bookings in step when an appointment moves; a clash refuses the move. */
  static async moveBookings(m: EntityManager, tenantId: string, eventId: string, startsAt: Date, endsAt: Date): Promise<void> {
    try {
      await m.query('SAVEPOINT move_assets');
      await m.query(
        `UPDATE calendar_event_assets SET starts_at = $3, ends_at = $4, blocked_until = $4::timestamptz + make_interval(mins => buffer_minutes)
          WHERE tenant_id = $1 AND event_id = $2`,
        [tenantId, eventId, startsAt, endsAt],
      );
    } catch (err) {
      await m.query('ROLLBACK TO SAVEPOINT move_assets');
      if (pgCode(err) === '23P01') throw new ConflictException('A booked room or piece of equipment is not free at the new time; release it or pick another time');
      throw err;
    }
  }

  // Leave and vacation ---------------------------------------------------------------------------------------

  /** Grid data: internal colleagues plus leave in the period. Approved leave is visible to all; pending/rejected to the requester and admins. */
  async leave(from: string, to: string, identity: AuthenticatedUser): Promise<{ employees: unknown[]; requests: unknown[]; canApprove: boolean }> {
    const me = (await this.users.resolveActor(identity)).id;
    const admin = isAgendaAdmin(identity);
    return this.tx.run(async (m) => {
      const employees = await m.query(`SELECT u.id, ${PERSON('u')} AS name FROM users u WHERE u.tenant_id = $1 AND u.is_active AND ${INTERNAL} ORDER BY u.first_name, u.last_name`, [this.t]);
      const requests = await m.query(
        `${LEAVE_SQL} WHERE l.tenant_id = $1 AND l.start_date <= $4::date AND l.end_date >= $3::date AND l.status <> 'cancelled'
            AND (l.status = 'approved' OR l.user_id = $2 OR $5) ORDER BY l.start_date, u.first_name`,
        [this.t, me, from, to, admin],
      );
      return { employees, requests, canApprove: admin };
    });
  }

  /** Everyone requests leave for themselves; an admin may enter it for a colleague, which counts as approved. */
  async requestLeave(input: LeaveInput, identity: AuthenticatedUser): Promise<unknown> {
    const me = (await this.users.resolveActor(identity)).id;
    const admin = isAgendaAdmin(identity);
    const userId = input.userId ?? me;
    if (userId !== me && !admin) throw new ForbiddenException('Only HQ and platform admins can enter leave for a colleague');
    const approved = admin && userId !== me;
    const row = await this.tx.run(async (m) => {
      const [u] = await m.query(`SELECT u.id FROM users u WHERE u.tenant_id = $1 AND u.id = $2 AND u.is_active AND ${INTERNAL}`, [this.t, userId]);
      if (!u) throw new BadRequestException('userId must be an active colleague');
      const [l] = await m.query(
        `INSERT INTO leave_requests (tenant_id, user_id, leave_type, start_date, end_date, note, status, decided_by, decided_at, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [this.t, userId, input.leaveType, input.startDate, input.endDate, input.note, approved ? 'approved' : 'pending', approved ? me : null, approved ? new Date() : null, me],
      );
      if (!approved) {
        const approvers = await m.query(
          `SELECT u.id FROM users u WHERE u.tenant_id = $1 AND u.is_active AND u.id <> $2 AND u.realm_roles && ARRAY['HQ_ADMIN', 'PLATFORM_ADMIN']::text[]`,
          [this.t, me],
        );
        for (const a of approvers) {
          await m.query('INSERT INTO notifications (tenant_id, user_id, title, body, link) VALUES ($1,$2,$3,$4,$5)', [
            this.t, a.id, 'Leave request waiting for approval', `${input.startDate} – ${input.endDate}`, '/calendar?tab=leave',
          ]);
        }
      }
      const [view] = await m.query(`${LEAVE_SQL} WHERE l.tenant_id = $1 AND l.id = $2`, [this.t, l.id]);
      return view;
    });
    this.audit.logAction(this.t, me, 'leave.requested', { leaveId: row.id, userId, status: row.status });
    return row;
  }

  async decideLeave(id: string, decision: (typeof LEAVE_DECISIONS)[number], identity: AuthenticatedUser): Promise<unknown> {
    this.admin(identity, 'approve leave');
    const me = (await this.users.resolveActor(identity)).id;
    const row = await this.tx.run(async (m) => {
      const updated = returned(await m.query(
        `UPDATE leave_requests SET status = $3, decided_by = $4, decided_at = NOW() WHERE tenant_id = $1 AND id = $2 AND status = 'pending' RETURNING user_id`,
        [this.t, id, decision, me],
      ));
      if (!updated.length) throw new ConflictException('Only pending leave requests can be approved or rejected');
      await m.query('INSERT INTO notifications (tenant_id, user_id, title, body, link) VALUES ($1,$2,$3,NULL,$4)', [
        this.t, updated[0].user_id, decision === 'approved' ? 'Your leave was approved' : 'Your leave was not approved', '/calendar?tab=leave',
      ]);
      const [view] = await m.query(`${LEAVE_SQL} WHERE l.tenant_id = $1 AND l.id = $2`, [this.t, id]);
      return view;
    });
    this.audit.logAction(this.t, me, `leave.${decision}`, { leaveId: id });
    return row;
  }

  async cancelLeave(id: string, identity: AuthenticatedUser): Promise<unknown> {
    const me = (await this.users.resolveActor(identity)).id;
    const row = await this.tx.run(async (m) => {
      const [cur] = await m.query('SELECT user_id AS "userId", status FROM leave_requests WHERE tenant_id = $1 AND id = $2', [this.t, id]);
      if (!cur || (cur.userId !== me && !isAgendaAdmin(identity))) throw new NotFoundException('Leave request not found');
      if (cur.status === 'cancelled') throw new ConflictException('This leave request is already cancelled');
      await m.query(`UPDATE leave_requests SET status = 'cancelled' WHERE tenant_id = $1 AND id = $2`, [this.t, id]);
      const [view] = await m.query(`${LEAVE_SQL} WHERE l.tenant_id = $1 AND l.id = $2`, [this.t, id]);
      return view;
    });
    this.audit.logAction(this.t, me, 'leave.cancelled', { leaveId: id });
    return row;
  }

  private async unique<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (pgCode(err) === '23505') throw new ConflictException('A room or piece of equipment with this name already exists');
      throw err;
    }
  }
}
