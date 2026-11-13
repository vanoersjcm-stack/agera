import { BadRequestException, Injectable, Logger, NotFoundException, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { DataSource, type EntityManager } from 'typeorm';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { AuditService } from '../core/audit/audit.service.js';
import { AUDIT_LOG_EVENT, type AuditLogEvent } from '../core/audit/audit.events.js';
import { TenantContext } from '../core/tenancy/tenant-context.service.js';
import { TenantTransaction } from '../core/tenancy/tenant-transaction.service.js';
import { enterpriseRequired, licenseTier } from '../core/tenancy/license.js';
import { UserService } from '../user/user.service.js';

export const TRIGGERS: Record<string, string> = {
  'exception.created': 'When an account exception is logged (any severity; add a condition for High)',
  'field_order.created': 'When a field order is placed',
  'field_order.status_changed': 'When a field order changes status (e.g. delivered)',
  'visit.report_saved': 'When a merchandiser saves a store visit report',
  'visit.status_changed': 'When a store visit changes status (e.g. completed)',
  'work_order.created': 'When a work order is created',
  'work_order.status_changed': 'When a work order changes status (e.g. completed)',
  'agreement.status_changed': 'When an agreement changes status (e.g. activated or expired)',
  'agreement.signed': 'When a client signs an agreement in a client room',
  'deal.stage_changed': 'When a deal moves to another pipeline stage',
  'invoice.status_changed': 'When an invoice changes status (sent, paid or cancelled)',
  'credit_hold.set': 'When an emergency credit lock is set on a client',
  'document.uploaded': 'When a document is uploaded to a client room',
  'dsr.activity_recorded': 'When a client opens, downloads or comments in a client room',
  'milestone.completed': 'When an action-plan step is completed',
  'approval.rejected': 'When an approver rejects a request',
  'product.created': 'When a product is added to the catalogue',
  'store.created': 'When a store is added',
  'client.created': 'When a client is added',
};
export const OPERATORS = ['equals', 'not_equals', 'contains', 'exists'] as const;
export const ACTIONS = ['notify_user', 'create_exception'] as const;
export const VANGUARD_MAX_ACTIVE = 5;

export interface Condition { field: string; op: (typeof OPERATORS)[number]; value: string | null }
export interface Step {
  condition: Condition | null;
  action: (typeof ACTIONS)[number];
  config: { userId?: string | null; title: string; message?: string | null; severity?: 'low' | 'medium' | 'high' };
  delayMinutes: number;
}
export interface AutomationInput { name: string; trigger: string; steps: Step[]; active?: boolean }

const SQL = `SELECT a.id, a.name, a.trigger, a.steps, a.active, a.run_count AS "runCount", a.last_run_at AS "lastRunAt", a.created_at AS "createdAt", a.updated_at AS "updatedAt"
  FROM automations a`;

const isLinear = (steps: Step[]) => steps.length === 1 && steps[0].delayMinutes === 0;

function fill(text: string, details: Record<string, unknown>): string {
  return text.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, k: string) => String(details[k] ?? ''));
}

export function conditionHolds(c: Condition | null, details: Record<string, unknown>): boolean {
  if (!c) return true;
  const raw = details[c.field];
  const v = raw === undefined || raw === null ? null : typeof raw === 'object' ? JSON.stringify(raw) : String(raw);
  const want = (c.value ?? '').toLowerCase();
  switch (c.op) {
    case 'exists': return v !== null && v !== '';
    case 'equals': return (v ?? '').toLowerCase() === want;
    case 'not_equals': return (v ?? '').toLowerCase() !== want;
    case 'contains': return (v ?? '').toLowerCase().includes(want);
  }
}

@Injectable()
export class AutomationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AutomationService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly context: TenantContext,
    private readonly tx: TenantTransaction,
    private readonly dataSource: DataSource,
    private readonly userService: UserService,
    private readonly audit: AuditService,
  ) {}

  private get t(): string {
    return this.context.tenantId;
  }

  onModuleInit(): void {
    this.timer = setInterval(() => void this.runDue().catch((e) => this.logger.error(`Delayed automation steps failed: ${e}`)), 30_000);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  // Management -----------------------------------------------------------------------------------------------------

  async list(): Promise<{ tier: string; maxActive: number | null; activeCount: number; items: unknown[] }> {
    return this.tx.run(async (m) => {
      const tier = await licenseTier(m, this.context.tenant);
      const items = await m.query(`${SQL} WHERE a.tenant_id = $1 ORDER BY a.active DESC, a.name`, [this.t]);
      return { tier, maxActive: tier === 'vanguard' ? VANGUARD_MAX_ACTIVE : null, activeCount: items.filter((a: { active: boolean }) => a.active).length, items };
    });
  }

  async get(id: string): Promise<unknown> {
    return this.tx.run(async (m) => {
      const a = await this.load(m, id);
      a.runs = await m.query(
        'SELECT id, step_index AS "stepIndex", status, run_at AS "runAt", event, detail, created_at AS "createdAt" FROM automation_runs WHERE automation_id = $1 ORDER BY created_at DESC LIMIT 50',
        [id],
      );
      return a;
    });
  }

  private async load(m: EntityManager, id: string): Promise<Record<string, unknown>> {
    const [a] = await m.query(`${SQL} WHERE a.tenant_id = $1 AND a.id = $2`, [this.t, id]);
    if (!a) throw new NotFoundException('Automation not found');
    return a;
  }

  /** Vanguard: linear automations only, at most 5 active. */
  private async checkEdition(m: EntityManager, steps: Step[] | undefined, willBeActive: boolean, exceptId: string | null): Promise<void> {
    if ((await licenseTier(m, this.context.tenant)) !== 'vanguard') return;
    if (steps && !isLinear(steps)) throw enterpriseRequired('Multi-step, branching and delayed automations');
    if (!willBeActive) return;
    const [{ n }] = await m.query('SELECT count(*)::int AS n FROM automations WHERE tenant_id = $1 AND active AND id IS DISTINCT FROM $2', [this.t, exceptId]);
    if (n >= VANGUARD_MAX_ACTIVE) throw enterpriseRequired(`More than ${VANGUARD_MAX_ACTIVE} active automations`);
  }

  private async checkUsers(m: EntityManager, steps: Step[]): Promise<void> {
    for (const s of steps) {
      if (s.action !== 'notify_user' && !s.config.userId) continue;
      if (!s.config.userId) throw new BadRequestException('notify_user needs config.userId');
      const [u] = await m.query('SELECT id FROM users WHERE tenant_id = $1 AND id = $2', [this.t, s.config.userId]);
      if (!u) throw new BadRequestException('config.userId is not a user of this organisation');
    }
  }

  async create(input: AutomationInput, identity: AuthenticatedUser): Promise<unknown> {
    const actor = await this.userService.resolveActor(identity);
    const row = await this.tx.run(async (m) => {
      await this.checkEdition(m, input.steps, input.active ?? true, null);
      await this.checkUsers(m, input.steps);
      const [a] = await m.query('INSERT INTO automations (tenant_id, name, trigger, steps, active, created_by) VALUES ($1,$2,$3,$4::jsonb,$5,$6) RETURNING id', [
        this.t, input.name, input.trigger, JSON.stringify(input.steps), input.active ?? true, actor.id,
      ]);
      return this.load(m, a.id);
    });
    this.audit.logAction(this.t, actor.id, 'automation.created', { automationId: row.id });
    return row;
  }

  async update(id: string, input: Partial<AutomationInput>, identity: AuthenticatedUser): Promise<unknown> {
    const actor = await this.userService.resolveActor(identity);
    const row = await this.tx.run(async (m) => {
      const current = await this.load(m, id);
      const steps = input.steps ?? (current.steps as Step[]);
      await this.checkEdition(m, input.steps ?? (input.active ? steps : undefined), input.active ?? (current.active as boolean), id);
      if (input.steps) await this.checkUsers(m, input.steps);
      await m.query(
        'UPDATE automations SET name = COALESCE($3, name), trigger = COALESCE($4, trigger), steps = COALESCE($5::jsonb, steps), active = COALESCE($6, active) WHERE tenant_id = $1 AND id = $2',
        [this.t, id, input.name ?? null, input.trigger ?? null, input.steps ? JSON.stringify(input.steps) : null, input.active ?? null],
      );
      return this.load(m, id);
    });
    this.audit.logAction(this.t, actor.id, 'automation.updated', { automationId: id });
    return row;
  }

  async remove(id: string, identity: AuthenticatedUser): Promise<void> {
    const actor = await this.userService.resolveActor(identity);
    await this.tx.run(async (m) => {
      await this.load(m, id);
      await m.query('DELETE FROM automations WHERE tenant_id = $1 AND id = $2', [this.t, id]);
    });
    this.audit.logAction(this.t, actor.id, 'automation.deleted', { automationId: id });
  }

  // Engine ---------------------------------------------------------------------------------------------------------

  private asTenant<T>(tenantId: string, work: (m: EntityManager) => Promise<T>): Promise<T> {
    return this.context.run({ id: tenantId, name: '', domain: '', source: 'claim', access: { scope: 'internal' } }, () => this.tx.run(work));
  }

  @OnEvent(AUDIT_LOG_EVENT, { async: true, promisify: true })
  async onEvent(event: AuditLogEvent): Promise<void> {
    if (!TRIGGERS[event.action]) return;
    try {
      await this.asTenant(event.tenantId, async (m) => {
        const autos: { id: string; name: string; steps: Step[] }[] = await m.query('SELECT id, name, steps FROM automations WHERE tenant_id = $1 AND active AND trigger = $2', [event.tenantId, event.action]);
        const payload = { action: event.action, userId: event.userId, details: event.details ?? {} };
        for (const a of autos) {
          for (const [i, step] of a.steps.entries()) {
            if (step.delayMinutes > 0) {
              await m.query(`INSERT INTO automation_runs (tenant_id, automation_id, step_index, status, run_at, event) VALUES ($1,$2,$3,'scheduled', NOW() + make_interval(mins => $4), $5::jsonb)`, [
                event.tenantId, a.id, i, step.delayMinutes, JSON.stringify(payload),
              ]);
            } else {
              await this.execute(m, event.tenantId, a, i, step, payload, null);
            }
          }
          await m.query('UPDATE automations SET run_count = run_count + 1, last_run_at = NOW() WHERE id = $1', [a.id]);
        }
      });
    } catch (error) {
      this.logger.error(`Automation for "${event.action}" failed`, error instanceof Error ? error.stack : String(error));
    }
  }

  private async execute(m: EntityManager, tenantId: string, a: { id: string; name: string }, index: number, step: Step, payload: { details: Record<string, unknown> }, runId: string | null): Promise<void> {
    const details = payload.details ?? {};
    let status: 'done' | 'skipped' | 'failed' = 'done';
    let detail: string;
    if (!conditionHolds(step.condition, details)) {
      status = 'skipped';
      detail = `Condition not met (${step.condition!.field} ${step.condition!.op} ${step.condition!.value ?? ''})`;
    } else {
      const title = fill(step.config.title, details).slice(0, 200);
      const message = step.config.message ? fill(step.config.message, details).slice(0, 2000) : null;
      try {
        await m.query('SAVEPOINT automation_step');
        if (step.action === 'notify_user') {
          await m.query('INSERT INTO notifications (tenant_id, user_id, title, body, link) VALUES ($1,$2,$3,$4,$5)', [tenantId, step.config.userId, title, message, `/symphony/automations/${a.id}`]);
          detail = 'Notification sent';
        } else {
          await m.query(`INSERT INTO exceptions (tenant_id, title, description, severity, status, owner_id, source) VALUES ($1,$2,$3,$4,'open',$5,$6)`, [
            tenantId, title, message, step.config.severity ?? 'medium', step.config.userId ?? null, `Automation: ${a.name}`.slice(0, 100),
          ]);
          if (step.config.userId) {
            await m.query('INSERT INTO notifications (tenant_id, user_id, title, body, link) VALUES ($1,$2,$3,$4,$5)', [tenantId, step.config.userId, `Exception assigned: ${title}`, `Created by automation ${a.name}`, '/nexus/exceptions']);
          }
          detail = 'Exception created';
        }
        await m.query('RELEASE SAVEPOINT automation_step');
      } catch (error) {
        await m.query('ROLLBACK TO SAVEPOINT automation_step');
        status = 'failed';
        detail = error instanceof Error ? error.message : String(error);
      }
    }
    if (runId) await m.query('UPDATE automation_runs SET status = $2, detail = $3 WHERE id = $1', [runId, status, detail]);
    else await m.query('INSERT INTO automation_runs (tenant_id, automation_id, step_index, status, event, detail) VALUES ($1,$2,$3,$4,$5::jsonb,$6)', [tenantId, a.id, index, status, JSON.stringify(payload), detail]);
  }

  /** Runs delayed steps whose time has come (Enterprise). */
  async runDue(): Promise<number> {
    const tenants: { id: string }[] = await this.dataSource.query('SELECT id FROM tenants');
    let done = 0;
    for (const { id: tenantId } of tenants) {
      done += await this.asTenant(tenantId, async (m) => {
        const due: { id: string; automation_id: string; step_index: number; event: { details: Record<string, unknown> }; name: string; steps: Step[] }[] = await m.query(
          `SELECT r.id, r.automation_id, r.step_index, r.event, a.name, a.steps FROM automation_runs r JOIN automations a ON a.id = r.automation_id
            WHERE r.tenant_id = $1 AND r.status = 'scheduled' AND r.run_at <= NOW() ORDER BY r.run_at LIMIT 100 FOR UPDATE OF r SKIP LOCKED`,
          [tenantId],
        );
        for (const r of due) {
          const step = r.steps[r.step_index];
          if (!step) await m.query(`UPDATE automation_runs SET status = 'skipped', detail = 'Step removed' WHERE id = $1`, [r.id]);
          else await this.execute(m, tenantId, { id: r.automation_id, name: r.name }, r.step_index, step, r.event, r.id);
        }
        return due.length;
      });
    }
    return done;
  }
}
