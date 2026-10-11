import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { EntityManager, Repository } from 'typeorm';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { AuditService } from '../core/audit/audit.service.js';
import { TenantContext } from '../core/tenancy/tenant-context.service.js';
import { TenantRepository } from '../core/tenancy/tenant-repository.js';
import { TenantTransaction } from '../core/tenancy/tenant-transaction.service.js';
import { UserService } from '../user/user.service.js';
import { type FinancialCategory, FinancialLineItem } from './entities/financial-line-item.entity.js';
import { FinancialModel, type FinancialModelStatus } from './entities/financial-model.entity.js';
import type { PeriodFilter } from './period.js';

export interface CreateModelInput {
  modelName: string;
  fiscalYear: number;
  status: FinancialModelStatus;
  metadata: Record<string, unknown>;
}

export interface CreateLineItemInput {
  category: FinancialCategory;
  subcategory: string | null;
  periodCode: string;
  projectedAmount: string;
  actualAmount: string | null;
  currency: string;
}

export interface UpdateLineItemInput {
  projectedAmount?: string;
  actualAmount?: string | null;
}

export interface PnlQuery {
  modelId: string | null;
  fiscalYear: number | null;
  period: PeriodFilter | null;
}

export interface PnlAggregate {
  periodCode: string | null;
  category: FinancialCategory;
  currency: string;
  lineCount: number;
  projected: string;
  actual: string | null;
  variance: string | null;
  variancePercent: number | null;
}

export interface PnlResult {
  rows: PnlAggregate[];
  totals: PnlAggregate[];
}

@Injectable()
export class FinancialsService {
  private readonly models: TenantRepository<FinancialModel>;
  private readonly lineItems: TenantRepository<FinancialLineItem>;

  constructor(
    @InjectRepository(FinancialModel) models: Repository<FinancialModel>,
    @InjectRepository(FinancialLineItem) lineItems: Repository<FinancialLineItem>,
    private readonly context: TenantContext,
    private readonly tx: TenantTransaction,
    private readonly userService: UserService,
    private readonly audit: AuditService,
  ) {
    this.models = new TenantRepository(models, context);
    this.lineItems = new TenantRepository(lineItems, context);
  }

  async createModel(input: CreateModelInput, identity: AuthenticatedUser): Promise<FinancialModel> {
    const actor = await this.userService.resolveActor(identity);
    const model = await this.tx.run(async (manager) => {
      const models = this.models.withManager(manager);
      const saved = await models.save(models.create(input));
      return this.requireModel(manager, saved.id);
    });
    this.audit.logAction(this.context.tenantId, actor.id, 'financial_model.created', {
      modelId: model.id,
      fiscalYear: model.fiscalYear,
      status: model.status,
    });
    return model;
  }

  listModels(fiscalYear: number | null): Promise<FinancialModel[]> {
    return this.tx.run((manager) =>
      this.models.withManager(manager).find({
        where: fiscalYear === null ? {} : { fiscalYear },
        order: { fiscalYear: 'DESC', createdAt: 'DESC' },
      }),
    );
  }

  getModel(id: string): Promise<FinancialModel> {
    return this.tx.run((manager) => this.requireModel(manager, id));
  }

  async updateModelStatus(id: string, status: FinancialModelStatus, identity: AuthenticatedUser): Promise<FinancialModel> {
    const actor = await this.userService.resolveActor(identity);
    const { model, previous } = await this.tx.run(async (manager) => {
      const current = await this.requireModel(manager, id);
      const previousStatus = current.status;
      current.status = status;
      await this.models.withManager(manager).save(current);
      return { model: await this.requireModel(manager, id), previous: previousStatus };
    });
    this.audit.logAction(this.context.tenantId, actor.id, 'financial_model.status_changed', {
      modelId: id,
      previousStatus: previous,
      newStatus: status,
    });
    return model;
  }

  listLineItems(modelId: string): Promise<FinancialLineItem[]> {
    return this.tx.run(async (manager) => {
      await this.requireModel(manager, modelId);
      return this.lineItems.withManager(manager).find({
        where: { modelId },
        order: { periodCode: 'ASC', category: 'ASC', createdAt: 'ASC' },
      });
    });
  }

  async addLineItem(modelId: string, input: CreateLineItemInput, identity: AuthenticatedUser): Promise<FinancialLineItem> {
    const actor = await this.userService.resolveActor(identity);
    const item = await this.tx.run(async (manager) => {
      await this.requireModel(manager, modelId);
      const items = this.lineItems.withManager(manager);
      const saved = await items.save(items.create({ ...input, modelId }));
      return this.requireLineItem(manager, saved.id);
    });
    this.audit.logAction(this.context.tenantId, actor.id, 'financial_line_item.created', {
      modelId,
      lineItemId: item.id,
      category: item.category,
      periodCode: item.periodCode,
    });
    return item;
  }

  async updateLineItem(id: string, input: UpdateLineItemInput, identity: AuthenticatedUser): Promise<FinancialLineItem> {
    const actor = await this.userService.resolveActor(identity);
    const item = await this.tx.run(async (manager) => {
      const current = await this.requireLineItem(manager, id);
      if (input.projectedAmount !== undefined) {
        current.projectedAmount = input.projectedAmount;
      }
      if (input.actualAmount !== undefined) {
        current.actualAmount = input.actualAmount;
      }
      await this.lineItems.withManager(manager).save(current);
      return this.requireLineItem(manager, id);
    });
    this.audit.logAction(this.context.tenantId, actor.id, 'financial_line_item.updated', {
      lineItemId: id,
      projectedAmount: item.projectedAmount,
      actualAmount: item.actualAmount,
    });
    return item;
  }

  /**
   * Projected vs. actual per period and category (rows) and per category over the whole selection (totals).
   * Without a modelId only approved models are included. `variance` and `variancePercent` cover only lines
   * that already have actuals, so periods without actuals do not show the full projection as a shortfall.
   */
  pnl(query: PnlQuery): Promise<PnlResult> {
    return this.tx.run(async (manager) => {
      if (query.modelId !== null) {
        await this.requireModel(manager, query.modelId);
      }
      const params: unknown[] = [this.context.tenantId];
      const where = ['li.tenant_id = $1', 'm.tenant_id = $1'];
      if (query.modelId !== null) {
        params.push(query.modelId);
        where.push(`li.model_id = $${params.length}`);
      } else {
        where.push(`m.status = 'approved'`);
      }
      if (query.fiscalYear !== null) {
        params.push(query.fiscalYear);
        where.push(`m.fiscal_year = $${params.length}`);
      }
      if (query.period?.kind === 'year') {
        params.push(`${query.period.year}-%`);
        where.push(`li.period_code LIKE $${params.length}`);
      } else if (query.period?.kind === 'codes') {
        params.push(query.period.codes);
        where.push(`li.period_code = ANY($${params.length}::text[])`);
      }

      const rows: PnlAggregate[] = await manager.query(
        `SELECT li.period_code AS "periodCode",
                li.category,
                li.currency,
                COUNT(*)::int AS "lineCount",
                SUM(li.projected_amount)::text AS projected,
                SUM(li.actual_amount)::text AS actual,
                SUM(li.variance)::text AS variance,
                ROUND(SUM(li.variance) * 100
                      / NULLIF(SUM(li.projected_amount) FILTER (WHERE li.actual_amount IS NOT NULL), 0), 2)::float8
                  AS "variancePercent"
           FROM financial_line_items li
           JOIN financial_models m ON m.tenant_id = li.tenant_id AND m.id = li.model_id
          WHERE ${where.join(' AND ')}
          GROUP BY GROUPING SETS ((li.period_code, li.category, li.currency), (li.category, li.currency))
          ORDER BY li.period_code NULLS LAST,
                   array_position(ARRAY['revenue', 'license_fee', 'cogs', 'opex']::varchar[], li.category),
                   li.currency`,
        params,
      );
      return {
        rows: rows.filter((row) => row.periodCode !== null),
        totals: rows.filter((row) => row.periodCode === null),
      };
    });
  }

  private async requireModel(manager: EntityManager, id: string): Promise<FinancialModel> {
    const model = await this.models.withManager(manager).findOneBy({ id });
    if (!model) {
      throw new NotFoundException('Financial model not found');
    }
    return model;
  }

  private async requireLineItem(manager: EntityManager, id: string): Promise<FinancialLineItem> {
    const item = await this.lineItems.withManager(manager).findOneBy({ id });
    if (!item) {
      throw new NotFoundException('Financial line item not found');
    }
    return item;
  }
}
