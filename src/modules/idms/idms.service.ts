import { ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { jobRoleOf } from '../auth/job-roles.js';
import { AuditService } from '../core/audit/audit.service.js';
import { type IdmsStatus, type IdmsTable, nextIdmsStatus } from '../core/idms/idms.js';
import { StorageService } from '../core/storage/storage.service.js';
import { TenantContext } from '../core/tenancy/tenant-context.service.js';
import { TenantTransaction } from '../core/tenancy/tenant-transaction.service.js';
import { UserService } from '../user/user.service.js';

export const IDMS_KINDS = ['documents', 'agreements', 'financial_models', 'invoices'] as const;
export type IdmsKind = (typeof IDMS_KINDS)[number];
const TABLE: Record<IdmsKind, IdmsTable> = { documents: 'room_documents', agreements: 'agreements', financial_models: 'financial_models', invoices: 'invoices' };

export const DOCUMENT_CLASSES = ['invoice', 'agreement', 'financial_plan', 'office_doc', 'visit_report', 'survey_response'] as const;
export type DocumentClass = (typeof DOCUMENT_CLASSES)[number];
export const ERASURE_MODES = ['pseudonymize', 'hard_delete'] as const;
export type ErasureMode = (typeof ERASURE_MODES)[number];
/** Classes with an IDMS lifecycle: erased after `wormRetentionYears` in ARCHIVED_WORM. The others: after `autoPurgeDays`. */
const LIFECYCLE_TABLE: Partial<Record<DocumentClass, IdmsTable>> = {
  invoice: 'invoices', agreement: 'agreements', financial_plan: 'financial_models', office_doc: 'room_documents',
};
/** Dutch fiscal retention period (AWR art. 52). */
const DEFAULT_RETENTION_YEARS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface IdmsTransitionView {
  kind: IdmsKind;
  id: string;
  idmsStatus: IdmsStatus;
  idmsChangedAt: Date;
}

export interface RetentionPolicyView {
  documentClass: DocumentClass;
  lifecycle: boolean;
  wormRetentionYears: number;
  autoPurgeDays: number | null;
  erasureMode: ErasureMode;
  updatedByName: string | null;
  updatedAt: Date;
}

export interface RetentionPolicyInput {
  wormRetentionYears: number;
  autoPurgeDays: number | null;
  erasureMode: ErasureMode;
}

export interface RetentionRunResult {
  expired: number;
  pseudonymized: number;
  deleted: number;
  byClass: Partial<Record<DocumentClass, number>>;
}

/** Account managers move documents and agreements; HQ and platform admins every kind. */
export function mayTransition(identity: AuthenticatedUser, kind: IdmsKind): boolean {
  const role = jobRoleOf(identity.roles);
  if (!role) return identity.roles.includes('admin') || identity.roles.includes('user');
  if (role === 'PLATFORM_ADMIN' || role === 'HQ_ADMIN') return true;
  if (role === 'ACCOUNT_MANAGER') return kind === 'documents' || kind === 'agreements';
  return false;
}

@Injectable()
export class IdmsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(IdmsService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly context: TenantContext,
    private readonly tx: TenantTransaction,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly userService: UserService,
  ) {}

  /** Daily retention job: first run a few minutes after start, then every 24 hours. */
  onModuleInit(): void {
    const run = () => void this.runAllTenants().catch((e) => this.logger.error(`IDMS retention job failed: ${e}`));
    this.timer = setTimeout(() => {
      run();
      this.timer = setInterval(run, DAY_MS);
      this.timer.unref();
    }, 5 * 60 * 1000);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearTimeout(this.timer);
  }

  // Lifecycle transitions ------------------------------------------------------------------------------------------

  async transition(kind: IdmsKind, id: string, to: IdmsStatus, identity: AuthenticatedUser): Promise<IdmsTransitionView> {
    if (!mayTransition(identity, kind)) throw new ForbiddenException('Your role cannot change the lifecycle of this record');
    if (to === 'EXPIRED_PURGE') throw new ConflictException('Only the retention job can expire records');
    const actor = await this.userService.resolveActor(identity);
    const table = TABLE[kind];
    const { from, row } = await this.tx.run(async (manager) => {
      const [current] = await manager.query(`SELECT idms_status FROM ${table} WHERE tenant_id = $1 AND id = $2 FOR UPDATE`, [this.context.tenantId, id]);
      if (!current) throw new NotFoundException('Record not found');
      const from = current.idms_status as IdmsStatus;
      if (nextIdmsStatus(from) !== to) throw new ConflictException(`A record that is ${from} cannot become ${to}`);
      const [[updated]] = await manager.query(
        `UPDATE ${table} SET idms_status = $3 WHERE tenant_id = $1 AND id = $2 RETURNING idms_status AS "idmsStatus", idms_changed_at AS "idmsChangedAt"`,
        [this.context.tenantId, id, to],
      );
      return { from, row: updated as { idmsStatus: IdmsStatus; idmsChangedAt: Date } };
    });
    this.audit.logAction(this.context.tenantId, actor.id, 'idms.transitioned', { kind, recordId: id, from, to });
    return { kind, id, ...row };
  }

  // Retention policies ---------------------------------------------------------------------------------------------

  policies(): Promise<RetentionPolicyView[]> {
    return this.tx.run((manager) => this.loadPolicies(manager));
  }

  async updatePolicy(documentClass: DocumentClass, input: RetentionPolicyInput, identity: AuthenticatedUser): Promise<RetentionPolicyView> {
    const actor = await this.userService.resolveActor(identity);
    const view = await this.tx.run(async (manager) => {
      await this.ensurePolicies(manager);
      await manager.query(
        `UPDATE retention_policies SET worm_retention_years = $3, auto_purge_days = $4, erasure_mode = $5, updated_by = $6
          WHERE tenant_id = $1 AND document_class = $2`,
        [this.context.tenantId, documentClass, input.wormRetentionYears, input.autoPurgeDays, input.erasureMode, actor.id],
      );
      return (await this.loadPolicies(manager)).find((p) => p.documentClass === documentClass)!;
    });
    this.audit.logAction(this.context.tenantId, actor.id, 'retention_policy.updated', { documentClass, ...input });
    return view;
  }

  private async ensurePolicies(manager: EntityManager): Promise<void> {
    await manager.query(
      `INSERT INTO retention_policies (tenant_id, document_class, worm_retention_years)
       SELECT $1, c, $3 FROM unnest($2::text[]) c ON CONFLICT (tenant_id, document_class) DO NOTHING`,
      [this.context.tenantId, DOCUMENT_CLASSES, DEFAULT_RETENTION_YEARS],
    );
  }

  private async loadPolicies(manager: EntityManager): Promise<RetentionPolicyView[]> {
    await this.ensurePolicies(manager);
    const rows: Omit<RetentionPolicyView, 'lifecycle'>[] = await manager.query(
      `SELECT p.document_class AS "documentClass", p.worm_retention_years AS "wormRetentionYears", p.auto_purge_days AS "autoPurgeDays",
              p.erasure_mode AS "erasureMode", COALESCE(NULLIF(btrim(concat_ws(' ', u.first_name, u.last_name)), ''), u.email) AS "updatedByName",
              p.updated_at AS "updatedAt"
         FROM retention_policies p LEFT JOIN users u ON u.id = p.updated_by
        WHERE p.tenant_id = $1`,
      [this.context.tenantId],
    );
    return DOCUMENT_CLASSES.map((c) => rows.find((r) => r.documentClass === c)!).map((r) => ({ ...r, lifecycle: r.documentClass in LIFECYCLE_TABLE }));
  }

  // Retention / erasure job (GDPR Art. 17) -------------------------------------------------------------------------

  /** Runs the retention job for the current organisation (Run now button). */
  runNow(): Promise<RetentionRunResult> {
    return this.purgeTenant(this.context.tenantId);
  }

  async runAllTenants(): Promise<void> {
    const tenants: { id: string }[] = await this.tx.runAsSystem((m) => m.query('SELECT id FROM tenants'));
    for (const t of tenants) {
      const result = await this.context.run({ id: t.id, name: '', domain: '', source: 'claim', access: { scope: 'internal' } }, () => this.purgeTenant(t.id));
      if (result.expired + result.pseudonymized + result.deleted > 0) this.logger.log(`Retention job for ${t.id}: ${JSON.stringify(result)}`);
    }
  }

  private async purgeTenant(tenantId: string): Promise<RetentionRunResult> {
    const result: RetentionRunResult = { expired: 0, pseudonymized: 0, deleted: 0, byClass: {} };
    const events: { documentClass: DocumentClass; recordId: string; mode: ErasureMode }[] = [];
    const storageKeys = await this.tx.run(async (manager) => {
      await manager.query(`SELECT set_config('app.idms_purge', 'on', true)`);
      const policies = await this.loadPolicies(manager);
      const keys: string[] = [];
      for (const p of policies) {
        const table = LIFECYCLE_TABLE[p.documentClass];
        if (table) {
          const due: { id: string }[] = await manager.query(
            `SELECT id FROM ${table} WHERE tenant_id = $1 AND idms_status = 'ARCHIVED_WORM' AND idms_archived_at < NOW() - make_interval(years => $2)`,
            [tenantId, p.wormRetentionYears],
          );
          for (const { id } of due) {
            const mode = await this.expire(manager, table, tenantId, id, p.erasureMode, keys);
            result.expired++;
            events.push({ documentClass: p.documentClass, recordId: id, mode });
          }
        } else if (p.autoPurgeDays !== null) {
          const ids = await this.erasePersonalData(manager, p.documentClass, tenantId, p.autoPurgeDays, p.erasureMode);
          for (const id of ids) events.push({ documentClass: p.documentClass, recordId: id, mode: p.erasureMode });
        }
      }
      return keys;
    });
    await Promise.all(storageKeys.map((k) => this.storage.delete(k).catch(() => undefined)));
    for (const e of events) {
      if (e.mode === 'hard_delete') result.deleted++;
      else result.pseudonymized++;
      result.byClass[e.documentClass] = (result.byClass[e.documentClass] ?? 0) + 1;
      this.audit.logAction(tenantId, null, 'idms.purged', { documentClass: e.documentClass, recordId: e.recordId, mode: e.mode, legalBasis: 'GDPR Art. 17' });
    }
    return result;
  }

  /** ARCHIVED_WORM → EXPIRED_PURGE plus erasure. Hard delete falls back to pseudonymisation when other records still refer to it. */
  private async expire(manager: EntityManager, table: IdmsTable, tenantId: string, id: string, mode: ErasureMode, keys: string[]): Promise<ErasureMode> {
    const versionKeys = async () =>
      table === 'room_documents'
        ? ((await manager.query('SELECT storage_key FROM room_document_versions WHERE tenant_id = $1 AND document_id = $2', [tenantId, id])) as { storage_key: string }[]).map((r) => r.storage_key)
        : [];
    if (mode === 'hard_delete') {
      await manager.query('SAVEPOINT idms_purge');
      try {
        const files = await versionKeys();
        await manager.query(`UPDATE ${table} SET idms_status = 'EXPIRED_PURGE' WHERE tenant_id = $1 AND id = $2`, [tenantId, id]);
        await manager.query(`DELETE FROM ${table} WHERE tenant_id = $1 AND id = $2`, [tenantId, id]);
        await manager.query('RELEASE SAVEPOINT idms_purge');
        keys.push(...files);
        return 'hard_delete';
      } catch (error) {
        await manager.query('ROLLBACK TO SAVEPOINT idms_purge');
        this.logger.warn(`Hard delete of ${table} ${id} refused (${String(error)}); pseudonymising instead`);
      }
    }
    const scrub: Record<IdmsTable, string> = {
      invoices: 'description = NULL',
      agreements: `title = 'Erased agreement', document_url = 'about:erased'`,
      financial_models: `metadata = '{}'::jsonb`,
      room_documents: `title = 'Erased document', contact_id = NULL, created_by = NULL, last_modified_by = NULL, lock_token = NULL, lock_expires_at = NULL`,
    };
    await manager.query(`UPDATE ${table} SET idms_status = 'EXPIRED_PURGE', ${scrub[table]} WHERE tenant_id = $1 AND id = $2`, [tenantId, id]);
    if (table === 'room_documents') {
      keys.push(...(await versionKeys()));
      // Content is removed; the SHA-256 fingerprint of every version stays as evidence.
      await manager.query(
        `UPDATE room_document_versions v SET file_name = 'erased.' || COALESCE(d.file_format, 'bin'), uploaded_by = NULL
           FROM room_documents d WHERE d.id = v.document_id AND v.tenant_id = $1 AND v.document_id = $2`,
        [tenantId, id],
      );
    }
    return 'pseudonymize';
  }

  /** Visit reports and survey responses older than `days`: removes personal data (or the row). Returns the affected ids. */
  private async erasePersonalData(manager: EntityManager, documentClass: DocumentClass, tenantId: string, days: number, mode: ErasureMode): Promise<string[]> {
    const result: unknown =
      documentClass === 'visit_report'
        ? mode === 'hard_delete'
          ? await manager.query(`DELETE FROM visit_reports WHERE tenant_id = $1 AND created_at < NOW() - make_interval(days => $2) RETURNING id`, [tenantId, days])
          : await manager.query(
              `UPDATE visit_reports SET summary = NULL WHERE tenant_id = $1 AND created_at < NOW() - make_interval(days => $2) AND summary IS NOT NULL RETURNING id`,
              [tenantId, days],
            )
        : mode === 'hard_delete'
          ? await manager.query(`DELETE FROM survey_responses WHERE tenant_id = $1 AND submitted_at < NOW() - make_interval(days => $2) RETURNING id`, [tenantId, days])
          : await manager.query(
              // Scores (numbers, yes/no) stay for the statistics; contact, e-mail address and free text go.
              `UPDATE survey_responses
                  SET contact_id = NULL, respondent_email = NULL,
                      answers = (SELECT COALESCE(jsonb_object_agg(k, v), '{}'::jsonb) FROM jsonb_each(answers) e(k, v) WHERE jsonb_typeof(v) IN ('number', 'boolean'))
                WHERE tenant_id = $1 AND submitted_at < NOW() - make_interval(days => $2)
                  AND (contact_id IS NOT NULL OR respondent_email IS NOT NULL
                       OR EXISTS (SELECT 1 FROM jsonb_each(answers) e(k, v) WHERE jsonb_typeof(v) NOT IN ('number', 'boolean')))
               RETURNING id`,
              [tenantId, days],
            );
    // UPDATE/DELETE … RETURNING comes back as [rows, affected count].
    const rows = (Array.isArray(result) && Array.isArray(result[0]) ? result[0] : result) as { id: string }[];
    return rows.map((r) => r.id);
  }
}
