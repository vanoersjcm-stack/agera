import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { parseAmount, parseOptionalAmount } from '../core/http/amounts.js';
import { ApiErrors, BEARER_AUTH } from '../core/http/api-docs.js';
import { asObject, optionalString, optionalUuid, requiredString } from '../core/http/validation.js';
import {
  CreateFinancialLineItemDto,
  CreateFinancialModelDto,
  FinancialLineItemDto,
  FinancialModelDto,
  PnlDto,
  UpdateFinancialLineItemDto,
  UpdateFinancialModelStatusDto,
} from './dto/financials.dto.js';
import { type FinancialLineItem, FINANCIAL_CATEGORIES, isFinancialCategory } from './entities/financial-line-item.entity.js';
import { type FinancialModel, FINANCIAL_MODEL_STATUSES, isFinancialModelStatus } from './entities/financial-model.entity.js';
import {
  type CreateLineItemInput,
  type CreateModelInput,
  FinancialsService,
  type UpdateLineItemInput,
} from './financials.service.js';
import { PERIOD_CODE_PATTERN, parsePeriodFilter } from './period.js';

function toModelResponse(model: FinancialModel): FinancialModelDto {
  return {
    id: model.id,
    tenantId: model.tenantId,
    modelName: model.modelName,
    fiscalYear: model.fiscalYear,
    status: model.status,
    metadata: model.metadata,
    createdAt: model.createdAt,
    updatedAt: model.updatedAt,
  };
}

function toLineItemResponse(item: FinancialLineItem): FinancialLineItemDto {
  return {
    id: item.id,
    tenantId: item.tenantId,
    modelId: item.modelId,
    category: item.category,
    subcategory: item.subcategory ?? null,
    periodCode: item.periodCode,
    projectedAmount: item.projectedAmount,
    actualAmount: item.actualAmount ?? null,
    variance: item.variance ?? null,
    currency: item.currency,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

function parseFiscalYear(value: unknown, name = 'fiscalYear'): number {
  const year = typeof value === 'string' && /^\d{4}$/.test(value) ? Number(value) : value;
  if (typeof year !== 'number' || !Number.isInteger(year) || year < 2000 || year > 2100) {
    throw new BadRequestException(`${name} must be an integer between 2000 and 2100`);
  }
  return year;
}

function parseCreateModel(body: unknown): CreateModelInput {
  const { modelName, fiscalYear, status, metadata } = asObject(body);
  if (status !== undefined && !isFinancialModelStatus(status)) {
    throw new BadRequestException(`status must be one of ${FINANCIAL_MODEL_STATUSES.join(', ')}`);
  }
  if (metadata !== undefined && (typeof metadata !== 'object' || metadata === null || Array.isArray(metadata))) {
    throw new BadRequestException('metadata must be a JSON object');
  }
  return {
    modelName: requiredString('modelName', modelName, 100),
    fiscalYear: parseFiscalYear(fiscalYear),
    status: status ?? 'draft',
    metadata: (metadata as Record<string, unknown> | undefined) ?? {},
  };
}

function parseCreateLineItem(body: unknown): CreateLineItemInput {
  const { category, subcategory, periodCode, projectedAmount, actualAmount, currency } = asObject(body);
  if (!isFinancialCategory(category)) {
    throw new BadRequestException(`category must be one of ${FINANCIAL_CATEGORIES.join(', ')}`);
  }
  if (typeof periodCode !== 'string' || !PERIOD_CODE_PATTERN.test(periodCode)) {
    throw new BadRequestException('periodCode must be YYYY-Qn or YYYY-MM');
  }
  if (currency !== undefined && (typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency))) {
    throw new BadRequestException('currency must be a 3-letter ISO 4217 code');
  }
  return {
    category,
    subcategory: optionalString('subcategory', subcategory, 100),
    periodCode,
    projectedAmount: parseAmount('projectedAmount', projectedAmount),
    actualAmount: parseOptionalAmount('actualAmount', actualAmount),
    currency: currency ?? 'EUR',
  };
}

function parseUpdateLineItem(body: unknown): UpdateLineItemInput {
  const raw = asObject(body);
  const input: UpdateLineItemInput = {};
  if (raw.projectedAmount !== undefined) {
    input.projectedAmount = parseAmount('projectedAmount', raw.projectedAmount);
  }
  if (raw.actualAmount !== undefined) {
    input.actualAmount = parseOptionalAmount('actualAmount', raw.actualAmount);
  }
  if (Object.keys(input).length === 0) {
    throw new BadRequestException('Provide projectedAmount and/or actualAmount');
  }
  return input;
}

@ApiTags('financials')
@ApiBearerAuth(BEARER_AUTH)
@ApiErrors(401, 403)
@Controller({ path: 'financials', version: '1' })
export class FinancialsController {
  constructor(private readonly financials: FinancialsService) {}

  @Get('pnl')
  @ApiOperation({
    summary: 'Aggregated P&L: projection vs. actuals per period and category',
    description:
      'Filtered by the caller\'s tenant (enforced by PostgreSQL row-level security) and optionally by model, fiscal ' +
      'year and period. Without modelId, only approved models are aggregated. A quarter (2026-Q1) also includes ' +
      'monthly lines of that quarter (2026-01..03).',
  })
  @ApiQuery({ name: 'modelId', required: false, format: 'uuid' })
  @ApiQuery({ name: 'fiscalYear', required: false, type: Number, example: 2026 })
  @ApiQuery({ name: 'period', required: false, description: 'YYYY, YYYY-Qn or YYYY-MM', example: '2026-Q1' })
  @ApiOkResponse({ type: PnlDto })
  @ApiErrors(400, 404)
  async pnl(
    @Query('modelId') modelId?: string,
    @Query('fiscalYear') fiscalYear?: string,
    @Query('period') period?: string,
  ): Promise<PnlDto> {
    const filters = {
      modelId: optionalUuid('modelId', modelId),
      fiscalYear: fiscalYear === undefined ? null : parseFiscalYear(fiscalYear),
      period: period === undefined || period === '' ? null : period,
    };
    const result = await this.financials.pnl({
      modelId: filters.modelId,
      fiscalYear: filters.fiscalYear,
      period: parsePeriodFilter(period),
    });
    return { filters, ...result };
  }

  @Post('models')
  @ApiOperation({ summary: 'Create a financial model (audit: financial_model.created)' })
  @ApiBody({ type: CreateFinancialModelDto })
  @ApiCreatedResponse({ type: FinancialModelDto })
  @ApiErrors(400)
  async createModel(@Body() body: unknown, @CurrentUser() identity: AuthenticatedUser): Promise<FinancialModelDto> {
    return toModelResponse(await this.financials.createModel(parseCreateModel(body), identity));
  }

  @Get('models')
  @ApiOperation({ summary: 'List financial models of the tenant' })
  @ApiQuery({ name: 'fiscalYear', required: false, type: Number })
  @ApiOkResponse({ type: [FinancialModelDto] })
  @ApiErrors(400)
  async listModels(@Query('fiscalYear') fiscalYear?: string): Promise<FinancialModelDto[]> {
    const year = fiscalYear === undefined ? null : parseFiscalYear(fiscalYear);
    return (await this.financials.listModels(year)).map(toModelResponse);
  }

  @Get('models/:id')
  @ApiOperation({ summary: 'Get a financial model' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: FinancialModelDto })
  @ApiErrors(400, 404)
  async getModel(@Param('id', ParseUUIDPipe) id: string): Promise<FinancialModelDto> {
    return toModelResponse(await this.financials.getModel(id));
  }

  @Patch('models/:id/status')
  @ApiOperation({ summary: 'Change a model status (audit: financial_model.status_changed)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody({ type: UpdateFinancialModelStatusDto })
  @ApiOkResponse({ type: FinancialModelDto })
  @ApiErrors(400, 404)
  async updateModelStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @CurrentUser() identity: AuthenticatedUser,
  ): Promise<FinancialModelDto> {
    const { status } = asObject(body);
    if (!isFinancialModelStatus(status)) {
      throw new BadRequestException(`status must be one of ${FINANCIAL_MODEL_STATUSES.join(', ')}`);
    }
    return toModelResponse(await this.financials.updateModelStatus(id, status, identity));
  }

  @Get('models/:id/line-items')
  @ApiOperation({ summary: 'List the line items of a model' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: [FinancialLineItemDto] })
  @ApiErrors(400, 404)
  async listLineItems(@Param('id', ParseUUIDPipe) id: string): Promise<FinancialLineItemDto[]> {
    return (await this.financials.listLineItems(id)).map(toLineItemResponse);
  }

  @Post('models/:id/line-items')
  @ApiOperation({ summary: 'Add a projected (and optionally actual) line item (audit: financial_line_item.created)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody({ type: CreateFinancialLineItemDto })
  @ApiCreatedResponse({ type: FinancialLineItemDto })
  @ApiErrors(400, 404)
  async addLineItem(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @CurrentUser() identity: AuthenticatedUser,
  ): Promise<FinancialLineItemDto> {
    return toLineItemResponse(await this.financials.addLineItem(id, parseCreateLineItem(body), identity));
  }

  @Patch('line-items/:id')
  @ApiOperation({ summary: 'Record actuals or revise the projection (audit: financial_line_item.updated)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody({ type: UpdateFinancialLineItemDto })
  @ApiOkResponse({ type: FinancialLineItemDto })
  @ApiErrors(400, 404)
  async updateLineItem(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @CurrentUser() identity: AuthenticatedUser,
  ): Promise<FinancialLineItemDto> {
    return toLineItemResponse(await this.financials.updateLineItem(id, parseUpdateLineItem(body), identity));
  }
}
