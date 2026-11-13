import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import type { EntityManager } from 'typeorm';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { AuditService } from '../core/audit/audit.service.js';
import { StorageService } from '../core/storage/storage.service.js';
import { TenantContext } from '../core/tenancy/tenant-context.service.js';
import { TenantTransaction } from '../core/tenancy/tenant-transaction.service.js';
import { IMAGE_EXTENSIONS, type ImageMimeType } from '../retailcare/media/image-type.js';
import { UserService } from '../user/user.service.js';

export const CONTRACT_TYPES = ['fixed', 'flex'] as const;
export const AVAILABILITY = ['available', 'busy', 'on_leave', 'inactive'] as const;
export const SHIFT_DECISIONS = ['approved', 'rejected'] as const;
export const VEHICLE_SIDES = ['front', 'back', 'left', 'right'] as const;
export type VehicleSide = (typeof VEHICLE_SIDES)[number];
export const APPAREL_ITEMS = ['polo', 'jacket', 'trousers', 'cap', 'shoes', 'badge', 'other'] as const;
export const RMA_REASONS = ['damaged', 'defective', 'wrong_delivery', 'expired', 'recall', 'other'] as const;
export const RMA_STATUSES = ['open', 'approved', 'shipped', 'credited', 'rejected'] as const;
export type RmaStatus = (typeof RMA_STATUSES)[number];
/** How goods go back: via the merchandiser/rackjobber, or shipped directly by the store to the vendor/distributor. */
export const RETURN_CHANNELS = ['merchandiser', 'store'] as const;
export type ReturnChannel = (typeof RETURN_CHANNELS)[number];
const RMA_TRANSITIONS: Record<RmaStatus, RmaStatus[]> = {
  open: ['approved', 'rejected'],
  approved: ['shipped', 'rejected'],
  shipped: ['credited'],
  credited: [],
  rejected: [],
};
export const CLAIM_TYPES = ['price_protection', 'damaged', 'expired', 'shrinkage', 'other'] as const;
export const CLAIM_STATUSES = ['submitted', 'approved', 'rejected', 'paid'] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];
const CLAIM_TRANSITIONS: Record<ClaimStatus, ClaimStatus[]> = {
  submitted: ['approved', 'rejected'],
  approved: ['paid'],
  rejected: [],
  paid: [],
};
export const ROTATION_RULES = ['fifo', 'expiry_check', 'none'] as const;
export const PO_CATEGORIES = ['car_rental', 'apparel', 'pos_material'] as const;
export type PoCategory = (typeof PO_CATEGORIES)[number];
export const PO_BILLING = ['client', 'included'] as const;
export type PoBilling = (typeof PO_BILLING)[number];
/** Apparel and POS material are billed to the client separately; car rental is part of the visit price. */
export const DEFAULT_BILLING: Record<PoCategory, PoBilling> = { car_rental: 'included', apparel: 'client', pos_material: 'client' };

/** Clock-ins further than this from the store's coordinates are flagged in the validation queue. */
export const GEOFENCE_RADIUS_M = 250;

const PERSON = (a: string) => `COALESCE(NULLIF(btrim(concat_ws(' ', ${a}.first_name, ${a}.last_name)), ''), ${a}.email)`;

export interface CrewInput {
  userId: string;
  contractType: (typeof CONTRACT_TYPES)[number];
  languages: string[];
  brandCertifications: string[];
  availableDays: number[];
  availability: (typeof AVAILABILITY)[number];
  homeRegion: string | null;
  phone: string | null;
  notes: string | null;
}
export interface Position { lat: number; lng: number }
export interface RackjobInput {
  storeId: string; productId: string | null; visitId: string | null; rmaCaseId: string | null; pickupQty: number; dropoffQty: number;
  rotationRule: (typeof ROTATION_RULES)[number]; priceProtectionEligible: boolean; instructions: string | null;
}
export interface RackjobResult { actualPickupQty: number; actualDropoffQty: number; rotationDone: boolean; notes: string | null }
export interface PoLineInput { category: PoCategory; description: string; quantity: string; unitPrice: string; billing: PoBilling }
export interface PoInput { supplierName: string; clientId: string | null; auditRoundId: string | null; orderDate: string | null; notes: string | null; lines: PoLineInput[] }
export interface PoMatchInput { invoiceNumber: string; invoiceDate: string | null; amount: string }
export interface ShiftEntryInput { userId: string; storeId: string | null; clockInAt: Date; clockOutAt: Date; notes: string | null }
export interface VehicleInput { userId: string; vehicleId: string; description: string | null; allocatedFrom: string | null; allocatedUntil: string | null }
export interface ApparelInput { userId: string; item: (typeof APPAREL_ITEMS)[number]; size: string | null; quantity: number; issuedOn: string | null; notes: string | null }
export interface RmaInput { storeId: string; productId: string | null; clientId: string | null; quantity: number; reason: (typeof RMA_REASONS)[number]; description: string | null; returnChannel: ReturnChannel; trackingReference: string | null }
export interface ClaimInput { storeId: string; productId: string | null; clientId: string | null; claimType: (typeof CLAIM_TYPES)[number]; quantity: number; amount: string; description: string | null; returnChannel: ReturnChannel; trackingReference: string | null }

/** Rows of an UPDATE ... RETURNING (TypeORM returns [rows, affected] for UPDATE on PostgreSQL). */
async function updated(m: EntityManager, sql: string, params: unknown[]): Promise<Record<string, unknown>[]> {
  const result = await m.query(sql, params);
  return Array.isArray(result[0]) ? result[0] : result;
}

/** Great-circle distance in metres (haversine). */
export function distanceMetres(a: Position, b: Position): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * 6_371_000 * Math.asin(Math.sqrt(h)));
}

/** Quotes a CSV cell and defuses spreadsheet formulas. */
function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const SHIFT_SQL = `
  SELECT sl.id, sl.user_id AS "userId", ${PERSON('u')} AS "userName", m.contract_type AS "contractType",
         sl.store_id AS "storeId", s.name AS "storeName", sl.visit_id AS "visitId",
         sl.clock_in_at AS "clockInAt", sl.clock_out_at AS "clockOutAt",
         sl.clock_in_lat::float AS "clockInLat", sl.clock_in_lng::float AS "clockInLng",
         sl.clock_out_lat::float AS "clockOutLat", sl.clock_out_lng::float AS "clockOutLng",
         sl.geofence_distance_m AS "geofenceDistanceM",
         CASE WHEN sl.clock_out_at IS NULL THEN NULL ELSE round(extract(epoch FROM sl.clock_out_at - sl.clock_in_at) / 3600, 2)::float END AS hours,
         sl.validation_status AS "validationStatus", sl.validated_by AS "validatedBy", ${PERSON('v')} AS "validatedByName",
         sl.validated_at AS "validatedAt", sl.rejection_reason AS "rejectionReason", sl.notes, sl.created_at AS "createdAt"
    FROM shift_logs sl
    JOIN users u ON u.id = sl.user_id
    LEFT JOIN merchandisers m ON m.tenant_id = sl.tenant_id AND m.user_id = sl.user_id
    LEFT JOIN stores s ON s.id = sl.store_id
    LEFT JOIN users v ON v.id = sl.validated_by`;

const VEHICLE_SQL = `
  SELECT va.id, va.user_id AS "userId", ${PERSON('u')} AS "userName", va.vehicle_id AS "vehicleId",
         va.vehicle_description AS description, va.allocated_from::text AS "allocatedFrom", va.allocated_until::text AS "allocatedUntil",
         va.status, va.check_completed_at AS "checkCompletedAt", va.odometer_km AS "odometerKm", va.damage_notes AS "damageNotes",
         va.returned_at AS "returnedAt", va.created_at AS "createdAt",
         jsonb_build_object('front', va.photo_front_path IS NOT NULL, 'back', va.photo_back_path IS NOT NULL,
                            'left', va.photo_left_path IS NOT NULL, 'right', va.photo_right_path IS NOT NULL) AS photos
    FROM vehicle_allocations va JOIN users u ON u.id = va.user_id`;

const RMA_SQL = `
  SELECT r.id, r.case_number AS "caseNumber", r.store_id AS "storeId", s.name AS "storeName", r.product_id AS "productId", p.name AS "productName",
         r.client_id AS "clientId", c.name AS "clientName", r.quantity, r.reason, r.status, r.description,
         r.return_channel AS "returnChannel", r.tracking_reference AS "trackingReference",
         r.opened_by AS "openedBy", ${PERSON('u')} AS "openedByName", r.closed_at AS "closedAt", r.created_at AS "createdAt", r.updated_at AS "updatedAt"
    FROM rma_cases r JOIN stores s ON s.id = r.store_id JOIN users u ON u.id = r.opened_by
    LEFT JOIN products p ON p.id = r.product_id LEFT JOIN clients c ON c.id = r.client_id`;

const RACKJOB_SQL = `
  SELECT k.id, k.store_id AS "storeId", s.name AS "storeName", k.product_id AS "productId", p.name AS "productName", p.sku AS "productSku",
         k.visit_id AS "visitId", v.visit_date AS "visitDate", k.rma_case_id AS "rmaCaseId", r.case_number AS "rmaCaseNumber",
         k.pickup_qty AS "pickupQty", k.dropoff_qty AS "dropoffQty", k.rotation_rule AS "rotationRule", k.price_protection_eligible AS "priceProtectionEligible",
         k.instructions, k.status, k.actual_pickup_qty AS "actualPickupQty", k.actual_dropoff_qty AS "actualDropoffQty", k.rotation_done AS "rotationDone",
         k.result_notes AS "resultNotes", ${PERSON('cu')} AS "completedByName", k.completed_at AS "completedAt", ${PERSON('u')} AS "createdByName", k.created_at AS "createdAt"
    FROM rackjob_checks k JOIN stores s ON s.id = k.store_id JOIN users u ON u.id = k.created_by
    LEFT JOIN products p ON p.id = k.product_id LEFT JOIN merchandising_visits v ON v.id = k.visit_id
    LEFT JOIN rma_cases r ON r.id = k.rma_case_id LEFT JOIN users cu ON cu.id = k.completed_by`;

const PO_SQL = `
  SELECT o.id, o.po_number AS "poNumber", o.supplier_name AS "supplierName", o.client_id AS "clientId", c.name AS "clientName",
         o.audit_round_id AS "auditRoundId", ar.name AS "auditRoundName", o.order_date::text AS "orderDate", o.status, o.notes,
         o.supplier_invoice_number AS "supplierInvoiceNumber", o.supplier_invoice_date::text AS "supplierInvoiceDate", o.supplier_invoice_amount::text AS "supplierInvoiceAmount",
         ${PERSON('mu')} AS "matchedByName", o.matched_at AS "matchedAt", ${PERSON('u')} AS "createdByName", o.created_at AS "createdAt",
         COALESCE((SELECT sum(l.line_total) FROM purchase_order_lines l WHERE l.purchase_order_id = o.id), 0)::text AS total,
         COALESCE((SELECT sum(l.line_total) FROM purchase_order_lines l WHERE l.purchase_order_id = o.id AND l.billing = 'client'), 0)::text AS "billableTotal",
         COALESCE((SELECT sum(l.line_total) FROM purchase_order_lines l WHERE l.purchase_order_id = o.id AND l.billing = 'included'), 0)::text AS "includedTotal",
         (o.supplier_invoice_amount - COALESCE((SELECT sum(l.line_total) FROM purchase_order_lines l WHERE l.purchase_order_id = o.id), 0))::text AS variance,
         COALESCE((SELECT json_agg(json_build_object('id', l.id, 'category', l.category, 'description', l.description, 'quantity', l.quantity::text,
                   'unitPrice', l.unit_price::text, 'lineTotal', l.line_total::text, 'billing', l.billing) ORDER BY l.position)
                   FROM purchase_order_lines l WHERE l.purchase_order_id = o.id), '[]') AS lines
    FROM purchase_orders o JOIN users u ON u.id = o.created_by
    LEFT JOIN clients c ON c.id = o.client_id LEFT JOIN audit_rounds ar ON ar.id = o.audit_round_id LEFT JOIN users mu ON mu.id = o.matched_by`;

const CLAIM_SQL = `
  SELECT k.id, k.store_id AS "storeId", s.name AS "storeName", k.product_id AS "productId", p.name AS "productName",
         k.client_id AS "clientId", c.name AS "clientName", k.claim_type AS "claimType", k.quantity, k.amount::text AS amount, k.status,
         k.return_channel AS "returnChannel", k.tracking_reference AS "trackingReference",
         k.description, k.submitted_by AS "submittedBy", ${PERSON('u')} AS "submittedByName", ${PERSON('d')} AS "decidedByName",
         k.decided_at AS "decidedAt", k.created_at AS "createdAt"
    FROM stock_protection_claims k JOIN stores s ON s.id = k.store_id JOIN users u ON u.id = k.submitted_by
    LEFT JOIN users d ON d.id = k.decided_by LEFT JOIN products p ON p.id = k.product_id LEFT JOIN clients c ON c.id = k.client_id`;

@Injectable()
export class OperationsService {
  private readonly apiPrefix: string;

  constructor(
    private readonly context: TenantContext,
    private readonly tx: TenantTransaction,
    private readonly users: UserService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    config: ConfigService,
  ) {
    this.apiPrefix = config.get<string>('apiPrefix') ?? '';
  }

  private get t(): string {
    return this.context.tenantId;
  }

  private async actorId(identity: AuthenticatedUser): Promise<string> {
    return (await this.users.resolveActor(identity)).id;
  }

  private log(actorId: string, action: string, details: Record<string, unknown>): void {
    this.audit.logAction(this.t, actorId, action, details);
  }

  private async assertRow(m: EntityManager, table: 'users' | 'stores' | 'products' | 'clients' | 'merchandising_visits' | 'rma_cases' | 'audit_rounds', id: string | null, label: string): Promise<void> {
    if (!id) return;
    const [row] = await m.query(`SELECT 1 FROM ${table} WHERE tenant_id = $1 AND id = $2`, [this.t, id]);
    if (!row) throw new BadRequestException(`${label} not found in this organisation`);
  }

  // Back-office dashboard ------------------------------------------------------------------------------------------

  async dashboard(): Promise<unknown> {
    return this.tx.run(async (m) => {
      const chains: Record<string, unknown>[] = await m.query(
        `WITH latest AS (
           SELECT DISTINCT ON (v.store_id) v.store_id, r.audit_data->>'complianceStatus' AS compliance
             FROM merchandising_visits v JOIN visit_reports r ON r.visit_id = v.id
            WHERE v.tenant_id = $1 ORDER BY v.store_id, r.updated_at DESC),
         recent AS (
           SELECT v.id, v.store_id, v.status, v.visit_date FROM merchandising_visits v
            WHERE v.tenant_id = $1 AND v.visit_date >= now() - interval '30 days' AND v.visit_date <= now())
         SELECT s.client_id AS "clientId", COALESCE(c.name, '') AS chain,
                count(DISTINCT s.id)::int AS stores,
                count(DISTINCT rv.id)::int AS "visits30",
                count(DISTINCT rv.id) FILTER (WHERE rv.status = 'COMPLETED')::int AS "completed30",
                count(DISTINCT s.id) FILTER (WHERE l.compliance IS NOT NULL AND l.compliance <> 'compliant')::int AS "nonCompliant",
                count(DISTINCT s.id) FILTER (WHERE l.compliance = 'compliant')::int AS compliant,
                (SELECT count(*)::int FROM visit_media vm JOIN merchandising_visits mv ON mv.id = vm.visit_id JOIN stores ss ON ss.id = mv.store_id
                  WHERE vm.tenant_id = $1 AND ss.client_id IS NOT DISTINCT FROM s.client_id AND vm.created_at >= now() - interval '30 days') AS "photos30",
                max(rv.visit_date) AS "lastVisit"
           FROM stores s
           LEFT JOIN clients c ON c.id = s.client_id
           LEFT JOIN latest l ON l.store_id = s.id
           LEFT JOIN recent rv ON rv.store_id = s.id
          WHERE s.tenant_id = $1 AND s.status = 'active'
          GROUP BY s.client_id, c.name
          ORDER BY count(DISTINCT s.id) DESC, c.name`,
        [this.t],
      );
      const [counts] = await m.query(
        `SELECT (SELECT count(*)::int FROM rma_cases WHERE tenant_id = $1 AND status NOT IN ('credited','rejected')) AS "openRma",
                (SELECT count(*)::int FROM stock_protection_claims WHERE tenant_id = $1 AND status IN ('submitted','approved')) AS "openClaims",
                (SELECT count(*)::int FROM shift_logs WHERE tenant_id = $1 AND validation_status = 'pending' AND clock_out_at IS NOT NULL) AS "pendingShifts",
                (SELECT count(*)::int FROM merchandisers WHERE tenant_id = $1 AND availability = 'available') AS "availableCrew"`,
        [this.t],
      );
      const photos: Record<string, unknown>[] = await m.query(
        `SELECT vm.id, vm.visit_id AS "visitId", vm.created_at AS "createdAt", s.id AS "storeId", s.name AS "storeName",
                c.name AS chain, v.visit_date AS "visitDate", ${PERSON('u')} AS "repName"
           FROM visit_media vm JOIN merchandising_visits v ON v.id = vm.visit_id JOIN stores s ON s.id = v.store_id
           LEFT JOIN clients c ON c.id = s.client_id LEFT JOIN users u ON u.id = v.field_rep_id
          WHERE vm.tenant_id = $1 ORDER BY vm.created_at DESC LIMIT 60`,
        [this.t],
      );
      const prefix = this.apiPrefix ? `/${this.apiPrefix}` : '';
      const sum = (k: string) => chains.reduce((n, c) => n + Number(c[k] ?? 0), 0);
      const audited = sum('compliant') + sum('nonCompliant');
      return {
        kpis: {
          chains: chains.filter((c) => c.clientId).length,
          stores: sum('stores'),
          visits30: sum('visits30'),
          completed30: sum('completed30'),
          compliancePercent: audited ? Math.round((sum('compliant') * 100) / audited) : null,
          photos30: sum('photos30'),
          ...counts,
        },
        chains,
        photos: photos.map((p) => ({ ...p, url: `${prefix}/visits/${p.visitId}/media/${p.id}` })),
      };
    });
  }

  // Crew directory -------------------------------------------------------------------------------------------------

  crew(): Promise<unknown[]> {
    return this.tx.run((m) =>
      m.query(
        `SELECT m.id, m.user_id AS "userId", ${PERSON('u')} AS name, u.email, u.is_active AS "isActive", m.contract_type AS "contractType",
                m.languages, m.brand_certifications AS "brandCertifications", m.available_days AS "availableDays", m.availability,
                m.home_region AS "homeRegion", m.phone, m.notes,
                (SELECT count(*)::int FROM merchandising_visits v WHERE v.tenant_id = m.tenant_id AND v.field_rep_id = m.user_id
                    AND v.status IN ('PLANNED','IN_PROGRESS')) AS "openVisits",
                (SELECT va.vehicle_id FROM vehicle_allocations va WHERE va.tenant_id = m.tenant_id AND va.user_id = m.user_id AND va.status <> 'returned'
                  ORDER BY va.created_at DESC LIMIT 1) AS "vehicleId"
           FROM merchandisers m JOIN users u ON u.id = m.user_id
          WHERE m.tenant_id = $1 ORDER BY ${PERSON('u')}`,
        [this.t],
      ),
    );
  }

  async createCrew(input: CrewInput, identity: AuthenticatedUser): Promise<{ id: string }> {
    const actor = await this.actorId(identity);
    const row = await this.tx.run(async (m) => {
      await this.assertRow(m, 'users', input.userId, 'user');
      const [exists] = await m.query('SELECT 1 FROM merchandisers WHERE tenant_id = $1 AND user_id = $2', [this.t, input.userId]);
      if (exists) throw new ConflictException('This person already has a crew profile');
      const [r] = await m.query(
        `INSERT INTO merchandisers (tenant_id, user_id, contract_type, languages, brand_certifications, available_days, availability, home_region, phone, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [this.t, input.userId, input.contractType, input.languages, input.brandCertifications, input.availableDays, input.availability, input.homeRegion, input.phone, input.notes],
      );
      return r as { id: string };
    });
    this.log(actor, 'crew.created', { merchandiserId: row.id, userId: input.userId });
    return row;
  }

  async updateCrew(id: string, input: Partial<Omit<CrewInput, 'userId'>>, identity: AuthenticatedUser): Promise<{ id: string }> {
    const actor = await this.actorId(identity);
    const cols: Record<string, unknown> = {
      contract_type: input.contractType,
      languages: input.languages,
      brand_certifications: input.brandCertifications,
      available_days: input.availableDays,
      availability: input.availability,
      home_region: input.homeRegion,
      phone: input.phone,
      notes: input.notes,
    };
    const set = Object.entries(cols).filter(([, v]) => v !== undefined);
    if (set.length === 0) throw new BadRequestException('Nothing to change');
    await this.tx.run(async (m) => {
      const [r] = await updated(m, 
        `UPDATE merchandisers SET ${set.map(([k], i) => `${k} = $${i + 3}`).join(', ')} WHERE tenant_id = $1 AND id = $2 RETURNING id`,
        [this.t, id, ...set.map(([, v]) => v)],
      );
      if (!r) throw new NotFoundException('Crew profile not found');
    });
    this.log(actor, 'crew.updated', { merchandiserId: id, fields: set.map(([k]) => k) });
    return { id };
  }

  // Shifts and validated hours --------------------------------------------------------------------------------------

  shifts(filter: { status: string | null; from: Date | null; to: Date | null; userId: string | null }): Promise<unknown[]> {
    return this.tx.run((m) =>
      m.query(
        `${SHIFT_SQL}
          WHERE sl.tenant_id = $1 AND ($2::text IS NULL OR sl.validation_status = $2)
            AND ($3::timestamptz IS NULL OR sl.clock_in_at >= $3) AND ($4::timestamptz IS NULL OR sl.clock_in_at < $4)
            AND ($5::uuid IS NULL OR sl.user_id = $5)
          ORDER BY sl.clock_in_at DESC LIMIT 500`,
        [this.t, filter.status, filter.from, filter.to, filter.userId],
      ),
    );
  }

  async myOpenShift(identity: AuthenticatedUser): Promise<unknown | null> {
    const actor = await this.actorId(identity);
    const [row] = await this.tx.run((m) => m.query(`${SHIFT_SQL} WHERE sl.tenant_id = $1 AND sl.user_id = $2 AND sl.clock_out_at IS NULL`, [this.t, actor]));
    return row ?? null;
  }

  private async storePosition(m: EntityManager, storeId: string | null): Promise<Position | null> {
    if (!storeId) return null;
    const [s] = await m.query('SELECT latitude::float AS lat, longitude::float AS lng FROM stores WHERE tenant_id = $1 AND id = $2', [this.t, storeId]);
    if (!s) throw new BadRequestException('store not found in this organisation');
    return s.lat === null || s.lng === null ? null : { lat: s.lat, lng: s.lng };
  }

  async clockIn(input: { storeId: string | null; visitId: string | null; position: Position | null; notes: string | null }, identity: AuthenticatedUser): Promise<unknown> {
    const actor = await this.actorId(identity);
    const id = await this.tx.run(async (m) => {
      const [open] = await m.query('SELECT 1 FROM shift_logs WHERE tenant_id = $1 AND user_id = $2 AND clock_out_at IS NULL', [this.t, actor]);
      if (open) throw new ConflictException('You are already clocked in. Clock out first.');
      let storeId = input.storeId;
      if (input.visitId) {
        const [v] = await m.query('SELECT store_id FROM merchandising_visits WHERE tenant_id = $1 AND id = $2', [this.t, input.visitId]);
        if (!v) throw new BadRequestException('visit not found in this organisation');
        storeId = storeId ?? v.store_id;
      }
      const store = await this.storePosition(m, storeId);
      const distance = store && input.position ? distanceMetres(store, input.position) : null;
      const [r] = await m.query(
        `INSERT INTO shift_logs (tenant_id, user_id, store_id, visit_id, clock_in_at, clock_in_lat, clock_in_lng, geofence_distance_m, notes)
         VALUES ($1,$2,$3,$4,now(),$5,$6,$7,$8) RETURNING id`,
        [this.t, actor, storeId, input.visitId, input.position?.lat ?? null, input.position?.lng ?? null, distance, input.notes],
      );
      return r.id as string;
    });
    this.log(actor, 'shift.clocked_in', { shiftId: id, storeId: input.storeId, visitId: input.visitId });
    return this.shift(id);
  }

  async clockOut(position: Position | null, identity: AuthenticatedUser): Promise<unknown> {
    const actor = await this.actorId(identity);
    const id = await this.tx.run(async (m) => {
      const [r] = await updated(m, 
        `UPDATE shift_logs SET clock_out_at = greatest(now(), clock_in_at + interval '1 second'), clock_out_lat = $3, clock_out_lng = $4
          WHERE tenant_id = $1 AND user_id = $2 AND clock_out_at IS NULL RETURNING id`,
        [this.t, actor, position?.lat ?? null, position?.lng ?? null],
      );
      if (!r) throw new ConflictException('You are not clocked in');
      return r.id as string;
    });
    this.log(actor, 'shift.clocked_out', { shiftId: id });
    return this.shift(id);
  }

  /** A coordinator records hours worked without the app (e.g. a forgotten clock-in). */
  async createShift(input: ShiftEntryInput, identity: AuthenticatedUser): Promise<unknown> {
    const actor = await this.actorId(identity);
    if (input.clockOutAt <= input.clockInAt) throw new BadRequestException('clockOutAt must be after clockInAt');
    if (input.clockOutAt.getTime() - input.clockInAt.getTime() > 24 * 3600 * 1000) throw new BadRequestException('A shift can be at most 24 hours');
    const id = await this.tx.run(async (m) => {
      await this.assertRow(m, 'users', input.userId, 'user');
      await this.assertRow(m, 'stores', input.storeId, 'store');
      const [r] = await m.query(
        `INSERT INTO shift_logs (tenant_id, user_id, store_id, clock_in_at, clock_out_at, notes) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [this.t, input.userId, input.storeId, input.clockInAt, input.clockOutAt, input.notes],
      );
      return r.id as string;
    });
    this.log(actor, 'shift.recorded', { shiftId: id, userId: input.userId });
    return this.shift(id);
  }

  async validateShift(id: string, decision: (typeof SHIFT_DECISIONS)[number], reason: string | null, identity: AuthenticatedUser): Promise<unknown> {
    const actor = await this.actorId(identity);
    if (decision === 'rejected' && !reason) throw new BadRequestException('A reason is required to reject hours');
    await this.tx.run(async (m) => {
      const [s] = await m.query('SELECT user_id, clock_out_at, validation_status FROM shift_logs WHERE tenant_id = $1 AND id = $2 FOR UPDATE', [this.t, id]);
      if (!s) throw new NotFoundException('Shift not found');
      if (!s.clock_out_at) throw new ConflictException('This shift is still running; it can be signed off after clock-out');
      if (s.validation_status !== 'pending') throw new ConflictException('This shift has already been signed off');
      if (s.user_id === actor) throw new ConflictException('You cannot sign off your own hours');
      await m.query(
        `UPDATE shift_logs SET validation_status = $3, validated_by = $4, validated_at = now(), rejection_reason = $5 WHERE tenant_id = $1 AND id = $2`,
        [this.t, id, decision, actor, decision === 'rejected' ? reason : null],
      );
    });
    this.log(actor, decision === 'approved' ? 'shift.approved' : 'shift.rejected', { shiftId: id, reason });
    return this.shift(id);
  }

  private async shift(id: string): Promise<unknown> {
    const [row] = await this.tx.run((m) => m.query(`${SHIFT_SQL} WHERE sl.tenant_id = $1 AND sl.id = $2`, [this.t, id]));
    if (!row) throw new NotFoundException('Shift not found');
    return row;
  }

  /** Approved hours as a semicolon-separated CSV for HR / payroll. */
  async hoursCsv(from: Date, to: Date, identity: AuthenticatedUser): Promise<string> {
    const actor = await this.actorId(identity);
    const rows: Record<string, unknown>[] = await this.tx.run((m) =>
      m.query(
        `SELECT ${PERSON('u')} AS name, u.email, COALESCE(m.contract_type, '') AS contract, to_char(sl.clock_in_at AT TIME ZONE 'Europe/Amsterdam', 'YYYY-MM-DD') AS day,
                COALESCE(s.store_code || ' ' || s.name, '') AS store,
                to_char(sl.clock_in_at AT TIME ZONE 'Europe/Amsterdam', 'HH24:MI') AS clock_in, to_char(sl.clock_out_at AT TIME ZONE 'Europe/Amsterdam', 'HH24:MI') AS clock_out,
                replace(round(extract(epoch FROM sl.clock_out_at - sl.clock_in_at) / 3600, 2)::text, '.', ',') AS hours,
                ${PERSON('v')} AS validated_by, to_char(sl.validated_at AT TIME ZONE 'Europe/Amsterdam', 'YYYY-MM-DD HH24:MI') AS validated_at
           FROM shift_logs sl JOIN users u ON u.id = sl.user_id JOIN users v ON v.id = sl.validated_by
           LEFT JOIN merchandisers m ON m.tenant_id = sl.tenant_id AND m.user_id = sl.user_id
           LEFT JOIN stores s ON s.id = sl.store_id
          WHERE sl.tenant_id = $1 AND sl.validation_status = 'approved' AND sl.clock_in_at >= $2 AND sl.clock_in_at < $3
          ORDER BY name, sl.clock_in_at`,
        [this.t, from, to],
      ),
    );
    const header = ['Employee', 'E-mail', 'Contract', 'Date', 'Store', 'Clock in', 'Clock out', 'Hours', 'Signed off by', 'Signed off at'];
    const lines = rows.map((r) => [r.name, r.email, r.contract, r.day, r.store, r.clock_in, r.clock_out, r.hours, r.validated_by, r.validated_at].map(csvCell).join(';'));
    this.log(actor, 'shift.hours_exported', { from: from.toISOString(), to: to.toISOString(), rows: rows.length });
    return `\uFEFF${[header.join(';'), ...lines].join('\r\n')}\r\n`;
  }

  // Fleet with four-photo pre-trip check ----------------------------------------------------------------------------

  vehicles(): Promise<unknown[]> {
    return this.tx.run((m) => m.query(`${VEHICLE_SQL} WHERE va.tenant_id = $1 ORDER BY va.status = 'returned', va.created_at DESC LIMIT 500`, [this.t]));
  }

  private async vehicle(id: string): Promise<unknown> {
    const [row] = await this.tx.run((m) => m.query(`${VEHICLE_SQL} WHERE va.tenant_id = $1 AND va.id = $2`, [this.t, id]));
    if (!row) throw new NotFoundException('Vehicle allocation not found');
    return row;
  }

  async allocateVehicle(input: VehicleInput, identity: AuthenticatedUser): Promise<unknown> {
    const actor = await this.actorId(identity);
    const id = await this.tx.run(async (m) => {
      await this.assertRow(m, 'users', input.userId, 'user');
      const [busy] = await m.query(`SELECT 1 FROM vehicle_allocations WHERE tenant_id = $1 AND upper(vehicle_id) = upper($2) AND status <> 'returned'`, [this.t, input.vehicleId]);
      if (busy) throw new ConflictException('This vehicle is already allocated. Register its return first.');
      const [r] = await m.query(
        `INSERT INTO vehicle_allocations (tenant_id, user_id, vehicle_id, vehicle_description, allocated_from, allocated_until, created_by)
         VALUES ($1,$2,upper($3),$4,COALESCE($5::date, CURRENT_DATE),$6,$7) RETURNING id`,
        [this.t, input.userId, input.vehicleId, input.description, input.allocatedFrom, input.allocatedUntil, actor],
      );
      return r.id as string;
    });
    this.log(actor, 'vehicle.allocated', { allocationId: id, vehicleId: input.vehicleId, userId: input.userId });
    return this.vehicle(id);
  }

  async uploadVehiclePhoto(id: string, side: VehicleSide, file: { data: Buffer; mimeType: ImageMimeType }, identity: AuthenticatedUser): Promise<unknown> {
    const actor = await this.actorId(identity);
    const path = `${this.t}/vehicles/${id}/${side}-${randomUUID()}.${IMAGE_EXTENSIONS[file.mimeType]}`;
    let previous: string | null = null;
    let written = false;
    try {
      await this.tx.run(async (m) => {
        const [va] = await m.query(`SELECT status, photo_${side}_path AS path FROM vehicle_allocations WHERE tenant_id = $1 AND id = $2 FOR UPDATE`, [this.t, id]);
        if (!va) throw new NotFoundException('Vehicle allocation not found');
        if (va.status !== 'pending_check') throw new ConflictException('The pre-trip check of this allocation is already complete');
        await this.storage.put(path, file.data);
        written = true;
        previous = va.path;
        await m.query(`UPDATE vehicle_allocations SET photo_${side}_path = $3 WHERE tenant_id = $1 AND id = $2`, [this.t, id, path]);
      });
    } catch (error) {
      if (written) await this.storage.delete(path);
      throw error;
    }
    if (previous) await this.storage.delete(previous);
    this.log(actor, 'vehicle.photo_uploaded', { allocationId: id, side });
    return this.vehicle(id);
  }

  async vehiclePhoto(id: string, side: VehicleSide): Promise<{ stream: Readable; mimeType: string }> {
    const [va] = await this.tx.run((m) => m.query(`SELECT photo_${side}_path AS path FROM vehicle_allocations WHERE tenant_id = $1 AND id = $2`, [this.t, id]));
    if (!va?.path) throw new NotFoundException('Photo not found');
    const stream = await this.storage.get(va.path);
    if (!stream) throw new NotFoundException('Photo not found');
    const ext = String(va.path).split('.').pop();
    return { stream, mimeType: ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg' };
  }

  async completeVehicleCheck(id: string, input: { odometerKm: number | null; damageNotes: string | null }, identity: AuthenticatedUser): Promise<unknown> {
    const actor = await this.actorId(identity);
    await this.tx.run(async (m) => {
      const [va] = await m.query(
        `SELECT status, (photo_front_path IS NOT NULL AND photo_back_path IS NOT NULL AND photo_left_path IS NOT NULL AND photo_right_path IS NOT NULL) AS complete
           FROM vehicle_allocations WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
        [this.t, id],
      );
      if (!va) throw new NotFoundException('Vehicle allocation not found');
      if (va.status !== 'pending_check') throw new ConflictException('The pre-trip check of this allocation is already complete');
      if (!va.complete) throw new BadRequestException('All four photos (front, back, left, right) are required before the vehicle can be used');
      await m.query(
        `UPDATE vehicle_allocations SET status = 'active', check_completed_at = now(), odometer_km = $3, damage_notes = $4 WHERE tenant_id = $1 AND id = $2`,
        [this.t, id, input.odometerKm, input.damageNotes],
      );
    });
    this.log(actor, 'vehicle.check_completed', { allocationId: id, odometerKm: input.odometerKm });
    return this.vehicle(id);
  }

  async returnVehicle(id: string, identity: AuthenticatedUser): Promise<unknown> {
    const actor = await this.actorId(identity);
    await this.tx.run(async (m) => {
      const [r] = await updated(m, 
        `UPDATE vehicle_allocations SET status = 'returned', returned_at = now(), allocated_until = COALESCE(allocated_until, GREATEST(CURRENT_DATE, allocated_from))
          WHERE tenant_id = $1 AND id = $2 AND status = 'active' RETURNING id`,
        [this.t, id],
      );
      if (!r) throw new ConflictException('Only an active allocation (pre-trip check done) can be returned');
    });
    this.log(actor, 'vehicle.returned', { allocationId: id });
    return this.vehicle(id);
  }

  // Apparel ---------------------------------------------------------------------------------------------------------

  apparel(): Promise<unknown[]> {
    return this.tx.run((m) =>
      m.query(
        `SELECT a.id, a.user_id AS "userId", ${PERSON('u')} AS "userName", a.item, a.size, a.quantity, a.issued_on::text AS "issuedOn",
                a.returned_on::text AS "returnedOn", a.notes, a.created_at AS "createdAt"
           FROM apparel_assignments a JOIN users u ON u.id = a.user_id
          WHERE a.tenant_id = $1 ORDER BY a.returned_on IS NOT NULL, a.issued_on DESC LIMIT 1000`,
        [this.t],
      ),
    );
  }

  async issueApparel(input: ApparelInput, identity: AuthenticatedUser): Promise<{ id: string }> {
    const actor = await this.actorId(identity);
    const row = await this.tx.run(async (m) => {
      await this.assertRow(m, 'users', input.userId, 'user');
      const [r] = await m.query(
        `INSERT INTO apparel_assignments (tenant_id, user_id, item, size, quantity, issued_on, notes) VALUES ($1,$2,$3,$4,$5,COALESCE($6::date, CURRENT_DATE),$7) RETURNING id`,
        [this.t, input.userId, input.item, input.size, input.quantity, input.issuedOn, input.notes],
      );
      return r as { id: string };
    });
    this.log(actor, 'apparel.issued', { assignmentId: row.id, userId: input.userId, item: input.item, quantity: input.quantity });
    return row;
  }

  async returnApparel(id: string, identity: AuthenticatedUser): Promise<{ id: string }> {
    const actor = await this.actorId(identity);
    await this.tx.run(async (m) => {
      const [r] = await updated(m, 
        `UPDATE apparel_assignments SET returned_on = GREATEST(CURRENT_DATE, issued_on) WHERE tenant_id = $1 AND id = $2 AND returned_on IS NULL RETURNING id`,
        [this.t, id],
      );
      if (!r) throw new ConflictException('This item was already returned or does not exist');
    });
    this.log(actor, 'apparel.returned', { assignmentId: id });
    return { id };
  }

  // RMA cases -------------------------------------------------------------------------------------------------------

  rmaCases(): Promise<unknown[]> {
    return this.tx.run((m) => m.query(`${RMA_SQL} WHERE r.tenant_id = $1 ORDER BY r.created_at DESC LIMIT 500`, [this.t]));
  }

  async openRma(input: RmaInput, identity: AuthenticatedUser): Promise<unknown> {
    const actor = await this.actorId(identity);
    const id = await this.tx.run(async (m) => {
      await this.assertRow(m, 'stores', input.storeId, 'store');
      await this.assertRow(m, 'products', input.productId, 'product');
      await this.assertRow(m, 'clients', input.clientId, 'client');
      await m.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`rma:${this.t}`]);
      const year = new Date().getFullYear();
      const [{ n }] = await m.query(`SELECT count(*)::int + 1 AS n FROM rma_cases WHERE tenant_id = $1 AND case_number LIKE $2`, [this.t, `RMA-${year}-%`]);
      const [r] = await m.query(
        `INSERT INTO rma_cases (tenant_id, case_number, store_id, product_id, client_id, quantity, reason, description, opened_by, return_channel, tracking_reference)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
        [this.t, `RMA-${year}-${String(n).padStart(4, '0')}`, input.storeId, input.productId, input.clientId, input.quantity, input.reason, input.description, actor, input.returnChannel, input.trackingReference],
      );
      return r.id as string;
    });
    this.log(actor, 'rma.opened', { rmaId: id, storeId: input.storeId, reason: input.reason, returnChannel: input.returnChannel });
    return this.rma(id);
  }

  async setRmaStatus(id: string, status: RmaStatus, identity: AuthenticatedUser): Promise<unknown> {
    const actor = await this.actorId(identity);
    const from = await this.tx.run(async (m) => {
      const [r] = await m.query('SELECT status FROM rma_cases WHERE tenant_id = $1 AND id = $2 FOR UPDATE', [this.t, id]);
      if (!r) throw new NotFoundException('RMA case not found');
      if (!RMA_TRANSITIONS[r.status as RmaStatus].includes(status)) throw new ConflictException(`An RMA case cannot go from ${r.status} to ${status}`);
      await m.query(
        `UPDATE rma_cases SET status = $3::varchar, closed_at = CASE WHEN $3::varchar IN ('credited','rejected') THEN now() ELSE NULL END WHERE tenant_id = $1 AND id = $2`,
        [this.t, id, status],
      );
      return r.status as string;
    });
    this.log(actor, 'rma.status_changed', { rmaId: id, from, to: status });
    return this.rma(id);
  }

  private async rma(id: string): Promise<unknown> {
    const [row] = await this.tx.run((m) => m.query(`${RMA_SQL} WHERE r.tenant_id = $1 AND r.id = $2`, [this.t, id]));
    if (!row) throw new NotFoundException('RMA case not found');
    return row;
  }

  // Stock-protection claims -----------------------------------------------------------------------------------------

  claims(): Promise<unknown[]> {
    return this.tx.run((m) => m.query(`${CLAIM_SQL} WHERE k.tenant_id = $1 ORDER BY k.created_at DESC LIMIT 500`, [this.t]));
  }

  async submitClaim(input: ClaimInput, identity: AuthenticatedUser): Promise<unknown> {
    const actor = await this.actorId(identity);
    const id = await this.tx.run(async (m) => {
      await this.assertRow(m, 'stores', input.storeId, 'store');
      await this.assertRow(m, 'products', input.productId, 'product');
      await this.assertRow(m, 'clients', input.clientId, 'client');
      const [r] = await m.query(
        `INSERT INTO stock_protection_claims (tenant_id, store_id, product_id, client_id, claim_type, quantity, amount, description, submitted_by, return_channel, tracking_reference)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
        [this.t, input.storeId, input.productId, input.clientId, input.claimType, input.quantity, input.amount, input.description, actor, input.returnChannel, input.trackingReference],
      );
      return r.id as string;
    });
    this.log(actor, 'stock_claim.submitted', { claimId: id, storeId: input.storeId, claimType: input.claimType, amount: input.amount, returnChannel: input.returnChannel });
    return this.claim(id);
  }

  async setClaimStatus(id: string, status: ClaimStatus, identity: AuthenticatedUser): Promise<unknown> {
    const actor = await this.actorId(identity);
    const from = await this.tx.run(async (m) => {
      const [r] = await m.query('SELECT status, submitted_by FROM stock_protection_claims WHERE tenant_id = $1 AND id = $2 FOR UPDATE', [this.t, id]);
      if (!r) throw new NotFoundException('Claim not found');
      if (!CLAIM_TRANSITIONS[r.status as ClaimStatus].includes(status)) throw new ConflictException(`A claim cannot go from ${r.status} to ${status}`);
      if (r.status === 'submitted' && r.submitted_by === actor) throw new ConflictException('You cannot decide on a claim you submitted yourself');
      await m.query(
        `UPDATE stock_protection_claims SET status = $3, decided_by = COALESCE(decided_by, $4), decided_at = COALESCE(decided_at, now()) WHERE tenant_id = $1 AND id = $2`,
        [this.t, id, status, actor],
      );
      return r.status as string;
    });
    this.log(actor, 'stock_claim.status_changed', { claimId: id, from, to: status });
    return this.claim(id);
  }

  private async claim(id: string): Promise<unknown> {
    const [row] = await this.tx.run((m) => m.query(`${CLAIM_SQL} WHERE k.tenant_id = $1 AND k.id = $2`, [this.t, id]));
    if (!row) throw new NotFoundException('Claim not found');
    return row;
  }

  // Rackjobbing checklists ------------------------------------------------------------------------------------------

  rackjobChecks(): Promise<unknown[]> {
    return this.tx.run((m) => m.query(`${RACKJOB_SQL} WHERE k.tenant_id = $1 ORDER BY (k.status = 'done'), k.created_at DESC LIMIT 500`, [this.t]));
  }

  async createRackjobCheck(input: RackjobInput, identity: AuthenticatedUser): Promise<unknown> {
    const actor = await this.actorId(identity);
    const id = await this.tx.run(async (m) => {
      await this.assertRow(m, 'stores', input.storeId, 'store');
      await this.assertRow(m, 'products', input.productId, 'product');
      await this.assertRow(m, 'merchandising_visits', input.visitId, 'store visit');
      await this.assertRow(m, 'rma_cases', input.rmaCaseId, 'return case');
      const [r] = await m.query(
        `INSERT INTO rackjob_checks (tenant_id, store_id, product_id, visit_id, rma_case_id, pickup_qty, dropoff_qty, rotation_rule, price_protection_eligible, instructions, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
        [this.t, input.storeId, input.productId, input.visitId, input.rmaCaseId, input.pickupQty, input.dropoffQty, input.rotationRule, input.priceProtectionEligible, input.instructions, actor],
      );
      return r.id as string;
    });
    this.log(actor, 'rackjob_check.created', { checkId: id, storeId: input.storeId, productId: input.productId, pickupQty: input.pickupQty, dropoffQty: input.dropoffQty });
    return this.rackjobCheck(id);
  }

  async completeRackjobCheck(id: string, result: RackjobResult, identity: AuthenticatedUser): Promise<unknown> {
    const actor = await this.actorId(identity);
    await this.tx.run(async (m) => {
      const [k] = await m.query('SELECT status FROM rackjob_checks WHERE tenant_id = $1 AND id = $2 FOR UPDATE', [this.t, id]);
      if (!k) throw new NotFoundException('Rackjobbing checklist not found');
      if (k.status === 'done') throw new ConflictException('This checklist is already completed');
      await m.query(
        `UPDATE rackjob_checks SET status = 'done', actual_pickup_qty = $3, actual_dropoff_qty = $4, rotation_done = $5, result_notes = $6, completed_by = $7, completed_at = now()
          WHERE tenant_id = $1 AND id = $2`,
        [this.t, id, result.actualPickupQty, result.actualDropoffQty, result.rotationDone, result.notes, actor],
      );
    });
    this.log(actor, 'rackjob_check.completed', { checkId: id, ...result });
    return this.rackjobCheck(id);
  }

  private async rackjobCheck(id: string): Promise<unknown> {
    const [row] = await this.tx.run((m) => m.query(`${RACKJOB_SQL} WHERE k.tenant_id = $1 AND k.id = $2`, [this.t, id]));
    if (!row) throw new NotFoundException('Rackjobbing checklist not found');
    return row;
  }

  // Procurement & purchase orders -----------------------------------------------------------------------------------

  purchaseOrders(): Promise<unknown[]> {
    return this.tx.run((m) => m.query(`${PO_SQL} WHERE o.tenant_id = $1 ORDER BY (o.status IN ('matched','cancelled')), o.created_at DESC LIMIT 500`, [this.t]));
  }

  async createPurchaseOrder(input: PoInput, identity: AuthenticatedUser): Promise<unknown> {
    const actor = await this.actorId(identity);
    const id = await this.tx.run(async (m) => {
      await this.assertRow(m, 'clients', input.clientId, 'client');
      await this.assertRow(m, 'audit_rounds', input.auditRoundId, 'campaign or audit round');
      if (!input.clientId && input.lines.some((l) => l.billing === 'client')) throw new BadRequestException('Choose the client to bill for lines that are billed separately to the client');
      await m.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`po:${this.t}`]);
      const year = new Date().getFullYear();
      const [{ n }] = await m.query(
        `SELECT COALESCE(max(substring(po_number from 9)::int), 0) + 1 AS n FROM purchase_orders WHERE tenant_id = $1 AND po_number ~ $2`,
        [this.t, `^PO-${year}-[0-9]{4,}$`],
      );
      const [o] = await m.query(
        `INSERT INTO purchase_orders (tenant_id, po_number, supplier_name, client_id, audit_round_id, order_date, notes, created_by)
         VALUES ($1,$2,$3,$4,$5,COALESCE($6::date, CURRENT_DATE),$7,$8) RETURNING id`,
        [this.t, `PO-${year}-${String(n).padStart(4, '0')}`, input.supplierName, input.clientId, input.auditRoundId, input.orderDate, input.notes, actor],
      );
      for (const [i, l] of input.lines.entries()) {
        await m.query(
          `INSERT INTO purchase_order_lines (tenant_id, purchase_order_id, position, category, description, quantity, unit_price, billing) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [this.t, o.id, i, l.category, l.description, l.quantity, l.unitPrice, l.billing],
        );
      }
      return o.id as string;
    });
    this.log(actor, 'purchase_order.created', { purchaseOrderId: id, supplier: input.supplierName, lines: input.lines.length });
    return this.purchaseOrder(id);
  }

  /** Matches a supplier invoice: equal to the order total (to the cent) = matched, otherwise disputed with the variance shown. */
  async matchPurchaseOrder(id: string, input: PoMatchInput, identity: AuthenticatedUser): Promise<unknown> {
    const actor = await this.actorId(identity);
    const status = await this.tx.run(async (m) => {
      const [o] = await m.query(
        `SELECT o.status, COALESCE((SELECT sum(line_total) FROM purchase_order_lines WHERE purchase_order_id = o.id), 0)::text AS total
           FROM purchase_orders o WHERE o.tenant_id = $1 AND o.id = $2 FOR UPDATE`,
        [this.t, id],
      );
      if (!o) throw new NotFoundException('Purchase order not found');
      if (o.status !== 'open' && o.status !== 'disputed') throw new ConflictException(`A ${o.status} purchase order cannot be matched`);
      const next = Math.round(Number(input.amount) * 100) === Math.round(Number(o.total) * 100) ? 'matched' : 'disputed';
      await m.query(
        `UPDATE purchase_orders SET status = $3, supplier_invoice_number = $4, supplier_invoice_date = $5::date, supplier_invoice_amount = $6, matched_by = $7, matched_at = now()
          WHERE tenant_id = $1 AND id = $2`,
        [this.t, id, next, input.invoiceNumber, input.invoiceDate, input.amount, actor],
      );
      return next;
    });
    this.log(actor, 'purchase_order.invoice_matched', { purchaseOrderId: id, invoiceNumber: input.invoiceNumber, amount: input.amount, result: status });
    return this.purchaseOrder(id);
  }

  async cancelPurchaseOrder(id: string, identity: AuthenticatedUser): Promise<unknown> {
    const actor = await this.actorId(identity);
    await this.tx.run(async (m) => {
      const [o] = await m.query('SELECT status FROM purchase_orders WHERE tenant_id = $1 AND id = $2 FOR UPDATE', [this.t, id]);
      if (!o) throw new NotFoundException('Purchase order not found');
      if (o.status !== 'open') throw new ConflictException('Only open purchase orders can be cancelled');
      await m.query(`UPDATE purchase_orders SET status = 'cancelled' WHERE tenant_id = $1 AND id = $2`, [this.t, id]);
    });
    this.log(actor, 'purchase_order.cancelled', { purchaseOrderId: id });
    return this.purchaseOrder(id);
  }

  private async purchaseOrder(id: string): Promise<unknown> {
    const [row] = await this.tx.run((m) => m.query(`${PO_SQL} WHERE o.tenant_id = $1 AND o.id = $2`, [this.t, id]));
    if (!row) throw new NotFoundException('Purchase order not found');
    return row;
  }
}
