import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { AuditService } from '../core/audit/audit.service.js';
import { TenantContext } from '../core/tenancy/tenant-context.service.js';
import { TenantTransaction } from '../core/tenancy/tenant-transaction.service.js';
import { enterpriseRequired, licenseTier } from '../core/tenancy/license.js';
import { UserService } from '../user/user.service.js';

export const QUESTION_TYPES = ['nps', 'csat', 'rating', 'single_choice', 'multi_choice', 'text'] as const;
export const VANGUARD_TYPES: readonly QuestionType[] = ['nps', 'csat', 'text'];
export const STATUSES = ['draft', 'active', 'closed', 'archived'] as const;
export const VANGUARD_MAX_ACTIVE = 3;
export type QuestionType = (typeof QUESTION_TYPES)[number];
export type SurveyStatus = (typeof STATUSES)[number];

export interface Question {
  id: string;
  type: QuestionType;
  label: string;
  required: boolean;
  options?: string[];
  minRating?: number;
  maxRating?: number;
  /** Branching (Enterprise): only shown when an earlier question has this answer. */
  showIf?: { questionId: string; equals: string } | null;
}
export interface SurveyInput { title: string; description: string | null; questions: Question[] }
export interface Audience {
  targetType: 'single_client' | 'client_cohort' | 'client_room';
  clientId?: string | null;
  clientRoomId?: string | null;
  all?: boolean;
  sector?: string | null;
  minArr?: number | null;
  maxArr?: number | null;
  accountManagerId?: string | null;
  maxHealthScore?: number | null;
}
export type Answers = Record<string, string | number | string[]>;

const TRANSITIONS: Record<SurveyStatus, SurveyStatus[]> = {
  draft: ['active', 'archived'],
  active: ['closed'],
  closed: ['active', 'archived'],
  archived: [],
};

const SQL = `SELECT s.id, s.title, s.description, s.status, s.questions, s.created_at AS "createdAt", s.updated_at AS "updatedAt",
       u.first_name || COALESCE(' ' || u.last_name, '') AS "createdByName",
       (SELECT count(*)::int FROM survey_responses r WHERE r.survey_id = s.id) AS "responseCount",
       (SELECT count(DISTINCT c.client_id)::int FROM survey_dispatch_clients c WHERE c.survey_id = s.id) AS "targetedClients",
       (SELECT count(*)::int FROM survey_dispatches d WHERE d.survey_id = s.id) AS "dispatchCount",
       (SELECT round(100.0 * (count(*) FILTER (WHERE r.nps_score >= 9) - count(*) FILTER (WHERE r.nps_score <= 6)) / NULLIF(count(r.nps_score), 0))::int
          FROM survey_responses r WHERE r.survey_id = s.id) AS nps
  FROM surveys s LEFT JOIN users u ON u.id = s.created_by`;

export function npsOf(scores: number[]): { score: number | null; promoters: number; passives: number; detractors: number; count: number } {
  const promoters = scores.filter((s) => s >= 9).length;
  const detractors = scores.filter((s) => s <= 6).length;
  const count = scores.length;
  return { score: count ? Math.round((100 * (promoters - detractors)) / count) : null, promoters, passives: count - promoters - detractors, detractors, count };
}

function range(q: Question): [number, number] {
  if (q.type === 'nps') return [0, 10];
  if (q.type === 'csat') return [1, 5];
  return [q.minRating ?? 1, q.maxRating ?? 5];
}

/** Whether a question is shown, given the answers to earlier questions (branching). */
export function visible(q: Question, answers: Answers): boolean {
  if (!q.showIf) return true;
  const a = answers[q.showIf.questionId];
  if (a === undefined) return false;
  return Array.isArray(a) ? a.includes(q.showIf.equals) : String(a) === q.showIf.equals;
}

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? '' : Array.isArray(v) ? v.join('; ') : String(v);
  return /[",\n\r;]/.test(s) || /^[=+\-@]/.test(s) ? `"${(/^[=+\-@]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"` : s;
}

@Injectable()
export class SurveysService {
  constructor(
    private readonly context: TenantContext,
    private readonly tx: TenantTransaction,
    private readonly userService: UserService,
    private readonly audit: AuditService,
  ) {}

  private get t(): string {
    return this.context.tenantId;
  }

  private async tier(m: EntityManager) {
    return licenseTier(m, this.context.tenant);
  }

  // Management -----------------------------------------------------------------------------------------------------

  async list(): Promise<unknown> {
    return this.tx.run(async (m) => {
      const tier = await this.tier(m);
      const items = await m.query(`${SQL} WHERE s.tenant_id = $1 ORDER BY CASE s.status WHEN 'active' THEN 0 WHEN 'draft' THEN 1 WHEN 'closed' THEN 2 ELSE 3 END, s.updated_at DESC`, [this.t]);
      return {
        tier,
        maxActive: tier === 'vanguard' ? VANGUARD_MAX_ACTIVE : null,
        activeCount: items.filter((s: { status: string }) => s.status === 'active').length,
        questionTypes: tier === 'vanguard' ? VANGUARD_TYPES : QUESTION_TYPES,
        items,
      };
    });
  }

  private async load(m: EntityManager, id: string): Promise<Record<string, unknown> & { status: SurveyStatus; questions: Question[]; title: string }> {
    const [s] = await m.query(`${SQL} WHERE s.tenant_id = $1 AND s.id = $2`, [this.t, id]);
    if (!s) throw new NotFoundException('Survey not found');
    return s;
  }

  async get(id: string): Promise<unknown> {
    return this.tx.run(async (m) => {
      const s = await this.load(m, id);
      s.dispatches = await m.query(
        `SELECT d.id, d.target_type AS "targetType", d.client_id AS "clientId", c.name AS "clientName", d.client_room_id AS "clientRoomId", r.room_name AS "clientRoomName",
                d.filter_criteria AS "filterCriteria", d.total_targeted AS "totalTargeted", d.total_contacts AS "totalContacts", d.created_at AS "createdAt",
                u.first_name || COALESCE(' ' || u.last_name, '') AS "dispatchedByName",
                (SELECT count(*)::int FROM survey_responses x WHERE x.dispatch_id = d.id) AS "totalResponded"
           FROM survey_dispatches d LEFT JOIN clients c ON c.id = d.client_id LEFT JOIN digital_sales_rooms r ON r.id = d.client_room_id LEFT JOIN users u ON u.id = d.dispatched_by
          WHERE d.tenant_id = $1 AND d.survey_id = $2 ORDER BY d.created_at DESC`,
        [this.t, id],
      );
      return s;
    });
  }

  /** Vanguard: NPS, CSAT and open text only, no branching. */
  private async checkQuestions(m: EntityManager, questions: Question[]): Promise<void> {
    if ((await this.tier(m)) !== 'vanguard') return;
    if (questions.some((q) => q.showIf)) throw enterpriseRequired('Branching survey questions');
    const advanced = questions.find((q) => !VANGUARD_TYPES.includes(q.type));
    if (advanced) throw enterpriseRequired(`The question type "${advanced.type}"`);
  }

  async create(input: SurveyInput, identity: AuthenticatedUser): Promise<unknown> {
    const actor = await this.userService.resolveActor(identity);
    const row = await this.tx.run(async (m) => {
      await this.checkQuestions(m, input.questions);
      const [s] = await m.query('INSERT INTO surveys (tenant_id, title, description, questions, created_by) VALUES ($1,$2,$3,$4::jsonb,$5) RETURNING id', [
        this.t, input.title, input.description, JSON.stringify(input.questions), actor.id,
      ]);
      return this.load(m, s.id);
    });
    this.audit.logAction(this.t, actor.id, 'survey.created', { surveyId: row.id, title: row.title });
    return row;
  }

  async update(id: string, input: Partial<SurveyInput>, identity: AuthenticatedUser): Promise<unknown> {
    const actor = await this.userService.resolveActor(identity);
    const row = await this.tx.run(async (m) => {
      const current = await this.load(m, id);
      if (input.questions) {
        if (current.status !== 'draft') throw new ConflictException('Questions can only be changed while the survey is a draft');
        await this.checkQuestions(m, input.questions);
      }
      await m.query(
        `UPDATE surveys SET title = COALESCE($3, title), description = CASE WHEN $4::boolean THEN $5 ELSE description END, questions = COALESCE($6::jsonb, questions)
          WHERE tenant_id = $1 AND id = $2`,
        [this.t, id, input.title ?? null, input.description !== undefined, input.description ?? null, input.questions ? JSON.stringify(input.questions) : null],
      );
      return this.load(m, id);
    });
    this.audit.logAction(this.t, actor.id, 'survey.updated', { surveyId: id });
    return row;
  }

  async setStatus(id: string, status: SurveyStatus, identity: AuthenticatedUser): Promise<unknown> {
    const actor = await this.userService.resolveActor(identity);
    const row = await this.tx.run(async (m) => {
      const s = await this.load(m, id);
      if (s.status === status) return s;
      if (!TRANSITIONS[s.status].includes(status)) throw new ConflictException(`A ${s.status} survey cannot become ${status}`);
      if (status === 'active') {
        if (s.questions.length === 0) throw new BadRequestException('Add at least one question before activating the survey');
        await this.checkQuestions(m, s.questions);
        if ((await this.tier(m)) === 'vanguard') {
          const [{ n }] = await m.query(`SELECT count(*)::int AS n FROM surveys WHERE tenant_id = $1 AND status = 'active' AND id <> $2`, [this.t, id]);
          if (n >= VANGUARD_MAX_ACTIVE) throw enterpriseRequired(`More than ${VANGUARD_MAX_ACTIVE} active surveys`);
        }
      }
      await m.query('UPDATE surveys SET status = $3 WHERE tenant_id = $1 AND id = $2', [this.t, id, status]);
      return this.load(m, id);
    });
    this.audit.logAction(this.t, actor.id, 'survey.status_changed', { surveyId: id, status, title: row.title });
    return row;
  }

  // Audience & dispatch --------------------------------------------------------------------------------------------

  /** Vanguard: one client, one client room, or all clients; cohort filters are Enterprise. */
  private async resolveAudience(m: EntityManager, a: Audience): Promise<{ clientIds: string[]; contacts: number; clientId: string | null; clientRoomId: string | null; criteria: Record<string, unknown> | null }> {
    const vanguard = (await this.tier(m)) === 'vanguard';
    let clientIds: string[];
    let clientId: string | null = null;
    let clientRoomId: string | null = null;
    let criteria: Record<string, unknown> | null = null;
    if (a.targetType === 'single_client') {
      if (!a.clientId) throw new BadRequestException('clientId is required for a single client');
      const [c] = await m.query(`SELECT id FROM clients WHERE tenant_id = $1 AND id = $2`, [this.t, a.clientId]);
      if (!c) throw new BadRequestException('clientId must be a client of the active tenant');
      clientIds = [c.id];
      clientId = c.id;
    } else if (a.targetType === 'client_room') {
      if (!a.clientRoomId) throw new BadRequestException('clientRoomId is required for a client room');
      const [r] = await m.query(`SELECT d.id, d.client_id FROM digital_sales_rooms d JOIN clients c ON c.tenant_id = d.tenant_id AND c.id = d.client_id WHERE d.tenant_id = $1 AND d.id = $2 AND d.status = 'active'`, [this.t, a.clientRoomId]);
      if (!r) throw new BadRequestException('clientRoomId must be an active client room of a known client');
      clientIds = [r.client_id];
      clientId = r.client_id;
      clientRoomId = r.id;
    } else {
      const filtered = !!(a.sector || a.minArr != null || a.maxArr != null || a.accountManagerId || a.maxHealthScore != null);
      if (filtered && vanguard) throw enterpriseRequired('The cohort builder (sector, ARR, account manager, health score)');
      if (!filtered && !a.all) throw new BadRequestException('Choose at least one cohort filter, or all = true for all clients');
      criteria = filtered ? { sector: a.sector ?? undefined, minArr: a.minArr ?? undefined, maxArr: a.maxArr ?? undefined, accountManagerId: a.accountManagerId ?? undefined, maxHealthScore: a.maxHealthScore ?? undefined } : { all: true };
      const rows: { id: string }[] = await m.query(
        `SELECT c.id FROM clients c
          WHERE c.tenant_id = $1 AND c.status = 'active'
            AND ($2::varchar IS NULL OR lower(c.sector) = lower($2))
            AND ($3::uuid IS NULL OR c.account_manager_id = $3)
            AND ($4::numeric IS NULL OR (SELECT COALESCE(sum(g.annual_value), 0) FROM agreements g WHERE g.tenant_id = c.tenant_id AND g.client_id = c.id AND g.status = 'active') >= $4)
            AND ($5::numeric IS NULL OR (SELECT COALESCE(sum(g.annual_value), 0) FROM agreements g WHERE g.tenant_id = c.tenant_id AND g.client_id = c.id AND g.status = 'active') <= $5)
          ORDER BY c.name`,
        [this.t, a.sector ?? null, a.accountManagerId ?? null, a.minArr ?? null, a.maxArr ?? null],
      );
      clientIds = rows.map((r) => r.id);
      if (a.maxHealthScore != null && clientIds.length) {
        const scores = await this.healthScores(m);
        clientIds = clientIds.filter((id) => (scores.get(id) ?? 100) <= a.maxHealthScore!);
      }
    }
    const [{ n }] = clientIds.length ? await m.query('SELECT count(*)::int AS n FROM contacts WHERE tenant_id = $1 AND client_id = ANY($2::uuid[])', [this.t, clientIds]) : [{ n: 0 }];
    return { clientIds, contacts: n, clientId, clientRoomId, criteria };
  }

  /** Account health per client, same formula as Symphony › Account health. */
  private async healthScores(m: EntityManager): Promise<Map<string, number>> {
    const rows: { id: string; credit_status: string; overdue: number; risk: number; exceptions: number }[] = await m.query(
      `SELECT c.id, c.credit_status,
              (SELECT count(*)::int FROM invoices i WHERE i.tenant_id = c.tenant_id AND i.client_id = c.id AND i.status = 'issued' AND i.due_date < CURRENT_DATE) AS overdue,
              (SELECT count(*)::int FROM agreements a WHERE a.tenant_id = c.tenant_id AND a.client_id = c.id AND a.status = 'active' AND a.churn_risk > 0) AS risk,
              (SELECT count(*)::int FROM exceptions e WHERE e.tenant_id = c.tenant_id AND e.client_id = c.id AND e.status <> 'resolved') AS exceptions
         FROM clients c WHERE c.tenant_id = $1`,
      [this.t],
    );
    return new Map(rows.map((r) => [r.id, Math.max(0, 100 - (r.credit_status === 'locked' ? 40 : r.credit_status === 'review_required' ? 15 : 0) - Math.min(30, 10 * r.overdue) - (r.risk > 0 ? 15 : 0) - Math.min(20, 10 * r.exceptions))]));
  }

  async audience(a: Audience): Promise<unknown> {
    return this.tx.run(async (m) => {
      const r = await this.resolveAudience(m, a);
      const sectors: { sector: string }[] = await m.query(`SELECT DISTINCT sector FROM clients WHERE tenant_id = $1 AND sector IS NOT NULL AND btrim(sector) <> '' ORDER BY sector`, [this.t]);
      return { clients: r.clientIds.length, contacts: r.contacts, sectors: sectors.map((s) => s.sector) };
    });
  }

  async dispatch(id: string, a: Audience, identity: AuthenticatedUser): Promise<unknown> {
    const actor = await this.userService.resolveActor(identity);
    const row = await this.tx.run(async (m) => {
      const s = await this.load(m, id);
      if (s.status !== 'active') throw new ConflictException('Activate the survey before sending it');
      const r = await this.resolveAudience(m, a);
      if (r.clientIds.length === 0) throw new BadRequestException('No clients match this selection');
      const [d] = await m.query(
        `INSERT INTO survey_dispatches (tenant_id, survey_id, target_type, client_id, client_room_id, filter_criteria, dispatched_by, total_targeted, total_contacts)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9) RETURNING id, created_at AS "createdAt"`,
        [this.t, id, a.targetType, r.clientId, r.clientRoomId, r.criteria ? JSON.stringify(r.criteria) : null, actor.id, r.clientIds.length, r.contacts],
      );
      await m.query('INSERT INTO survey_dispatch_clients (tenant_id, dispatch_id, survey_id, client_id, client_room_id) SELECT $1, $2, $3, unnest($4::uuid[]), $5', [this.t, d.id, id, r.clientIds, r.clientRoomId]);
      return { id: d.id, surveyId: id, targetType: a.targetType, totalTargeted: r.clientIds.length, totalContacts: r.contacts, createdAt: d.createdAt, title: s.title };
    });
    this.audit.logAction(this.t, actor.id, 'survey.dispatched', { surveyId: id, dispatchId: row.id, targetType: a.targetType, totalTargeted: row.totalTargeted });
    return row;
  }

  // Analytics ------------------------------------------------------------------------------------------------------

  private async responses(m: EntityManager, id: string, filter: { sector?: string | null; accountManagerId?: string | null }) {
    if ((filter.sector || filter.accountManagerId) && (await this.tier(m)) === 'vanguard') throw enterpriseRequired('Cross-filtering survey analytics');
    return m.query(
      `SELECT r.id, r.client_id AS "clientId", c.name AS "clientName", c.sector, c.account_manager_id AS "accountManagerId",
              NULLIF(btrim(COALESCE(am.first_name, '') || ' ' || COALESCE(am.last_name, '')), '') AS "accountManagerName",
              r.respondent_email AS "respondentEmail", NULLIF(btrim(COALESCE(ct.first_name, '') || ' ' || COALESCE(ct.last_name, '')), '') AS "contactName",
              r.answers, r.nps_score AS "npsScore", r.submitted_at AS "submittedAt"
         FROM survey_responses r LEFT JOIN clients c ON c.id = r.client_id LEFT JOIN users am ON am.id = c.account_manager_id
         LEFT JOIN contacts ct ON ct.id = r.contact_id
        WHERE r.tenant_id = $1 AND r.survey_id = $2 AND ($3::varchar IS NULL OR lower(c.sector) = lower($3)) AND ($4::uuid IS NULL OR c.account_manager_id = $4)
        ORDER BY r.submitted_at DESC`,
      [this.t, id, filter.sector ?? null, filter.accountManagerId ?? null],
    ) as Promise<{ id: string; clientId: string | null; clientName: string | null; sector: string | null; accountManagerId: string | null; accountManagerName: string | null; respondentEmail: string | null; contactName: string | null; answers: Answers; npsScore: number | null; submittedAt: string }[]>;
  }

  async analytics(id: string, filter: { sector?: string | null; accountManagerId?: string | null }): Promise<unknown> {
    return this.tx.run(async (m) => {
      const s = await this.load(m, id);
      const rows = await this.responses(m, id, filter);
      const [{ targeted, responded }] = await m.query(
        `SELECT (SELECT count(DISTINCT client_id)::int FROM survey_dispatch_clients WHERE tenant_id = $1 AND survey_id = $2) AS targeted,
                (SELECT count(DISTINCT client_id)::int FROM survey_responses WHERE tenant_id = $1 AND survey_id = $2 AND client_id IS NOT NULL) AS responded`,
        [this.t, id],
      );
      const questions = s.questions.map((q) => {
        const given = rows.map((r) => r.answers[q.id]).filter((v) => v !== undefined && v !== null && v !== '');
        const base = { id: q.id, label: q.label, type: q.type, answered: given.length, skipped: rows.length - given.length };
        if (q.type === 'text') return { ...base, texts: given.slice(0, 200).map(String) };
        const distribution: Record<string, number> = {};
        if (q.type === 'single_choice' || q.type === 'multi_choice') {
          for (const o of q.options ?? []) distribution[o] = 0;
          for (const v of given) for (const o of Array.isArray(v) ? v : [String(v)]) distribution[o] = (distribution[o] ?? 0) + 1;
          return { ...base, distribution };
        }
        const [lo, hi] = range(q);
        for (let i = lo; i <= hi; i++) distribution[String(i)] = 0;
        const nums = given.map(Number).filter((n) => Number.isFinite(n));
        for (const n of nums) distribution[String(n)] = (distribution[String(n)] ?? 0) + 1;
        const average = nums.length ? Math.round((10 * nums.reduce((a, b) => a + b, 0)) / nums.length) / 10 : null;
        return { ...base, distribution, average, ...(q.type === 'nps' ? { nps: npsOf(nums) } : {}) };
      });
      const group = (key: (r: (typeof rows)[number]) => string) => {
        const map = new Map<string, number[]>();
        const counts = new Map<string, number>();
        for (const r of rows) {
          const k = key(r);
          counts.set(k, (counts.get(k) ?? 0) + 1);
          if (r.npsScore !== null) map.set(k, [...(map.get(k) ?? []), r.npsScore]);
        }
        return [...counts.entries()].map(([name, responses]) => ({ name, responses, nps: npsOf(map.get(name) ?? []).score })).sort((a, b) => b.responses - a.responses);
      };
      return {
        surveyId: id,
        title: s.title,
        status: s.status,
        totalResponses: rows.length,
        targetedClients: targeted,
        respondedClients: responded,
        responseRate: targeted ? Math.round((100 * responded) / targeted) : null,
        nps: npsOf(rows.map((r) => r.npsScore).filter((n): n is number => n !== null)),
        questions,
        bySector: group((r) => r.sector || 'No sector'),
        byAccountManager: group((r) => r.accountManagerName || 'No account manager'),
        respondents: rows.map(({ answers: _a, ...r }) => r),
        filter: { sector: filter.sector ?? null, accountManagerId: filter.accountManagerId ?? null },
      };
    });
  }

  async export(id: string, identity: AuthenticatedUser): Promise<string> {
    const actor = await this.userService.resolveActor(identity);
    const csv = await this.tx.run(async (m) => {
      const s = await this.load(m, id);
      const rows = await this.responses(m, id, {});
      const head = ['Submitted at', 'Client', 'Sector', 'Account manager', 'Respondent', 'NPS', ...s.questions.map((q) => q.label)];
      const lines = rows.map((r) => [new Date(r.submittedAt).toISOString(), r.clientName, r.sector, r.accountManagerName, r.contactName || r.respondentEmail, r.npsScore, ...s.questions.map((q) => r.answers[q.id])]);
      return [head, ...lines].map((l) => l.map(csvCell).join(',')).join('\r\n') + '\r\n';
    });
    this.audit.logAction(this.t, actor.id, 'survey.exported', { surveyId: id });
    return csv;
  }

  /** Executive roll-up for Symphony › Customer feedback: NPS over 90 days, per survey and per client. */
  async summary(): Promise<unknown> {
    return this.tx.run(async (m) => {
      const rows: { clientId: string | null; clientName: string | null; npsScore: number | null; submittedAt: string }[] = await m.query(
        `SELECT r.client_id AS "clientId", c.name AS "clientName", r.nps_score AS "npsScore", r.submitted_at AS "submittedAt"
           FROM survey_responses r LEFT JOIN clients c ON c.id = r.client_id WHERE r.tenant_id = $1 AND r.submitted_at > NOW() - INTERVAL '90 days'`,
        [this.t],
      );
      const byClient = new Map<string, { clientId: string; name: string; scores: number[]; responses: number; lastAt: string }>();
      for (const r of rows) {
        if (!r.clientId) continue;
        const e = byClient.get(r.clientId) ?? { clientId: r.clientId, name: r.clientName ?? '', scores: [], responses: 0, lastAt: r.submittedAt };
        e.responses++;
        if (r.npsScore !== null) e.scores.push(r.npsScore);
        if (r.submittedAt > e.lastAt) e.lastAt = r.submittedAt;
        byClient.set(r.clientId, e);
      }
      const surveys = await m.query(`${SQL} WHERE s.tenant_id = $1 AND s.status IN ('active', 'closed') ORDER BY s.updated_at DESC LIMIT 20`, [this.t]);
      return {
        responses: rows.length,
        nps: npsOf(rows.map((r) => r.npsScore).filter((n): n is number => n !== null)),
        clients: [...byClient.values()].map(({ scores, ...c }) => ({ ...c, nps: npsOf(scores).score, averageScore: scores.length ? Math.round((10 * scores.reduce((a, b) => a + b, 0)) / scores.length) / 10 : null })).sort((a, b) => (a.nps ?? 101) - (b.nps ?? 101)),
        surveys,
      };
    });
  }

  // Client portal --------------------------------------------------------------------------------------------------

  private get externalClient(): string {
    const access = this.context.tenant.access;
    if (access.scope !== 'external') throw new ForbiddenException('Only client contacts answer surveys in the client portal');
    return access.clientId;
  }

  async portalList(identity: AuthenticatedUser): Promise<unknown[]> {
    const clientId = this.externalClient;
    return this.tx.run(async (m) => {
      const rows: Record<string, unknown>[] = await m.query(
        `SELECT s.id, s.title, s.description, s.questions,
                EXISTS (SELECT 1 FROM survey_responses r WHERE r.survey_id = s.id AND lower(r.respondent_email) = lower($2)) AS answered,
                (SELECT COALESCE(array_agg(DISTINCT x.client_room_id) FILTER (WHERE x.client_room_id IS NOT NULL), '{}') FROM survey_dispatch_clients x WHERE x.survey_id = s.id AND x.client_id = $3) AS "clientRoomIds"
           FROM surveys s WHERE s.tenant_id = $1 AND s.status = 'active'
            AND EXISTS (SELECT 1 FROM survey_dispatch_clients x WHERE x.tenant_id = s.tenant_id AND x.survey_id = s.id AND x.client_id = $3)
          ORDER BY s.updated_at DESC`,
        [this.t, identity.email, clientId],
      );
      return rows;
    });
  }

  async respond(id: string, answers: Answers, identity: AuthenticatedUser): Promise<unknown> {
    const clientId = this.externalClient;
    const row = await this.tx.run(async (m) => {
      const [s] = await m.query(`SELECT id, title, questions FROM surveys WHERE tenant_id = $1 AND id = $2 AND status = 'active'`, [this.t, id]);
      if (!s) throw new NotFoundException('Survey not found');
      const [target] = await m.query(
        `SELECT x.dispatch_id FROM survey_dispatch_clients x WHERE x.tenant_id = $1 AND x.survey_id = $2 AND x.client_id = $3 LIMIT 1`,
        [this.t, id, clientId],
      );
      if (!target) throw new NotFoundException('Survey not found');
      const clean = this.validateAnswers(s.questions as Question[], answers);
      const npsQ = (s.questions as Question[]).find((q) => q.type === 'nps' && clean[q.id] !== undefined);
      const [dup] = await m.query('SELECT 1 FROM survey_responses WHERE survey_id = $1 AND lower(respondent_email) = lower($2)', [id, identity.email]);
      if (dup) throw new ConflictException('You already answered this survey');
      const [r] = await m.query(
        `INSERT INTO survey_responses (tenant_id, survey_id, dispatch_id, client_id, respondent_email, answers, nps_score) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7) RETURNING id, submitted_at AS "submittedAt"`,
        [this.t, id, target.dispatch_id, clientId, identity.email, JSON.stringify(clean), npsQ ? Number(clean[npsQ.id]) : null],
      );
      return { id: r.id, surveyId: id, submittedAt: r.submittedAt, npsScore: npsQ ? Number(clean[npsQ.id]) : null, title: s.title as string };
    });
    this.audit.logAction(this.t, null, 'survey.response_submitted', { surveyId: id, responseId: row.id, clientId, npsScore: row.npsScore, title: row.title });
    return row;
  }

  validateAnswers(questions: Question[], raw: Answers): Answers {
    const out: Answers = {};
    for (const q of questions) {
      if (!visible(q, out)) continue;
      const v = raw[q.id];
      const empty = v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
      if (empty) {
        if (q.required) throw new BadRequestException(`"${q.label}" needs an answer`);
        continue;
      }
      if (q.type === 'text') {
        if (typeof v !== 'string' || v.length > 5000) throw new BadRequestException(`"${q.label}" must be text of at most 5000 characters`);
        out[q.id] = v.trim();
      } else if (q.type === 'single_choice') {
        if (typeof v !== 'string' || !q.options?.includes(v)) throw new BadRequestException(`"${q.label}" must be one of the options`);
        out[q.id] = v;
      } else if (q.type === 'multi_choice') {
        if (!Array.isArray(v) || v.some((x) => typeof x !== 'string' || !q.options?.includes(x))) throw new BadRequestException(`"${q.label}" must be a list of the options`);
        out[q.id] = [...new Set(v as string[])];
      } else {
        const [lo, hi] = range(q);
        if (typeof v !== 'number' || !Number.isInteger(v) || v < lo || v > hi) throw new BadRequestException(`"${q.label}" must be a whole number from ${lo} to ${hi}`);
        out[q.id] = v;
      }
    }
    return out;
  }
}
