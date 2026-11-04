import { BadRequestException, Body, Controller, Delete, Get, Header, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiParam, ApiProduces, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { ApiErrors, BEARER_AUTH } from '../core/http/api-docs.js';
import { asObject, oneOf, requiredString } from '../core/http/validation.js';
import { AGGREGATES, FILTER_OPS, type ReportDefinition, type ReportResult, ReportsService } from './reports.service.js';

const OBJ = { schema: { type: 'object' } };

function definition(value: unknown): ReportDefinition {
  const raw = asObject(value);
  const list = (v: unknown, name: string): unknown[] => {
    if (v === undefined || v === null) return [];
    if (!Array.isArray(v)) throw new BadRequestException(`${name} must be a list`);
    return v;
  };
  const agg = raw.aggregate === undefined || raw.aggregate === null ? null : asObject(raw.aggregate);
  const sort = raw.sort === undefined || raw.sort === null ? null : asObject(raw.sort);
  const limit = raw.limit ?? 500;
  if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 10000) throw new BadRequestException('limit must be 1 to 10000');
  return {
    dataset: requiredString('dataset', raw.dataset, 50),
    columns: list(raw.columns, 'columns').map((c, i) => requiredString(`columns[${i}]`, c, 50)),
    filters: list(raw.filters, 'filters').map((f, i) => {
      const o = asObject(f);
      return { column: requiredString(`filters[${i}].column`, o.column, 50), op: oneOf(`filters[${i}].op`, o.op, FILTER_OPS), value: requiredString(`filters[${i}].value`, String(o.value ?? ''), 200) };
    }),
    groupBy: raw.groupBy === undefined || raw.groupBy === null || raw.groupBy === '' ? null : requiredString('groupBy', raw.groupBy, 50),
    aggregate: agg ? { fn: oneOf('aggregate.fn', agg.fn, AGGREGATES), column: agg.column ? requiredString('aggregate.column', agg.column, 50) : null } : null,
    sort: sort ? { column: requiredString('sort.column', sort.column, 50), direction: oneOf('sort.direction', sort.direction ?? 'asc', ['asc', 'desc'] as const) } : null,
    limit,
  };
}

function bool(name: string, v: unknown): boolean | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== 'boolean') throw new BadRequestException(`${name} must be true or false`);
  return v;
}

@ApiTags('reports')
@ApiBearerAuth(BEARER_AUTH)
@Controller({ path: 'reports', version: '1' })
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('datasets')
  @ApiOperation({ summary: 'Report sources and their columns' })
  @ApiOkResponse(OBJ)
  datasets(): unknown {
    return this.reports.datasets();
  }

  @Get('kpis')
  @ApiOperation({ summary: 'Fixed KPI dashboard (all editions)' })
  @ApiOkResponse(OBJ)
  kpis(): Promise<unknown> {
    return this.reports.kpis();
  }

  @Get('datasets/:key/export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'CSV export of a whole dataset (all editions; audit: report.exported)' })
  @ApiParam({ name: 'key', example: 'invoices' })
  @ApiProduces('text/csv')
  @ApiOkResponse({ description: 'CSV file', schema: { type: 'string' } })
  @ApiErrors(404)
  export(@Param('key') key: string, @CurrentUser() identity: AuthenticatedUser): Promise<string> {
    return this.reports.export(key, identity);
  }

  @Post('run')
  @HttpCode(200)
  @ApiOperation({ summary: 'Run a custom report: columns, filters, grouping and totals (Enterprise only; 402 on Vanguard)' })
  @ApiBody(OBJ)
  @ApiOkResponse(OBJ)
  @ApiErrors(400, 402)
  run(@Body() body: unknown): Promise<ReportResult> {
    return this.reports.run(definition(body));
  }

  @Get('saved')
  @ApiOperation({ summary: 'Saved reports; pinned ones are the cockpit tabs (Enterprise only)' })
  @ApiOkResponse(OBJ)
  @ApiErrors(402)
  saved(): Promise<unknown[]> {
    return this.reports.saved();
  }

  @Post('saved')
  @ApiOperation({ summary: 'Save a custom report (Enterprise only; audit: report.saved)' })
  @ApiBody(OBJ)
  @ApiCreatedResponse(OBJ)
  @ApiErrors(400, 402)
  save(@Body() body: unknown, @CurrentUser() identity: AuthenticatedUser): Promise<unknown> {
    const raw = asObject(body);
    return this.reports.save(requiredString('name', raw.name, 200), definition(raw.definition), bool('pinned', raw.pinned) ?? false, identity);
  }

  @Patch('saved/:id')
  @ApiOperation({ summary: 'Rename, change or pin/unpin a saved report (Enterprise only)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody(OBJ)
  @ApiOkResponse(OBJ)
  @ApiErrors(400, 402, 404)
  update(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown): Promise<unknown> {
    const raw = asObject(body);
    return this.reports.updateSaved(id, {
      name: raw.name === undefined ? undefined : requiredString('name', raw.name, 200),
      definition: raw.definition === undefined ? undefined : definition(raw.definition),
      pinned: bool('pinned', raw.pinned),
    });
  }

  @Delete('saved/:id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a saved report (Enterprise only)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiNoContentResponse()
  @ApiErrors(402, 404)
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.reports.removeSaved(id);
  }
}
