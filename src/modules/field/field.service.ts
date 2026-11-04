import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { AuditService } from '../core/audit/audit.service.js';
import { TenantContext } from '../core/tenancy/tenant-context.service.js';
import { TenantTransaction } from '../core/tenancy/tenant-transaction.service.js';
import { VisitsService } from '../retailcare/visits.service.js';
import { UserService } from '../user/user.service.js';

export const ORDER_STATUSES = ['draft', 'submitted', 'confirmed', 'delivered', 'cancelled'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];
const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  draft: ['submitted', 'cancelled'],
  submitted: ['confirmed', 'cancelled'],
  confirmed: ['delivered', 'cancelled'],
  delivered: [],
  cancelled: [],
};

const PERSON = (a: string) => `COALESCE(NULLIF(btrim(concat_ws(' ', ${a}.first_name, ${a}.last_name)), ''), ${a}.email)`;

export interface ProductInput { sku: string; name: string; brand: string | null; category: string | null; unitPrice: string; active?: boolean }
export interface PlanogramItemInput { productId: string; expectedFacings: number; shelf: string | null }
export interface PlanogramInput { name: string; category: string | null; storeId: string | null; active?: boolean; items?: PlanogramItemInput[] }
export interface OrderLineInput { productId: string; quantity: number }
export interface OrderInput { storeId: string; visitId: string | null; notes: string | null; lines: OrderLineInput[] }
export interface RoundInput { name: string; checklist: string[]; dueDate: string | null; visitDate: Date; fieldRepId: string | null; storeIds: string[] }

const PRODUCT_SQL = `SELECT p.id, p.sku, p.name, p.brand, p.category, p.unit_price::text AS "unitPrice", p.active, p.created_at AS "createdAt", p.updated_at AS "updatedAt" FROM products p`;

@Injectable()
export class FieldService {
  constructor(
    private readonly context: TenantContext,
    private readonly tx: TenantTransaction,
    private readonly userService: UserService,
    private readonly visits: VisitsService,
    private readonly audit: AuditService,
  ) {}

  private get t(): string {
    return this.context.tenantId;
  }

  private async log(identity: AuthenticatedUser, action: string, details: Record<string, unknown>): Promise<void> {
    const actor = await this.userService.resolveActor(identity);
    this.audit.logAction(this.t, actor.id, action, details);
  }

  // Products -----------------------------------------------------------------------------------------------------

  products(includeInactive: boolean): Promise<unknown[]> {
    return this.tx.run((m) => m.query(`${PRODUCT_SQL} WHERE p.tenant_id = $1 ${includeInactive ? '' : 'AND p.active'} ORDER BY p.category NULLS LAST, p.name`, [this.t]));
  }

  async createProduct(input: ProductInput, identity: AuthenticatedUser): Promise<unknown> {
    const row = await this.tx.run(async (m) => {
      await this.assertSkuFree(m, input.sku, null);
      const [r] = await m.query(
        'INSERT INTO products (tenant_id, sku, name, brand, category, unit_price, active) VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7,true)) RETURNING id',
        [this.t, input.sku, input.name, input.brand, input.category, input.unitPrice, input.active ?? null],
      );
      return (await m.query(`${PRODUCT_SQL} WHERE p.id = $1`, [r.id]))[0];
    });
    await this.log(identity, 'product.created', { productId: row.id });
    return row;
  }

  async updateProduct(id: string, input: Partial<ProductInput>, identity: AuthenticatedUser): Promise<unknown> {
    const row = await this.tx.run(async (m) => {
      const [cur] = await m.query(`${PRODUCT_SQL} WHERE p.tenant_id = $1 AND p.id = $2`, [this.t, id]);
      if (!cur) throw new NotFoundException('Product not found');
      if (input.sku && input.sku !== cur.sku) await this.assertSkuFree(m, input.sku, id);
      const next = { ...cur, ...input };
      await m.query('UPDATE products SET sku=$2, name=$3, brand=$4, category=$5, unit_price=$6, active=$7 WHERE id=$1', [
        id, next.sku, next.name, next.brand, next.category, next.unitPrice, next.active,
      ]);
      return (await m.query(`${PRODUCT_SQL} WHERE p.id = $1`, [id]))[0];
    });
    await this.log(identity, 'product.updated', { productId: id, changes: Object.keys(input) });
    return row;
  }

  private async assertSkuFree(m: EntityManager, sku: string, exceptId: string | null): Promise<void> {
    const [dup] = await m.query('SELECT id FROM products WHERE tenant_id = $1 AND lower(sku) = lower($2) AND id IS DISTINCT FROM $3', [this.t, sku, exceptId]);
    if (dup) throw new ConflictException(`A product with SKU ${sku} already exists`);
  }

  private async assertProducts(m: EntityManager, ids: string[]): Promise<Map<string, { unitPrice: string; name: string }>> {
    const rows: { id: string; unitPrice: string; name: string }[] = ids.length
      ? await m.query('SELECT id, unit_price::text AS "unitPrice", name FROM products WHERE tenant_id = $1 AND id = ANY($2::uuid[])', [this.t, ids])
      : [];
    if (rows.length !== new Set(ids).size) throw new BadRequestException('productId is not a product of this organisation');
    return new Map(rows.map((r) => [r.id, r]));
  }

  private async assertStore(m: EntityManager, storeId: string | null): Promise<void> {
    if (!storeId) return;
    const [s] = await m.query('SELECT id FROM stores WHERE tenant_id = $1 AND id = $2', [this.t, storeId]);
    if (!s) throw new BadRequestException('storeId is not a store of this organisation');
  }

  // Planograms ---------------------------------------------------------------------------------------------------

  planograms(storeId: string | null): Promise<unknown[]> {
    return this.tx.run((m) =>
      m.query(
        `SELECT g.id, g.name, g.category, g.store_id AS "storeId", s.name AS "storeName", g.active,
                (SELECT count(*)::int FROM planogram_items i WHERE i.planogram_id = g.id) AS "itemCount",
                (SELECT COALESCE(sum(i.expected_facings), 0)::int FROM planogram_items i WHERE i.planogram_id = g.id) AS "totalFacings",
                g.updated_at AS "updatedAt"
           FROM planograms g LEFT JOIN stores s ON s.id = g.store_id
          WHERE g.tenant_id = $1 ${storeId ? 'AND g.active AND (g.store_id IS NULL OR g.store_id = $2)' : ''}
          ORDER BY g.name`,
        storeId ? [this.t, storeId] : [this.t],
      ),
    );
  }

  planogram(id: string): Promise<unknown> {
    return this.tx.run((m) => this.loadPlanogram(m, id));
  }

  private async loadPlanogram(m: EntityManager, id: string): Promise<Record<string, unknown>> {
    const [g] = await m.query(
      `SELECT g.id, g.name, g.category, g.store_id AS "storeId", s.name AS "storeName", g.active, g.updated_at AS "updatedAt"
         FROM planograms g LEFT JOIN stores s ON s.id = g.store_id WHERE g.tenant_id = $1 AND g.id = $2`,
      [this.t, id],
    );
    if (!g) throw new NotFoundException('Planogram not found');
    g.items = await m.query(
      `SELECT i.id, i.product_id AS "productId", p.name AS "productName", p.sku, i.expected_facings AS "expectedFacings", i.shelf
         FROM planogram_items i JOIN products p ON p.id = i.product_id WHERE i.planogram_id = $1 ORDER BY i.position, p.name`,
      [id],
    );
    return g;
  }

  private async replaceItems(m: EntityManager, id: string, items: PlanogramItemInput[]): Promise<void> {
    await this.assertProducts(m, items.map((i) => i.productId));
    await m.query('DELETE FROM planogram_items WHERE planogram_id = $1', [id]);
    let pos = 0;
    for (const i of items) {
      await m.query('INSERT INTO planogram_items (tenant_id, planogram_id, product_id, expected_facings, shelf, position) VALUES ($1,$2,$3,$4,$5,$6)', [
        this.t, id, i.productId, i.expectedFacings, i.shelf, pos++,
      ]);
    }
  }

  async createPlanogram(input: PlanogramInput, identity: AuthenticatedUser): Promise<unknown> {
    const row = await this.tx.run(async (m) => {
      await this.assertStore(m, input.storeId);
      const [g] = await m.query('INSERT INTO planograms (tenant_id, name, category, store_id) VALUES ($1,$2,$3,$4) RETURNING id', [this.t, input.name, input.category, input.storeId]);
      await this.replaceItems(m, g.id, input.items ?? []);
      return this.loadPlanogram(m, g.id);
    });
    await this.log(identity, 'planogram.created', { planogramId: row.id });
    return row;
  }

  async updatePlanogram(id: string, input: Partial<PlanogramInput>, identity: AuthenticatedUser): Promise<unknown> {
    const row = await this.tx.run(async (m) => {
      const cur = await this.loadPlanogram(m, id);
      if (input.storeId !== undefined) await this.assertStore(m, input.storeId);
      await m.query('UPDATE planograms SET name=$2, category=$3, store_id=$4, active=$5 WHERE id=$1', [
        id, input.name ?? cur.name, input.category !== undefined ? input.category : cur.category, input.storeId !== undefined ? input.storeId : cur.storeId, input.active ?? cur.active,
      ]);
      if (input.items) await this.replaceItems(m, id, input.items);
      return this.loadPlanogram(m, id);
    });
    await this.log(identity, 'planogram.updated', { planogramId: id });
    return row;
  }

  // Field orders -------------------------------------------------------------------------------------------------

  orders(status: OrderStatus | null, storeId: string | null): Promise<unknown[]> {
    const params: unknown[] = [this.t];
    return this.tx.run((m) =>
      m.query(
        `SELECT o.id, o.store_id AS "storeId", s.name AS "storeName", s.client_id AS "clientId", c.name AS "clientName", o.visit_id AS "visitId",
                o.status, o.notes, ${PERSON('u')} AS "createdByName", o.submitted_at AS "submittedAt", o.created_at AS "createdAt", o.updated_at AS "updatedAt",
                (SELECT count(*)::int FROM field_order_lines l WHERE l.order_id = o.id) AS "lineCount",
                (SELECT COALESCE(sum(l.quantity * l.unit_price), 0)::numeric(14,2)::text FROM field_order_lines l WHERE l.order_id = o.id) AS total
           FROM field_orders o JOIN stores s ON s.id = o.store_id LEFT JOIN clients c ON c.id = s.client_id LEFT JOIN users u ON u.id = o.created_by
          WHERE o.tenant_id = $1 ${status ? `AND o.status = $${params.push(status)}` : ''} ${storeId ? `AND o.store_id = $${params.push(storeId)}` : ''}
          ORDER BY o.created_at DESC LIMIT 200`,
        params,
      ),
    );
  }

  order(id: string): Promise<unknown> {
    return this.tx.run((m) => this.loadOrder(m, id));
  }

  private async loadOrder(m: EntityManager, id: string): Promise<Record<string, unknown>> {
    const [o] = await m.query(
      `SELECT o.id, o.store_id AS "storeId", s.name AS "storeName", s.client_id AS "clientId", c.name AS "clientName", o.visit_id AS "visitId",
              o.status, o.notes, ${PERSON('u')} AS "createdByName", o.submitted_at AS "submittedAt", o.created_at AS "createdAt", o.updated_at AS "updatedAt",
              (SELECT COALESCE(sum(l.quantity * l.unit_price), 0)::numeric(14,2)::text FROM field_order_lines l WHERE l.order_id = o.id) AS total
         FROM field_orders o JOIN stores s ON s.id = o.store_id LEFT JOIN clients c ON c.id = s.client_id LEFT JOIN users u ON u.id = o.created_by
        WHERE o.tenant_id = $1 AND o.id = $2`,
      [this.t, id],
    );
    if (!o) throw new NotFoundException('Field order not found');
    o.lines = await m.query(
      `SELECT l.id, l.product_id AS "productId", p.name AS "productName", p.sku, l.quantity, l.unit_price::text AS "unitPrice",
              (l.quantity * l.unit_price)::numeric(14,2)::text AS "lineTotal"
         FROM field_order_lines l JOIN products p ON p.id = l.product_id WHERE l.order_id = $1 ORDER BY p.name`,
      [id],
    );
    return o;
  }

  private async replaceLines(m: EntityManager, id: string, lines: OrderLineInput[]): Promise<void> {
    const products = await this.assertProducts(m, lines.map((l) => l.productId));
    await m.query('DELETE FROM field_order_lines WHERE order_id = $1', [id]);
    const [order] = await m.query('SELECT s.client_id FROM field_orders o JOIN stores s ON s.id = o.store_id WHERE o.id = $1', [id]);
    for (const l of lines) {
      const [listed] = order?.client_id
        ? await m.query(
            `SELECT i.unit_price::text AS price FROM price_lists pl JOIN price_list_items i ON i.price_list_id = pl.id
              WHERE pl.tenant_id = $1 AND pl.client_id = $2 AND pl.active AND i.product_id = $3 AND i.min_quantity <= $4
                AND (pl.valid_from IS NULL OR pl.valid_from <= CURRENT_DATE) AND (pl.valid_to IS NULL OR pl.valid_to >= CURRENT_DATE)
              ORDER BY i.min_quantity DESC, i.unit_price LIMIT 1`,
            [this.t, order.client_id, l.productId, l.quantity],
          )
        : [];
      await m.query('INSERT INTO field_order_lines (tenant_id, order_id, product_id, quantity, unit_price) VALUES ($1,$2,$3,$4,$5)', [
        this.t, id, l.productId, l.quantity, listed?.price ?? products.get(l.productId)!.unitPrice,
      ]);
    }
  }

  async createOrder(input: OrderInput, identity: AuthenticatedUser): Promise<unknown> {
    const actor = await this.userService.resolveActor(identity);
    const row = await this.tx.run(async (m) => {
      await this.assertStore(m, input.storeId);
      if (input.visitId) {
        const [v] = await m.query('SELECT id FROM merchandising_visits WHERE tenant_id = $1 AND id = $2 AND store_id = $3', [this.t, input.visitId, input.storeId]);
        if (!v) throw new BadRequestException('visitId is not a visit to this store');
      }
      const [o] = await m.query('INSERT INTO field_orders (tenant_id, store_id, visit_id, notes, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id', [
        this.t, input.storeId, input.visitId, input.notes, actor.id,
      ]);
      await this.replaceLines(m, o.id, input.lines);
      return this.loadOrder(m, o.id);
    });
    this.audit.logAction(this.t, actor.id, 'field_order.created', { orderId: row.id });
    return row;
  }

  async updateOrder(id: string, input: { notes?: string | null; lines?: OrderLineInput[] }, identity: AuthenticatedUser): Promise<unknown> {
    const row = await this.tx.run(async (m) => {
      const cur = await this.loadOrder(m, id);
      if (cur.status !== 'draft') throw new ConflictException('Only draft orders can be changed');
      if (input.notes !== undefined) await m.query('UPDATE field_orders SET notes = $2 WHERE id = $1', [id, input.notes]);
      if (input.lines) await this.replaceLines(m, id, input.lines);
      await m.query('UPDATE field_orders SET updated_at = NOW() WHERE id = $1', [id]);
      return this.loadOrder(m, id);
    });
    await this.log(identity, 'field_order.updated', { orderId: id });
    return row;
  }

  async setOrderStatus(id: string, status: OrderStatus, identity: AuthenticatedUser): Promise<unknown> {
    const row = await this.tx.run(async (m) => {
      const cur = await this.loadOrder(m, id);
      const from = cur.status as OrderStatus;
      if (!ORDER_TRANSITIONS[from].includes(status)) throw new ConflictException(`A ${from} order cannot become ${status}`);
      if (status === 'submitted' && (cur.lines as unknown[]).length === 0) throw new ConflictException('Add at least one product before submitting');
      await m.query(`UPDATE field_orders SET status = $2::varchar, submitted_at = CASE WHEN $2::varchar = 'submitted' THEN NOW() ELSE submitted_at END WHERE id = $1`, [id, status]);
      return this.loadOrder(m, id);
    });
    await this.log(identity, 'field_order.status_changed', { orderId: id, to: status });
    return row;
  }

  // Audit rounds -------------------------------------------------------------------------------------------------

  rounds(): Promise<unknown[]> {
    return this.tx.run((m) =>
      m.query(
        `SELECT r.id, r.name, r.checklist, to_char(r.due_date, 'YYYY-MM-DD') AS "dueDate", r.status, ${PERSON('u')} AS "createdByName", r.created_at AS "createdAt",
                count(v.id)::int AS "visitCount",
                count(v.id) FILTER (WHERE v.status = 'COMPLETED')::int AS "completedCount",
                count(v.id) FILTER (WHERE vr.audit_data->>'complianceStatus' IN ('not_compliant', 'needs_follow_up'))::int AS "issueCount"
           FROM audit_rounds r
           LEFT JOIN users u ON u.id = r.created_by
           LEFT JOIN merchandising_visits v ON v.tenant_id = r.tenant_id AND v.audit_round_id = r.id AND v.status <> 'CANCELLED'
           LEFT JOIN visit_reports vr ON vr.visit_id = v.id
          WHERE r.tenant_id = $1
          GROUP BY r.id, u.id ORDER BY r.status, r.due_date NULLS LAST, r.created_at DESC`,
        [this.t],
      ),
    );
  }

  round(id: string): Promise<unknown> {
    return this.tx.run((m) => this.loadRound(m, id));
  }

  private async loadRound(m: EntityManager, id: string): Promise<Record<string, unknown>> {
    const [r] = await m.query(
      `SELECT r.id, r.name, r.checklist, to_char(r.due_date, 'YYYY-MM-DD') AS "dueDate", r.status, ${PERSON('u')} AS "createdByName", r.created_at AS "createdAt"
         FROM audit_rounds r LEFT JOIN users u ON u.id = r.created_by WHERE r.tenant_id = $1 AND r.id = $2`,
      [this.t, id],
    );
    if (!r) throw new NotFoundException('Audit round not found');
    r.visits = await m.query(
      `SELECT v.id, v.store_id AS "storeId", s.name AS "storeName", s.store_code AS "storeCode", v.visit_date AS "visitDate", v.status,
              ${PERSON('u')} AS "fieldRepName", vr.audit_data->>'complianceStatus' AS "complianceStatus", (vr.audit_data->>'planogramScore')::int AS "planogramScore"
         FROM merchandising_visits v JOIN stores s ON s.id = v.store_id LEFT JOIN users u ON u.id = v.field_rep_id LEFT JOIN visit_reports vr ON vr.visit_id = v.id
        WHERE v.tenant_id = $1 AND v.audit_round_id = $2 ORDER BY v.visit_date, s.name`,
      [this.t, id],
    );
    return r;
  }

  /** Creates the round and plans one store visit per store (via the normal visit service, so validation and audit apply). */
  async createRound(input: RoundInput, identity: AuthenticatedUser): Promise<unknown> {
    const actor = await this.userService.resolveActor(identity);
    const roundId = await this.tx.run(async (m) => {
      const stores: { id: string }[] = await m.query('SELECT id FROM stores WHERE tenant_id = $1 AND id = ANY($2::uuid[])', [this.t, input.storeIds]);
      if (stores.length !== new Set(input.storeIds).size) throw new BadRequestException('storeIds must be stores of this organisation');
      const [r] = await m.query('INSERT INTO audit_rounds (tenant_id, name, checklist, due_date, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id', [
        this.t, input.name, JSON.stringify(input.checklist), input.dueDate, actor.id,
      ]);
      return r.id as string;
    });
    const visitIds: string[] = [];
    for (const storeId of new Set(input.storeIds)) {
      const visit = await this.visits.create({ storeId, fieldRepId: input.fieldRepId, workOrderId: null, visitDate: input.visitDate, notes: `Audit round: ${input.name}` }, identity);
      visitIds.push(visit.id);
    }
    const row = await this.tx.run(async (m) => {
      await m.query('UPDATE merchandising_visits SET audit_round_id = $2 WHERE tenant_id = $1 AND id = ANY($3::uuid[])', [this.t, roundId, visitIds]);
      return this.loadRound(m, roundId);
    });
    this.audit.logAction(this.t, actor.id, 'audit_round.created', { roundId, visits: visitIds.length });
    return row;
  }

  async setRoundStatus(id: string, status: 'open' | 'closed', identity: AuthenticatedUser): Promise<unknown> {
    const row = await this.tx.run(async (m) => {
      await this.loadRound(m, id);
      await m.query('UPDATE audit_rounds SET status = $2 WHERE id = $1', [id, status]);
      return this.loadRound(m, id);
    });
    await this.log(identity, status === 'closed' ? 'audit_round.closed' : 'audit_round.reopened', { roundId: id });
    return row;
  }

  /** What a field rep needs while writing a visit report: the audit round checklist and applicable planograms with items. */
  visitContext(visitId: string): Promise<unknown> {
    return this.tx.run(async (m) => {
      const [v] = await m.query('SELECT store_id, audit_round_id FROM merchandising_visits WHERE tenant_id = $1 AND id = $2', [this.t, visitId]);
      if (!v) throw new NotFoundException('Visit not found');
      const [round] = v.audit_round_id ? await m.query('SELECT id, name, checklist FROM audit_rounds WHERE id = $1', [v.audit_round_id]) : [null];
      const ids: { id: string }[] = await m.query('SELECT id FROM planograms WHERE tenant_id = $1 AND active AND (store_id IS NULL OR store_id = $2) ORDER BY store_id NULLS LAST, name', [
        this.t,
        v.store_id,
      ]);
      const planograms = [];
      for (const p of ids) planograms.push(await this.loadPlanogram(m, p.id));
      return { auditRound: round ?? null, planograms };
    });
  }
}
