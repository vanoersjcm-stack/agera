import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { AuditService } from '../core/audit/audit.service.js';
import { TenantContext } from '../core/tenancy/tenant-context.service.js';
import { TenantTransaction } from '../core/tenancy/tenant-transaction.service.js';
import { FinancialsService } from '../financials/financials.service.js';
import { InvoicesService } from '../invoices/invoices.service.js';
import { SalesRoomsService } from '../sales-rooms/sales-rooms.service.js';
import { UserService } from '../user/user.service.js';

export const APPROVAL_ENTITIES = ['financial_plan', 'agreement', 'invoice'] as const;
export type ApprovalEntity = (typeof APPROVAL_ENTITIES)[number];
export const SEVERITIES = ['low', 'medium', 'high'] as const;
export const EXCEPTION_STATUSES = ['open', 'in_progress', 'resolved'] as const;
export type ExceptionStatus = (typeof EXCEPTION_STATUSES)[number];

const PERSON = (a: string) => `COALESCE(NULLIF(btrim(concat_ws(' ', ${a}.first_name, ${a}.last_name)), ''), ${a}.email)`;

export interface ExceptionInput {
  title: string;
  description: string | null;
  severity: (typeof SEVERITIES)[number];
  ownerId: string | null;
  clientContactId: string | null;
  executiveId: string | null;
  storeId: string | null;
  clientId: string | null;
  source: string | null;
}

@Injectable()
export class WorkflowService {
  constructor(
    private readonly context: TenantContext,
    private readonly tx: TenantTransaction,
    private readonly userService: UserService,
    private readonly audit: AuditService,
    private readonly financials: FinancialsService,
    private readonly salesRooms: SalesRoomsService,
    private readonly invoices: InvoicesService,
  ) {}

  private get t(): string {
    return this.context.tenantId;
  }

  private notify(m: EntityManager, userId: string | null, title: string, body: string | null, link: string | null): Promise<unknown> {
    if (!userId) return Promise.resolve();
    return m.query('INSERT INTO notifications (tenant_id, user_id, title, body, link) VALUES ($1,$2,$3,$4,$5)', [this.t, userId, title, body, link]);
  }

  private async assertUsers(m: EntityManager, ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const rows = await m.query('SELECT id FROM users WHERE tenant_id = $1 AND id = ANY($2::uuid[]) AND is_active', [this.t, ids]);
    if (rows.length !== new Set(ids).size) throw new BadRequestException('approvers and owners must be active colleagues in this organisation');
  }

  // Approvals ----------------------------------------------------------------------------------------------------

  private async entity(m: EntityManager, type: ApprovalEntity, id: string): Promise<{ label: string; status: string; link: string }> {
    if (type === 'financial_plan') {
      const [p] = await m.query('SELECT model_name AS label, status FROM financial_models WHERE tenant_id = $1 AND id = $2', [this.t, id]);
      if (!p) throw new BadRequestException('entityId is not a financial plan of this organisation');
      return { label: p.label, status: p.status, link: `/nexus/financial-plans/${id}` };
    }
    if (type === 'invoice') {
      const [i] = await m.query(`SELECT invoice_number AS label, status || '/' || idms_status AS status FROM invoices WHERE tenant_id = $1 AND id = $2`, [this.t, id]);
      if (!i) throw new BadRequestException('entityId is not an invoice of this organisation');
      return { label: i.label, status: i.status, link: `/symphony/invoices?q=${encodeURIComponent(i.label)}` };
    }
    const [a] = await m.query('SELECT title AS label, status FROM agreements WHERE tenant_id = $1 AND id = $2', [this.t, id]);
    if (!a) throw new BadRequestException('entityId is not an agreement of this organisation');
    return { label: a.label, status: a.status, link: `/nexus/agreements/${id}` };
  }

  private async loadApproval(m: EntityManager, id: string): Promise<Record<string, unknown>> {
    const [r] = await m.query(
      `SELECT r.id, r.entity_type AS "entityType", r.entity_id AS "entityId", r.entity_label AS "entityLabel", r.note, r.status,
              r.requested_by AS "requestedById", ${PERSON('u')} AS "requestedByName", r.created_at AS "createdAt", r.decided_at AS "decidedAt"
         FROM approval_requests r LEFT JOIN users u ON u.id = r.requested_by WHERE r.tenant_id = $1 AND r.id = $2`,
      [this.t, id],
    );
    if (!r) throw new NotFoundException('Approval request not found');
    r.steps = await m.query(
      `SELECT s.id, s.step_order AS "stepOrder", s.approver_id AS "approverId", ${PERSON('u')} AS "approverName", s.decision, s.comment, s.decided_at AS "decidedAt"
         FROM approval_steps s JOIN users u ON u.id = s.approver_id WHERE s.request_id = $1 ORDER BY s.step_order`,
      [id],
    );
    const current = (r.steps as { decision: string; approverId: string }[]).find((s) => s.decision === 'pending');
    r.currentApproverId = r.status === 'pending' ? (current?.approverId ?? null) : null;
    return r;
  }

  approvals(filter: { mine: boolean; entityId: string | null; status: string | null }, identity: AuthenticatedUser): Promise<unknown[]> {
    return this.userService.resolveActor(identity).then((actor) =>
      this.tx.run(async (m) => {
        const params: unknown[] = [this.t];
        const where = ['r.tenant_id = $1'];
        if (filter.entityId) where.push(`r.entity_id = $${params.push(filter.entityId)}`);
        if (filter.status) where.push(`r.status = $${params.push(filter.status)}`);
        if (filter.mine) {
          where.push(`r.status = 'pending' AND (SELECT s.approver_id FROM approval_steps s WHERE s.request_id = r.id AND s.decision = 'pending' ORDER BY s.step_order LIMIT 1) = $${params.push(actor.id)}`);
        }
        const ids: { id: string }[] = await m.query(`SELECT r.id FROM approval_requests r WHERE ${where.join(' AND ')} ORDER BY r.created_at DESC LIMIT 100`, params);
        const out = [];
        for (const { id } of ids) out.push(await this.loadApproval(m, id));
        return out;
      }),
    );
  }

  approval(id: string): Promise<unknown> {
    return this.tx.run((m) => this.loadApproval(m, id));
  }

  async requestApproval(type: ApprovalEntity, entityId: string, approverIds: string[], note: string | null, identity: AuthenticatedUser): Promise<unknown> {
    const actor = await this.userService.resolveActor(identity);
    const row = await this.tx.run(async (m) => {
      const e = await this.entity(m, type, entityId);
      const waiting = type === 'financial_plan' ? 'draft' : type === 'invoice' ? 'draft/DRAFT' : 'pending_approval';
      const what = type === 'financial_plan' ? 'draft plans' : type === 'invoice' ? 'draft invoices' : 'agreements awaiting approval';
      if (e.status !== waiting) throw new ConflictException(`Only ${what} can be sent for approval`);
      await this.assertUsers(m, approverIds);
      const [dup] = await m.query(`SELECT id FROM approval_requests WHERE tenant_id = $1 AND entity_id = $2 AND status = 'pending'`, [this.t, entityId]);
      if (dup) throw new ConflictException('An approval request is already pending for this record');
      const [r] = await m.query(
        'INSERT INTO approval_requests (tenant_id, entity_type, entity_id, entity_label, note, requested_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
        [this.t, type, entityId, e.label, note, actor.id],
      );
      if (type === 'invoice') await m.query(`UPDATE invoices SET idms_status = 'IN_REVIEW' WHERE tenant_id = $1 AND id = $2`, [this.t, entityId]);
      let order = 1;
      for (const approver of approverIds) {
        await m.query('INSERT INTO approval_steps (tenant_id, request_id, step_order, approver_id) VALUES ($1,$2,$3,$4)', [this.t, r.id, order++, approver]);
      }
      await this.notify(m, approverIds[0], `Approval requested: ${e.label}`, note, `/symphony/approvals/${r.id}`);
      return this.loadApproval(m, r.id);
    });
    this.audit.logAction(this.t, actor.id, 'approval.requested', { approvalId: row.id, entityType: type, entityId });
    return row;
  }

  /** The current approver decides; the last approval performs the status change through the normal service. */
  async decide(id: string, decision: 'approved' | 'rejected', comment: string | null, identity: AuthenticatedUser): Promise<unknown> {
    const actor = await this.userService.resolveActor(identity);
    const { finished, request } = await this.tx.run(async (m) => {
      const r = await this.loadApproval(m, id);
      if (r.status !== 'pending') throw new ConflictException('This approval request is already decided');
      if (r.currentApproverId !== actor.id) throw new ForbiddenException('It is not your turn to decide on this request');
      if (decision === 'rejected' && !comment) throw new BadRequestException('A comment is required when rejecting');
      await m.query(`UPDATE approval_steps SET decision = $2, comment = $3, decided_at = NOW() WHERE request_id = $1 AND approver_id = $4 AND decision = 'pending'`, [
        id, decision, comment, actor.id,
      ]);
      const steps = r.steps as { approverId: string; decision: string }[];
      const remaining = steps.filter((s) => s.decision === 'pending' && s.approverId !== actor.id);
      const link = `/symphony/approvals/${id}`;
      if (decision === 'rejected') {
        await m.query(`UPDATE approval_requests SET status = 'rejected', decided_at = NOW() WHERE id = $1`, [id]);
        if (r.entityType === 'invoice') await this.reopenInvoice(m, r.entityId as string);
        await this.notify(m, r.requestedById as string, `Rejected: ${r.entityLabel}`, comment, link);
        return { finished: false, request: r };
      }
      if (remaining.length > 0) {
        await this.notify(m, remaining[0].approverId, `Approval requested: ${r.entityLabel}`, `Approved by the previous approver${comment ? `: ${comment}` : ''}`, link);
        return { finished: false, request: r };
      }
      await m.query(`UPDATE approval_requests SET status = 'approved', decided_at = NOW() WHERE id = $1`, [id]);
      await this.notify(m, r.requestedById as string, `Approved: ${r.entityLabel}`, comment, link);
      return { finished: true, request: r };
    });
    if (finished) {
      if (request.entityType === 'financial_plan') await this.financials.updateModelStatus(request.entityId as string, 'approved', identity);
      else if (request.entityType === 'invoice') await this.invoices.finalizeApproved(request.entityId as string, identity);
      else await this.salesRooms.updateAgreementStatus(request.entityId as string, 'active', identity);
    }
    this.audit.logAction(this.t, actor.id, `approval.${decision}`, { approvalId: id, final: finished });
    return this.approval(id);
  }

  /** A rejected or withdrawn invoice goes back from IN_REVIEW to DRAFT so it can be corrected (V32 idms_reopen). */
  private async reopenInvoice(m: EntityManager, invoiceId: string): Promise<void> {
    await m.query(`SELECT set_config('app.idms_reopen', 'on', true)`);
    await m.query(`UPDATE invoices SET idms_status = 'DRAFT' WHERE tenant_id = $1 AND id = $2 AND idms_status = 'IN_REVIEW'`, [this.t, invoiceId]);
    await m.query(`SELECT set_config('app.idms_reopen', 'off', true)`);
  }

  async cancelApproval(id: string, identity: AuthenticatedUser): Promise<unknown> {
    const actor = await this.userService.resolveActor(identity);
    await this.tx.run(async (m) => {
      const r = await this.loadApproval(m, id);
      if (r.status !== 'pending') throw new ConflictException('Only pending requests can be withdrawn');
      if (r.requestedById !== actor.id && !identity.roles.some((x) => x === 'admin' || x === 'platform-admin')) {
        throw new ForbiddenException('Only the requester or an administrator can withdraw this request');
      }
      await m.query(`UPDATE approval_requests SET status = 'cancelled', decided_at = NOW() WHERE id = $1`, [id]);
      if (r.entityType === 'invoice') await this.reopenInvoice(m, r.entityId as string);
    });
    this.audit.logAction(this.t, actor.id, 'approval.cancelled', { approvalId: id });
    return this.approval(id);
  }

  // Exceptions ---------------------------------------------------------------------------------------------------

  private exceptionSql(where: string): string {
    return `SELECT e.id, e.title, e.description, e.severity, e.status, e.owner_id AS "ownerId", ${PERSON('o')} AS "ownerName",
                   e.client_contact_id AS "clientContactId", NULLIF(btrim(concat_ws(' ', cc.first_name, cc.last_name)), '') AS "clientContactName", cc.email AS "clientContactEmail",
                   e.executive_id AS "executiveId", ${PERSON('ex')} AS "executiveName",
                   e.store_id AS "storeId", s.name AS "storeName", e.client_id AS "clientId", c.name AS "clientName", e.source, e.resolution,
                   ${PERSON('cb')} AS "createdByName", e.resolved_at AS "resolvedAt", e.created_at AS "createdAt", e.updated_at AS "updatedAt"
              FROM exceptions e LEFT JOIN users o ON o.id = e.owner_id LEFT JOIN users cb ON cb.id = e.created_by
              LEFT JOIN users ex ON ex.id = e.executive_id LEFT JOIN contacts cc ON cc.id = e.client_contact_id
              LEFT JOIN stores s ON s.id = e.store_id LEFT JOIN clients c ON c.id = e.client_id
             WHERE e.tenant_id = $1 ${where}`;
  }

  exceptions(status: ExceptionStatus | 'unresolved' | null): Promise<unknown[]> {
    return this.tx.run((m) =>
      m.query(
        `${this.exceptionSql(status === 'unresolved' ? `AND e.status <> 'resolved'` : status ? 'AND e.status = $2' : '')}
         ORDER BY (e.status = 'resolved'), CASE e.severity WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, e.created_at DESC LIMIT 300`,
        status && status !== 'unresolved' ? [this.t, status] : [this.t],
      ),
    );
  }

  exception(id: string): Promise<unknown> {
    return this.tx.run(async (m) => {
      const [e] = await m.query(`${this.exceptionSql('AND e.id = $2')}`, [this.t, id]);
      if (!e) throw new NotFoundException('Exception not found');
      return e;
    });
  }

  async createException(input: ExceptionInput, identity: AuthenticatedUser): Promise<unknown> {
    const actor = await this.userService.resolveActor(identity);
    const row = await this.tx.run(async (m) => {
      await this.assertUsers(m, [input.ownerId, input.executiveId].filter((x): x is string => !!x));
      await this.assertContact(m, input.clientContactId, input.clientId);
      const [e] = await m.query(
        `INSERT INTO exceptions (tenant_id, title, description, severity, owner_id, store_id, client_id, source, created_by, client_contact_id, executive_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
        [this.t, input.title, input.description, input.severity, input.ownerId, input.storeId, input.clientId, input.source, actor.id, input.clientContactId, input.executiveId],
      );
      if (input.ownerId && input.ownerId !== actor.id) await this.notify(m, input.ownerId, `Exception assigned to you: ${input.title}`, input.description, `/nexus/exceptions/${e.id}`);
      if (input.executiveId && input.executiveId !== actor.id && input.executiveId !== input.ownerId) {
        await this.notify(m, input.executiveId, `Exception escalation owner: ${input.title}`, input.description, `/nexus/exceptions/${e.id}`);
      }
      const [view] = await m.query(this.exceptionSql('AND e.id = $2'), [this.t, e.id]);
      return view;
    });
    this.audit.logAction(this.t, actor.id, 'exception.created', { exceptionId: row.id });
    return row;
  }

  async updateException(id: string, changes: Partial<ExceptionInput> & { status?: ExceptionStatus; resolution?: string | null }, identity: AuthenticatedUser): Promise<unknown> {
    const actor = await this.userService.resolveActor(identity);
    const row = await this.tx.run(async (m) => {
      const [cur] = await m.query(this.exceptionSql('AND e.id = $2'), [this.t, id]);
      if (!cur) throw new NotFoundException('Exception not found');
      if (changes.ownerId) await this.assertUsers(m, [changes.ownerId]);
      if (changes.executiveId) await this.assertUsers(m, [changes.executiveId]);
      if (changes.clientContactId) await this.assertContact(m, changes.clientContactId, cur.clientId);
      const next = { ...cur, ...changes };
      if (next.status === 'resolved' && !next.resolution?.trim()) throw new BadRequestException('Describe the resolution before resolving');
      await m.query(
        `UPDATE exceptions SET title=$2, description=$3, severity=$4, status=$5, owner_id=$6, resolution=$7, client_contact_id=$8, executive_id=$9,
                resolved_at = CASE WHEN $5::varchar = 'resolved' THEN COALESCE(resolved_at, NOW()) ELSE NULL END WHERE id=$1`,
        [id, next.title, next.description, next.severity, next.status, next.ownerId, next.resolution, next.clientContactId, next.executiveId],
      );
      if (changes.ownerId && changes.ownerId !== cur.ownerId && changes.ownerId !== actor.id) {
        await this.notify(m, changes.ownerId, `Exception assigned to you: ${next.title}`, next.description, `/nexus/exceptions/${id}`);
      }
      if (changes.executiveId && changes.executiveId !== cur.executiveId && changes.executiveId !== actor.id) {
        await this.notify(m, changes.executiveId, `Exception escalation owner: ${next.title}`, next.description, `/nexus/exceptions/${id}`);
      }
      const [view] = await m.query(this.exceptionSql('AND e.id = $2'), [this.t, id]);
      return view;
    });
    this.audit.logAction(this.t, actor.id, 'exception.updated', { exceptionId: id, changes: Object.keys(changes) });
    return row;
  }

  /** The client contact must be a contact of this organisation and, when the exception names a client, of that client. */
  private async assertContact(m: EntityManager, contactId: string | null, clientId: string | null): Promise<void> {
    if (!contactId) return;
    const [c] = await m.query('SELECT client_id FROM contacts WHERE tenant_id = $1 AND id = $2', [this.t, contactId]);
    if (!c) throw new BadRequestException('clientContactId is not a contact of this organisation');
    if (clientId && c.client_id !== clientId) throw new BadRequestException('clientContactId must be a contact of the exception\'s client');
  }

  // Notifications ------------------------------------------------------------------------------------------------

  async notifications(identity: AuthenticatedUser): Promise<{ unread: number; items: unknown[] }> {
    const actor = await this.userService.resolveActor(identity);
    return this.tx.run(async (m) => {
      const items = await m.query(
        'SELECT id, title, body, link, read_at AS "readAt", created_at AS "createdAt" FROM notifications WHERE tenant_id = $1 AND user_id = $2 ORDER BY created_at DESC LIMIT 50',
        [this.t, actor.id],
      );
      const [{ unread }] = await m.query('SELECT count(*)::int AS unread FROM notifications WHERE tenant_id = $1 AND user_id = $2 AND read_at IS NULL', [this.t, actor.id]);
      return { unread, items };
    });
  }

  async markRead(id: string | null, identity: AuthenticatedUser): Promise<void> {
    const actor = await this.userService.resolveActor(identity);
    await this.tx.run((m) =>
      m.query(`UPDATE notifications SET read_at = NOW() WHERE tenant_id = $1 AND user_id = $2 AND read_at IS NULL ${id ? 'AND id = $3' : ''}`, id ? [this.t, actor.id, id] : [this.t, actor.id]),
    );
  }

  // Health and engagement scores ---------------------------------------------------------------------------------

  /**
   * Account health 0–100 per client, from 100 minus: credit locked 40 / under review 15; 10 per overdue invoice (max 30);
   * 15 when an active agreement carries churn risk; 10 per unresolved exception (max 20); 15 when there was no client
   * activity in its active rooms in the last 30 days; 15 when the survey NPS (180 days) is negative, 5 when below 30. Engagement 0–100 per room over 30 days (opened 5, view 3, download 10,
   * comment 10, terms accepted 30).
   */
  health(): Promise<unknown[]> {
    return this.tx.run(async (m) => {
      const rows: Record<string, number | string | null>[] = await m.query(
        `SELECT c.id AS "clientId", c.name, c.credit_status AS "creditStatus",
                (SELECT count(*)::int FROM invoices i WHERE i.tenant_id = c.tenant_id AND i.client_id = c.id AND i.status = 'issued' AND i.due_date < CURRENT_DATE) AS "overdueInvoices",
                (SELECT count(*)::int FROM agreements a WHERE a.tenant_id = c.tenant_id AND a.client_id = c.id AND a.status = 'active' AND a.churn_risk > 0) AS "atRiskAgreements",
                (SELECT count(*)::int FROM exceptions e WHERE e.tenant_id = c.tenant_id AND e.client_id = c.id AND e.status <> 'resolved') AS "openExceptions",
                (SELECT count(*)::int FROM digital_sales_rooms d WHERE d.tenant_id = c.tenant_id AND d.client_id = c.id AND d.status = 'active') AS "activeRooms",
                (SELECT COALESCE(sum(CASE a.activity_type WHEN 'opened' THEN 5 WHEN 'view' THEN 3 WHEN 'download' THEN 10 WHEN 'comment' THEN 10 WHEN 'terms_accepted' THEN 30 ELSE 1 END), 0)::int
                   FROM dsr_activities a JOIN digital_sales_rooms d ON d.id = a.dsr_id
                  WHERE d.tenant_id = c.tenant_id AND d.client_id = c.id AND a.created_at > NOW() - INTERVAL '30 days') AS "engagementPoints",
                (SELECT round(100.0 * (count(*) FILTER (WHERE r.nps_score >= 9) - count(*) FILTER (WHERE r.nps_score <= 6)) / NULLIF(count(r.nps_score), 0))::int
                   FROM survey_responses r WHERE r.tenant_id = c.tenant_id AND r.client_id = c.id AND r.submitted_at > NOW() - INTERVAL '180 days') AS "surveyNps"
           FROM clients c WHERE c.tenant_id = $1 AND c.status = 'active' ORDER BY c.name`,
        [this.t],
      );
      return rows.map((r) => {
        const factors: string[] = [];
        let score = 100;
        const minus = (n: number, why: string) => {
          if (n > 0) (score -= n), factors.push(why);
        };
        minus(r.creditStatus === 'locked' ? 40 : r.creditStatus === 'review_required' ? 15 : 0, r.creditStatus === 'locked' ? 'Credit locked' : 'Credit under review');
        minus(Math.min(30, 10 * (r.overdueInvoices as number)), `${r.overdueInvoices} overdue invoice(s)`);
        minus((r.atRiskAgreements as number) > 0 ? 15 : 0, 'Churn risk on an active agreement');
        minus(Math.min(20, 10 * (r.openExceptions as number)), `${r.openExceptions} open exception(s)`);
        minus((r.activeRooms as number) > 0 && (r.engagementPoints as number) === 0 ? 15 : 0, 'No client activity in 30 days');
        minus(r.surveyNps === null ? 0 : (r.surveyNps as number) < 0 ? 15 : (r.surveyNps as number) < 30 ? 5 : 0, `Survey NPS ${r.surveyNps}`);
        score = Math.max(0, score);
        return { ...r, engagementScore: Math.min(100, r.engagementPoints as number), score, band: score >= 80 ? 'healthy' : score >= 55 ? 'watch' : 'at_risk', factors };
      });
    });
  }

  roomEngagement(roomId: string): Promise<unknown> {
    return this.tx.run(async (m) => {
      const [r] = await m.query(
        `SELECT COALESCE(sum(CASE a.activity_type WHEN 'opened' THEN 5 WHEN 'view' THEN 3 WHEN 'download' THEN 10 WHEN 'comment' THEN 10 WHEN 'terms_accepted' THEN 30 ELSE 1 END), 0)::int AS points,
                count(*)::int AS events, count(DISTINCT a.stakeholder_email)::int AS stakeholders, max(a.created_at) AS "lastActivityAt"
           FROM dsr_activities a WHERE a.tenant_id = $1 AND a.dsr_id = $2 AND a.created_at > NOW() - INTERVAL '30 days'`,
        [this.t, roomId],
      );
      return { roomId, score: Math.min(100, r.points), events: r.events, stakeholders: r.stakeholders, lastActivityAt: r.lastActivityAt };
    });
  }
}
