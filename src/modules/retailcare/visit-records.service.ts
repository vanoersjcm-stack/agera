import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, type EntityManager, Repository } from 'typeorm';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { AuditService } from '../core/audit/audit.service.js';
import { TenantContext } from '../core/tenancy/tenant-context.service.js';
import { TenantRepository } from '../core/tenancy/tenant-repository.js';
import { StorageService } from '../core/storage/storage.service.js';
import { UserService } from '../user/user.service.js';
import { MerchandisingVisit } from './entities/merchandising-visit.entity.js';
import { VisitMedia } from './entities/visit-media.entity.js';
import { VisitReport } from './entities/visit-report.entity.js';
import { IMAGE_EXTENSIONS, type ImageMimeType } from './media/image-type.js';

export interface SaveReportInput {
  summary: string | null;
  auditData: Record<string, unknown>;
}

export interface VisitSummary {
  visit: MerchandisingVisit;
  report: VisitReport | null;
  media: VisitMedia[];
}

export interface MediaDownload {
  media: VisitMedia;
  stream: Readable;
}

/** Visit reports and media. Both bump the visit's updated_at so `GET /visits?updatedSince` picks them up. */
@Injectable()
export class VisitRecordsService {
  private readonly logger = new Logger(VisitRecordsService.name);
  private readonly visits: TenantRepository<MerchandisingVisit>;
  private readonly reports: TenantRepository<VisitReport>;
  private readonly media: TenantRepository<VisitMedia>;

  constructor(
    @InjectRepository(MerchandisingVisit) visits: Repository<MerchandisingVisit>,
    @InjectRepository(VisitReport) reports: Repository<VisitReport>,
    @InjectRepository(VisitMedia) media: Repository<VisitMedia>,
    private readonly context: TenantContext,
    private readonly dataSource: DataSource,
    private readonly storage: StorageService,
    private readonly userService: UserService,
    private readonly audit: AuditService,
  ) {
    this.visits = new TenantRepository(visits, context);
    this.reports = new TenantRepository(reports, context);
    this.media = new TenantRepository(media, context);
  }

  async saveReport(
    visitId: string,
    input: SaveReportInput,
    identity: AuthenticatedUser,
  ): Promise<{ report: VisitReport; created: boolean }> {
    const actor = await this.userService.resolveActor(identity);

    const result = await this.dataSource.transaction(async (manager) => {
      await this.lockOpenVisit(manager, visitId);
      const reports = this.reports.withManager(manager);
      const existing = await reports.findOneBy({ visitId });
      const report = existing ?? reports.create({ visitId });
      report.summary = input.summary;
      report.auditData = input.auditData;
      await reports.save(report);
      await this.touchVisit(manager, visitId);
      const saved = await reports.findOneBy({ visitId });
      if (!saved) {
        throw new NotFoundException('Visit report not found');
      }
      return { report: saved, created: existing === null };
    });

    this.audit.logAction(this.context.tenantId, actor.id, 'visit.report_saved', {
      visitId,
      reportId: result.report.id,
      created: result.created,
    });
    return result;
  }

  async addMedia(
    visitId: string,
    file: { data: Buffer; mimeType: ImageMimeType },
    identity: AuthenticatedUser,
  ): Promise<VisitMedia> {
    const actor = await this.userService.resolveActor(identity);
    const id = randomUUID();
    const filePath = `${this.context.tenantId}/${visitId}/${id}.${IMAGE_EXTENSIONS[file.mimeType]}`;
    let written = false;

    try {
      const media = await this.dataSource.transaction(async (manager) => {
        await this.lockOpenVisit(manager, visitId);
        await this.storage.put(filePath, file.data);
        written = true;
        const repository = this.media.withManager(manager);
        await repository.save(
          repository.create({ id, visitId, filePath, mimeType: file.mimeType, fileSizeBytes: file.data.length }),
        );
        await this.touchVisit(manager, visitId);
        const saved = await repository.findOneBy({ id });
        if (!saved) {
          throw new NotFoundException('Visit media not found');
        }
        return saved;
      });

      this.audit.logAction(this.context.tenantId, actor.id, 'visit.media_uploaded', {
        visitId,
        mediaId: id,
        mimeType: file.mimeType,
        fileSizeBytes: file.data.length,
      });
      return media;
    } catch (error) {
      if (written) {
        await this.storage.delete(filePath);
      }
      throw error;
    }
  }

  /** Removes the row first; the file is deleted after commit so a failed transaction never loses a file. */
  async deleteMedia(visitId: string, mediaId: string, identity: AuthenticatedUser): Promise<void> {
    const actor = await this.userService.resolveActor(identity);

    const media = await this.dataSource.transaction(async (manager) => {
      const visit = await this.visits.withManager(manager).findOne({
        where: { id: visitId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!visit) {
        throw new NotFoundException('Visit not found');
      }
      const repository = this.media.withManager(manager);
      const existing = await repository.findOneBy({ id: mediaId, visitId });
      if (!existing) {
        throw new NotFoundException('Visit media not found');
      }
      const { filePath, mimeType, fileSizeBytes } = existing;
      await repository.remove(existing);
      await this.touchVisit(manager, visitId);
      return { filePath, mimeType, fileSizeBytes };
    });

    try {
      await this.storage.delete(media.filePath);
    } catch (error) {
      this.logger.error(`Media ${mediaId} deleted but its file could not be removed: ${String(error)}`);
    }
    this.audit.logAction(this.context.tenantId, actor.id, 'visit.media_deleted', {
      visitId,
      mediaId,
      mimeType: media.mimeType,
      fileSizeBytes: media.fileSizeBytes,
    });
  }

  async openMedia(visitId: string, mediaId: string): Promise<MediaDownload> {
    const media = await this.media.findOneBy({ id: mediaId, visitId });
    if (!media) {
      throw new NotFoundException('Visit media not found');
    }
    const stream = await this.storage.get(media.filePath);
    if (!stream) {
      throw new NotFoundException('Visit media file is missing');
    }
    return { media, stream };
  }

  async summary(visitId: string): Promise<VisitSummary> {
    const visit = await this.visits.findOneBy({ id: visitId });
    if (!visit) {
      throw new NotFoundException('Visit not found');
    }
    const [report, media] = await Promise.all([
      this.reports.findOneBy({ visitId }),
      this.media.find({ where: { visitId }, order: { createdAt: 'ASC', id: 'ASC' } }),
    ]);
    return { visit, report, media };
  }

  private async lockOpenVisit(manager: EntityManager, visitId: string): Promise<void> {
    const visit = await this.visits.withManager(manager).findOne({
      where: { id: visitId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!visit) {
      throw new NotFoundException('Visit not found');
    }
    if (visit.status === 'CANCELLED') {
      throw new ConflictException('Cannot add reports or media to a CANCELLED visit');
    }
  }

  private async touchVisit(manager: EntityManager, visitId: string): Promise<void> {
    await manager.query('UPDATE merchandising_visits SET updated_at = NOW() WHERE tenant_id = $1 AND id = $2', [
      this.context.tenantId,
      visitId,
    ]);
  }
}
