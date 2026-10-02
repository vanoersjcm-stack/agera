import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { type FindOptionsOrder, type FindOptionsWhere, MoreThan, Repository } from 'typeorm';
import { TenantContext } from '../core/tenancy/tenant-context.service.js';
import { type TenantOwned, TenantRepository } from '../core/tenancy/tenant-repository.js';
import { MerchandisingVisit } from '../retailcare/entities/merchandising-visit.entity.js';
import { VisitReport } from '../retailcare/entities/visit-report.entity.js';
import { WorkOrder } from '../work-orders/entities/work-order.entity.js';

interface Synced extends TenantOwned {
  id: string;
  updatedAt: Date;
}

interface Batch<T> {
  items: T[];
  hasMore: boolean;
}

export interface SyncOverview {
  workOrders: WorkOrder[];
  visits: MerchandisingVisit[];
  reports: VisitReport[];
  hasMore: boolean;
  nextUpdatedSince: Date | null;
}

/**
 * Pull-based delta feed for portal dashboards. Each collection is read oldest change first, at most
 * `limit` rows each. `nextUpdatedSince` is safe to send back as `updatedSince`: nothing changed at or
 * before it is left out (rows from collections that were not cut off may be sent again).
 */
@Injectable()
export class PortalService {
  private readonly workOrders: TenantRepository<WorkOrder>;
  private readonly visits: TenantRepository<MerchandisingVisit>;
  private readonly reports: TenantRepository<VisitReport>;

  constructor(
    @InjectRepository(WorkOrder) workOrders: Repository<WorkOrder>,
    @InjectRepository(MerchandisingVisit) visits: Repository<MerchandisingVisit>,
    @InjectRepository(VisitReport) reports: Repository<VisitReport>,
    context: TenantContext,
  ) {
    this.workOrders = new TenantRepository(workOrders, context);
    this.visits = new TenantRepository(visits, context);
    this.reports = new TenantRepository(reports, context);
  }

  async overview(updatedSince: Date | null, limit: number): Promise<SyncOverview> {
    const [workOrders, visits, reports] = await Promise.all([
      this.batch(this.workOrders, updatedSince, limit),
      this.batch(this.visits, updatedSince, limit),
      this.batch(this.reports, updatedSince, limit),
    ]);
    const batches: Batch<Synced>[] = [workOrders, visits, reports];
    const truncated = batches.filter((b) => b.hasMore);
    const candidates = (truncated.length > 0 ? truncated : batches).flatMap((b) => {
      const last = b.items.at(-1);
      return last ? [last.updatedAt.getTime()] : [];
    });
    const next =
      candidates.length === 0
        ? updatedSince
        : new Date(truncated.length > 0 ? Math.min(...candidates) : Math.max(...candidates));
    return {
      workOrders: workOrders.items,
      visits: visits.items,
      reports: reports.items,
      hasMore: truncated.length > 0,
      nextUpdatedSince: next,
    };
  }

  /** Never splits rows sharing the cut-off timestamp across two pages (unless one timestamp fills a page). */
  private async batch<T extends Synced>(
    repository: TenantRepository<T>,
    updatedSince: Date | null,
    limit: number,
  ): Promise<Batch<T>> {
    const where = (updatedSince === null ? {} : { updatedAt: MoreThan(updatedSince) }) as FindOptionsWhere<T>;
    const rows = await repository.find({
      where,
      order: { updatedAt: 'ASC', id: 'ASC' } as FindOptionsOrder<T>,
      take: limit + 1,
    });
    if (rows.length <= limit) {
      return { items: rows, hasMore: false };
    }
    const cutoff = rows[limit].updatedAt.getTime();
    const page = rows.slice(0, limit);
    const complete = page.filter((row) => row.updatedAt.getTime() !== cutoff);
    return { items: complete.length > 0 ? complete : page, hasMore: true };
  }
}
