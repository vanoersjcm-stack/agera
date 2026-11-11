import { randomInt } from 'node:crypto';
import { BadRequestException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig, PrintConfig } from '../../config/configuration.js';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { AuditService } from '../core/audit/audit.service.js';
import { TenantContext } from '../core/tenancy/tenant-context.service.js';
import { TenantTransaction } from '../core/tenancy/tenant-transaction.service.js';
import { OfficeService } from '../office/office.service.js';
import { UserService } from '../user/user.service.js';
import { ippEndpoints, printerAttributes, printJob } from './ipp.js';

export interface PrintStatus {
  configured: boolean;
  connected: boolean;
  printer: string | null;
  jobTtlMinutes: number;
  error: string | null;
}

export interface PrintJobView {
  id: string;
  documentId: string;
  documentTitle: string;
  version: number;
  status: 'queued' | 'released' | 'expired';
  /** Release code; only shown while the job is queued. */
  code: string | null;
  copies: number;
  expiresAt: Date;
  releasedAt: Date | null;
  createdAt: Date;
}

const JOB_SQL = `SELECT j.id, j.document_id AS "documentId", d.title AS "documentTitle", j.version, j.status,
                        CASE WHEN j.status = 'queued' THEN j.pin_or_token END AS code, j.copies,
                        j.expires_at AS "expiresAt", j.released_at AS "releasedAt", j.created_at AS "createdAt"
                   FROM print_jobs j JOIN room_documents d ON d.tenant_id = j.tenant_id AND d.id = j.document_id`;

/** Pull printing: jobs wait in Agera until their owner releases them with the code; then they go to the local CUPS printer over IPP(S). */
@Injectable()
export class PrintService {
  private readonly logger = new Logger(PrintService.name);
  private readonly config: PrintConfig;
  private checked: { at: number; status: PrintStatus } | null = null;

  constructor(
    config: ConfigService<AppConfig, true>,
    private readonly tx: TenantTransaction,
    private readonly context: TenantContext,
    private readonly office: OfficeService,
    private readonly users: UserService,
    private readonly audit: AuditService,
  ) {
    this.config = config.get('print', { infer: true });
  }

  /** Cached for one minute, like the SMTP status. */
  async status(): Promise<PrintStatus> {
    const { ippUrl, jobTtlMinutes } = this.config;
    if (!ippUrl) return { configured: false, connected: false, printer: null, jobTtlMinutes, error: null };
    if (this.checked && Date.now() - this.checked.at < 60_000) return this.checked.status;
    let printer: string | null = null;
    let status: PrintStatus;
    try {
      printer = ippEndpoints(ippUrl).printerUri;
      const r = await printerAttributes(ippUrl);
      status = { configured: true, connected: r.ok, printer, jobTtlMinutes, error: r.ok ? null : `IPP status ${r.statusCode}` };
    } catch (error) {
      status = { configured: true, connected: false, printer, jobTtlMinutes, error: error instanceof Error ? error.message : String(error) };
    }
    this.checked = { at: Date.now(), status };
    return status;
  }

  async queue(documentId: string, copies: number, identity: AuthenticatedUser): Promise<PrintJobView> {
    const actor = await this.users.resolveActor(identity);
    const job = await this.tx.run(async (m) => {
      await m.query(`UPDATE print_jobs SET status = 'expired' WHERE tenant_id = $1 AND status = 'queued' AND expires_at < NOW()`, [this.context.tenantId]);
      const [doc] = await m.query(`SELECT current_version, idms_status FROM room_documents WHERE tenant_id = $1 AND id = $2`, [this.context.tenantId, documentId]);
      if (!doc) throw new NotFoundException('Document not found');
      if (doc.idms_status === 'EXPIRED_PURGE') throw new BadRequestException('This document has expired and cannot be printed');
      const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
      const [row] = await m.query(
        `INSERT INTO print_jobs (tenant_id, document_id, version, user_id, pin_or_token, copies, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW() + make_interval(mins => $7)) RETURNING id`,
        [this.context.tenantId, documentId, doc.current_version, actor.id, code, copies, this.config.jobTtlMinutes],
      );
      return this.view(m, row.id as string);
    });
    this.audit.logAction(this.context.tenantId, actor.id, 'print.queued', { jobId: job.id, documentId, version: job.version, copies });
    return job;
  }

  async mine(identity: AuthenticatedUser): Promise<PrintJobView[]> {
    const actor = await this.users.resolveActor(identity);
    return this.tx.run(async (m) => {
      await m.query(`UPDATE print_jobs SET status = 'expired' WHERE tenant_id = $1 AND user_id = $2 AND status = 'queued' AND expires_at < NOW()`, [this.context.tenantId, actor.id]);
      return m.query(`${JOB_SQL} WHERE j.tenant_id = $1 AND j.user_id = $2 ORDER BY j.created_at DESC LIMIT 50`, [this.context.tenantId, actor.id]);
    });
  }

  /** Release the caller's own queued job with its code (typed at the printer or read from the QR code). */
  async release(code: string, identity: AuthenticatedUser): Promise<PrintJobView> {
    const actor = await this.users.resolveActor(identity);
    const job = await this.tx.run(async (m) => {
      await m.query(`UPDATE print_jobs SET status = 'expired' WHERE tenant_id = $1 AND user_id = $2 AND status = 'queued' AND expires_at < NOW()`, [this.context.tenantId, actor.id]);
      const [row] = await m.query(`SELECT id FROM print_jobs WHERE tenant_id = $1 AND user_id = $2 AND status = 'queued' AND pin_or_token = $3`, [this.context.tenantId, actor.id, code]);
      return row ? this.view(m, row.id as string) : null;
    });
    if (!job) {
      this.audit.logAction(this.context.tenantId, actor.id, 'print.release_failed', {});
      throw new NotFoundException('No queued print job with this code (it may have expired)');
    }
    const url = this.config.ippUrl;
    if (!url) throw new ServiceUnavailableException('Print server not connected');
    const pdf = await this.office.pdfFor(job.documentId, job.version);
    let ok = false;
    let detail = '';
    try {
      const r = await printJob(url, pdf, { user: actor.email, jobName: job.documentTitle, copies: job.copies });
      ok = r.ok;
      detail = `IPP status ${r.statusCode}`;
    } catch (error) {
      detail = error instanceof Error ? error.message : String(error);
    }
    if (!ok) {
      this.logger.warn(`print job ${job.id} not accepted by the printer: ${detail}`);
      this.checked = null;
      throw new ServiceUnavailableException(`The print server did not accept the job (${detail})`);
    }
    const released = await this.tx.run(async (m) => {
      await m.query(`UPDATE print_jobs SET status = 'released', released_at = NOW() WHERE tenant_id = $1 AND id = $2 AND status = 'queued'`, [this.context.tenantId, job.id]);
      return this.view(m, job.id);
    });
    this.audit.logAction(this.context.tenantId, actor.id, 'print.released', { jobId: job.id, documentId: job.documentId, version: job.version, copies: job.copies });
    return released;
  }

  private async view(m: { query: (sql: string, params: unknown[]) => Promise<PrintJobView[]> }, id: string): Promise<PrintJobView> {
    const [row] = await m.query(`${JOB_SQL} WHERE j.tenant_id = $1 AND j.id = $2`, [this.context.tenantId, id]);
    if (!row) throw new NotFoundException('Print job not found');
    return row;
  }
}
