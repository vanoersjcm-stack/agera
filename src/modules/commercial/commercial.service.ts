import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { AuditService } from '../core/audit/audit.service.js';
import { TenantContext } from '../core/tenancy/tenant-context.service.js';
import { TenantTransaction } from '../core/tenancy/tenant-transaction.service.js';
import { DocumentsService } from '../documents/documents.service.js';
import { UserService } from '../user/user.service.js';

export const TEMPLATE_KINDS = ['proposal', 'agreement', 'letter', 'mail'] as const;
export type TemplateKind = (typeof TEMPLATE_KINDS)[number];

export interface PriceListItemInput { productId: string; unitPrice: string; minQuantity: number }
export interface PriceListInput { name: string; clientId: string | null; validFrom: string | null; validTo: string | null; active?: boolean; items?: PriceListItemInput[] }
export interface TemplateInput { name: string; kind: TemplateKind; body: string; active?: boolean }

/** Placeholders a template body may use; shown in the template editor. */
export const TEMPLATE_PLACEHOLDERS = [
  'client.name', 'client.legalName', 'client.kvk', 'client.vat', 'client.address', 'client.city', 'client.paymentTerms',
  'contact.name', 'contact.firstName', 'contact.email', 'primary_contact_name', 'room.name', 'agreement.title', 'user.name', 'today', 'priceList',
] as const;

const LIST_SQL = `SELECT l.id, l.name, l.client_id AS "clientId", c.name AS "clientName", l.valid_from::text AS "validFrom", l.valid_to::text AS "validTo", l.active,
       (SELECT count(*)::int FROM price_list_items i WHERE i.price_list_id = l.id) AS "itemCount", l.created_at AS "createdAt", l.updated_at AS "updatedAt"
  FROM price_lists l LEFT JOIN clients c ON c.id = l.client_id`;
const TEMPLATE_SQL = `SELECT t.id, t.name, t.kind, t.body, t.active, t.created_at AS "createdAt", t.updated_at AS "updatedAt" FROM document_templates t`;

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
}

@Injectable()
export class CommercialService {
  constructor(
    private readonly context: TenantContext,
    private readonly tx: TenantTransaction,
    private readonly userService: UserService,
    private readonly documents: DocumentsService,
    private readonly audit: AuditService,
  ) {}

  private get t(): string {
    return this.context.tenantId;
  }

  // Price lists ----------------------------------------------------------------------------------------------------

  priceLists(clientId: string | null): Promise<unknown[]> {
    return this.tx.run((m) => m.query(`${LIST_SQL} WHERE l.tenant_id = $1 AND ($2::uuid IS NULL OR l.client_id = $2) ORDER BY l.client_id NULLS FIRST, l.name`, [this.t, clientId]));
  }

  priceList(id: string): Promise<unknown> {
    return this.tx.run((m) => this.loadList(m, id));
  }

  private async loadList(m: EntityManager, id: string): Promise<Record<string, unknown>> {
    const [l] = await m.query(`${LIST_SQL} WHERE l.tenant_id = $1 AND l.id = $2`, [this.t, id]);
    if (!l) throw new NotFoundException('Price list not found');
    l.items = await m.query(
      `SELECT i.id, i.product_id AS "productId", p.sku, p.name AS "productName", p.unit_price::text AS "catalogPrice", i.unit_price::text AS "unitPrice", i.min_quantity AS "minQuantity"
         FROM price_list_items i JOIN products p ON p.id = i.product_id WHERE i.price_list_id = $1 ORDER BY p.name, i.min_quantity`,
      [id],
    );
    return l;
  }

  private async check(m: EntityManager, input: Partial<PriceListInput>): Promise<void> {
    if (input.clientId) {
      const [c] = await m.query('SELECT id FROM clients WHERE tenant_id = $1 AND id = $2', [this.t, input.clientId]);
      if (!c) throw new BadRequestException('clientId is not a client of this organisation');
    }
    if (input.items) {
      const ids = [...new Set(input.items.map((i) => i.productId))];
      const rows = ids.length ? await m.query('SELECT id FROM products WHERE tenant_id = $1 AND id = ANY($2::uuid[])', [this.t, ids]) : [];
      if (rows.length !== ids.length) throw new BadRequestException('productId is not a product of this organisation');
      const keys = input.items.map((i) => `${i.productId}:${i.minQuantity}`);
      if (new Set(keys).size !== keys.length) throw new BadRequestException('each product may appear once per minimum quantity');
    }
  }

  private async replaceItems(m: EntityManager, id: string, items: PriceListItemInput[]): Promise<void> {
    await m.query('DELETE FROM price_list_items WHERE price_list_id = $1', [id]);
    for (const i of items) {
      await m.query('INSERT INTO price_list_items (tenant_id, price_list_id, product_id, unit_price, min_quantity) VALUES ($1,$2,$3,$4,$5)', [this.t, id, i.productId, i.unitPrice, i.minQuantity]);
    }
  }

  async createPriceList(input: PriceListInput, identity: AuthenticatedUser): Promise<unknown> {
    const actor = await this.userService.resolveActor(identity);
    const row = await this.tx.run(async (m) => {
      await this.check(m, input);
      const [l] = await m.query('INSERT INTO price_lists (tenant_id, name, client_id, valid_from, valid_to, active) VALUES ($1,$2,$3,$4,$5,COALESCE($6,true)) RETURNING id', [
        this.t, input.name, input.clientId, input.validFrom, input.validTo, input.active ?? null,
      ]);
      await this.replaceItems(m, l.id, input.items ?? []);
      return this.loadList(m, l.id);
    });
    this.audit.logAction(this.t, actor.id, 'price_list.created', { priceListId: row.id });
    return row;
  }

  async updatePriceList(id: string, input: Partial<PriceListInput>, identity: AuthenticatedUser): Promise<unknown> {
    const actor = await this.userService.resolveActor(identity);
    const row = await this.tx.run(async (m) => {
      await this.loadList(m, id);
      await this.check(m, input);
      const sets: string[] = [];
      const params: unknown[] = [this.t, id];
      const set = (col: string, v: unknown) => (params.push(v), sets.push(`${col} = $${params.length}`));
      if (input.name !== undefined) set('name', input.name);
      if (input.clientId !== undefined) set('client_id', input.clientId);
      if (input.validFrom !== undefined) set('valid_from', input.validFrom);
      if (input.validTo !== undefined) set('valid_to', input.validTo);
      if (input.active !== undefined) set('active', input.active);
      if (sets.length) await m.query(`UPDATE price_lists SET ${sets.join(', ')} WHERE tenant_id = $1 AND id = $2`, params);
      if (input.items) await this.replaceItems(m, id, input.items);
      return this.loadList(m, id);
    });
    this.audit.logAction(this.t, actor.id, 'price_list.updated', { priceListId: id });
    return row;
  }

  // Document templates ---------------------------------------------------------------------------------------------

  templates(includeInactive: boolean): Promise<unknown[]> {
    return this.tx.run((m) => m.query(`${TEMPLATE_SQL} WHERE t.tenant_id = $1 ${includeInactive ? '' : 'AND t.active'} ORDER BY t.kind, t.name`, [this.t]));
  }

  private async loadTemplate(m: EntityManager, id: string): Promise<{ id: string; name: string; kind: string; body: string; active: boolean }> {
    const [t] = await m.query(`${TEMPLATE_SQL} WHERE t.tenant_id = $1 AND t.id = $2`, [this.t, id]);
    if (!t) throw new NotFoundException('Template not found');
    return t;
  }

  template(id: string): Promise<unknown> {
    return this.tx.run((m) => this.loadTemplate(m, id));
  }

  async createTemplate(input: TemplateInput, identity: AuthenticatedUser): Promise<unknown> {
    const actor = await this.userService.resolveActor(identity);
    const row = await this.tx.run(async (m) => {
      const [t] = await m.query('INSERT INTO document_templates (tenant_id, name, kind, body, active, created_by) VALUES ($1,$2,$3,$4,COALESCE($5,true),$6) RETURNING id', [
        this.t, input.name, input.kind, input.body, input.active ?? null, actor.id,
      ]);
      return this.loadTemplate(m, t.id);
    });
    this.audit.logAction(this.t, actor.id, 'document_template.created', { templateId: row.id });
    return row;
  }

  async updateTemplate(id: string, input: Partial<TemplateInput>, identity: AuthenticatedUser): Promise<unknown> {
    const actor = await this.userService.resolveActor(identity);
    const row = await this.tx.run(async (m) => {
      await this.loadTemplate(m, id);
      await m.query(
        `UPDATE document_templates SET name = COALESCE($3, name), kind = COALESCE($4, kind), body = COALESCE($5, body), active = COALESCE($6, active) WHERE tenant_id = $1 AND id = $2`,
        [this.t, id, input.name ?? null, input.kind ?? null, input.body ?? null, input.active ?? null],
      );
      return this.loadTemplate(m, id);
    });
    this.audit.logAction(this.t, actor.id, 'document_template.updated', { templateId: id });
    return row;
  }

  /** Fills a template with the room's client, contact, agreement and price list. Returns plain text. */
  async render(templateId: string, target: { roomId?: string | null; clientId?: string | null }, identity: AuthenticatedUser): Promise<{ name: string; text: string; missing: string[] }> {
    const actor = await this.userService.resolveActor(identity);
    return this.tx.run(async (m) => {
      const tpl = await this.loadTemplate(m, templateId);
      let room: { room_name: string | null; client_id: string | null; agreement_title: string | null } | undefined;
      if (target.roomId) {
        [room] = await m.query(
          'SELECT r.room_name, r.client_id, a.title AS agreement_title FROM digital_sales_rooms r LEFT JOIN agreements a ON a.id = r.agreement_id WHERE r.tenant_id = $1 AND r.id = $2',
          [this.t, target.roomId],
        );
        if (!room) throw new NotFoundException('Client room not found');
      }
      const clientId = room ? room.client_id : (target.clientId ?? null);
      const [client] = clientId
        ? await m.query('SELECT id, name, legal_name, kvk_number, vat_number, address, city, payment_terms FROM clients WHERE tenant_id = $1 AND id = $2', [this.t, clientId])
        : [];
      if (!room && target.clientId && !client) throw new NotFoundException('Client not found');
      const [contact] = client
        ? await m.query(
            `SELECT COALESCE(NULLIF(btrim(concat_ws(' ', first_name, last_name)), ''), email) AS name, first_name, email FROM contacts WHERE tenant_id = $1 AND client_id = $2 ORDER BY is_primary DESC, created_at LIMIT 1`,
            [this.t, client.id],
          )
        : [];
      const [me] = await m.query(`SELECT COALESCE(NULLIF(btrim(concat_ws(' ', first_name, last_name)), ''), email) AS name FROM users WHERE id = $1`, [actor.id]);
      let priceList = '';
      if (client) {
        const items: { name: string; sku: string; price: string; qty: number }[] = await m.query(
          `SELECT p.name, p.sku, i.unit_price::text AS price, i.min_quantity AS qty
             FROM price_lists l JOIN price_list_items i ON i.price_list_id = l.id JOIN products p ON p.id = i.product_id
            WHERE l.tenant_id = $1 AND l.client_id = $2 AND l.active AND (l.valid_from IS NULL OR l.valid_from <= CURRENT_DATE) AND (l.valid_to IS NULL OR l.valid_to >= CURRENT_DATE)
            ORDER BY p.name, i.min_quantity`,
          [this.t, client.id],
        );
        priceList = items.map((i) => `${i.sku}  ${i.name}  EUR ${i.price}${i.qty > 1 ? ` (from ${i.qty})` : ''}`).join('\n');
      }
      const values: Record<string, string | null | undefined> = {
        'client.name': client?.name, 'client.legalName': client?.legal_name, 'client.kvk': client?.kvk_number, 'client.vat': client?.vat_number,
        'client.address': client?.address, 'client.city': client?.city, 'client.paymentTerms': client?.payment_terms,
        'contact.name': contact?.name, 'contact.firstName': contact?.first_name, 'contact.email': contact?.email, primary_contact_name: contact?.name, 'room.name': room?.room_name, 'agreement.title': room?.agreement_title,
        'user.name': me?.name, today: new Date().toISOString().slice(0, 10), priceList: priceList || null,
      };
      const missing = new Set<string>();
      const text = tpl.body.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (all, key: string) => {
        const v = values[key];
        if (v === undefined || v === null || v === '') {
          missing.add(key);
          return `[${key}]`;
        }
        return v;
      });
      return { name: tpl.name, text, missing: [...missing] };
    });
  }

  /** Renders a template and stores it as a new HTML document in the room (normal document versioning). */
  async generate(templateId: string, roomId: string, title: string | null, identity: AuthenticatedUser): Promise<unknown> {
    const r = await this.render(templateId, { roomId }, identity);
    const docTitle = title ?? r.name;
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(docTitle)}</title><style>body{font-family:system-ui,sans-serif;max-width:46rem;margin:2rem auto;line-height:1.5;white-space:pre-wrap}</style></head><body>${escapeHtml(r.text)}</body></html>`;
    return this.documents.upload(roomId, { originalName: `${docTitle}.html`, data: Buffer.from(html, 'utf8') }, docTitle, null, identity);
  }
}
