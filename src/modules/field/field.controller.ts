import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { ApiErrors, BEARER_AUTH } from '../core/http/api-docs.js';
import { amount, asObject, oneOf, optionalDate, optionalString, optionalUuid, parseTimestamp, requiredString } from '../core/http/validation.js';
import { FieldService, ORDER_STATUSES, type OrderLineInput, type PlanogramItemInput, type ProductInput } from './field.service.js';

const OBJ = { schema: { type: 'object' } };

function int(name: string, value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) throw new BadRequestException(`${name} must be a whole number between ${min} and ${max}`);
  return value;
}

function uuidList(name: string, value: unknown, max: number): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > max) throw new BadRequestException(`${name} must be a list of 1 to ${max} ids`);
  return value.map((v, i) => {
    const id = optionalUuid(`${name}[${i}]`, v);
    if (!id) throw new BadRequestException(`${name}[${i}] must be a uuid`);
    return id;
  });
}

function productFields(raw: Record<string, unknown>, partial: boolean): Partial<ProductInput> {
  const out: Partial<ProductInput> = {};
  if (!partial || raw.sku !== undefined) out.sku = requiredString('sku', raw.sku, 60);
  if (!partial || raw.name !== undefined) out.name = requiredString('name', raw.name, 200);
  if (!partial || raw.brand !== undefined) out.brand = optionalString('brand', raw.brand, 100);
  if (!partial || raw.category !== undefined) out.category = optionalString('category', raw.category, 100);
  if (!partial || raw.unitPrice !== undefined) out.unitPrice = amount('unitPrice', raw.unitPrice ?? 0);
  if (raw.active !== undefined) {
    if (typeof raw.active !== 'boolean') throw new BadRequestException('active must be true or false');
    out.active = raw.active;
  }
  return out;
}

function planogramItems(value: unknown): PlanogramItemInput[] {
  if (!Array.isArray(value) || value.length > 200) throw new BadRequestException('items must be a list of at most 200 products');
  return value.map((v, i) => {
    const o = asObject(v);
    const productId = optionalUuid(`items[${i}].productId`, o.productId);
    if (!productId) throw new BadRequestException(`items[${i}].productId is required`);
    return { productId, expectedFacings: int(`items[${i}].expectedFacings`, o.expectedFacings ?? 1, 1, 999), shelf: optionalString(`items[${i}].shelf`, o.shelf, 50) };
  });
}

function orderLines(value: unknown): OrderLineInput[] {
  if (!Array.isArray(value) || value.length > 200) throw new BadRequestException('lines must be a list of at most 200 products');
  const lines = value.map((v, i) => {
    const o = asObject(v);
    const productId = optionalUuid(`lines[${i}].productId`, o.productId);
    if (!productId) throw new BadRequestException(`lines[${i}].productId is required`);
    return { productId, quantity: int(`lines[${i}].quantity`, o.quantity, 1, 100000) };
  });
  if (new Set(lines.map((l) => l.productId)).size !== lines.length) throw new BadRequestException('each product may appear only once');
  return lines;
}

@ApiTags('field')
@ApiBearerAuth(BEARER_AUTH)
@ApiErrors(401, 403)
@Controller({ path: 'field', version: '1' })
export class FieldController {
  constructor(private readonly field: FieldService) {}

  @Get('products')
  @ApiOperation({ summary: 'Product catalogue' })
  @ApiQuery({ name: 'includeInactive', required: false, type: Boolean })
  @ApiOkResponse(OBJ)
  products(@Query('includeInactive') includeInactive?: string): Promise<unknown[]> {
    return this.field.products(includeInactive === 'true');
  }

  @Post('products')
  @ApiOperation({ summary: 'Add a product (audit: product.created)' })
  @ApiBody(OBJ)
  @ApiCreatedResponse(OBJ)
  @ApiErrors(400, 409)
  createProduct(@Body() body: unknown, @CurrentUser() identity: AuthenticatedUser): Promise<unknown> {
    return this.field.createProduct(productFields(asObject(body), false) as ProductInput, identity);
  }

  @Patch('products/:id')
  @ApiOperation({ summary: 'Edit or (de)activate a product (audit: product.updated)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody(OBJ)
  @ApiOkResponse(OBJ)
  @ApiErrors(400, 404, 409)
  updateProduct(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @CurrentUser() identity: AuthenticatedUser): Promise<unknown> {
    return this.field.updateProduct(id, productFields(asObject(body), true), identity);
  }

  @Get('planograms')
  @ApiOperation({ summary: 'Planograms (with storeId: the active ones that apply to that store)' })
  @ApiQuery({ name: 'storeId', required: false })
  @ApiOkResponse(OBJ)
  planograms(@Query('storeId') storeId?: string): Promise<unknown[]> {
    return this.field.planograms(optionalUuid('storeId', storeId));
  }

  @Get('planograms/:id')
  @ApiOperation({ summary: 'Planogram with its products and expected facings' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse(OBJ)
  @ApiErrors(404)
  planogram(@Param('id', ParseUUIDPipe) id: string): Promise<unknown> {
    return this.field.planogram(id);
  }

  @Post('planograms')
  @ApiOperation({ summary: 'Create a planogram (audit: planogram.created)' })
  @ApiBody(OBJ)
  @ApiCreatedResponse(OBJ)
  @ApiErrors(400)
  createPlanogram(@Body() body: unknown, @CurrentUser() identity: AuthenticatedUser): Promise<unknown> {
    const raw = asObject(body);
    return this.field.createPlanogram(
      {
        name: requiredString('name', raw.name, 200),
        category: optionalString('category', raw.category, 100),
        storeId: optionalUuid('storeId', raw.storeId),
        items: raw.items === undefined ? [] : planogramItems(raw.items),
      },
      identity,
    );
  }

  @Patch('planograms/:id')
  @ApiOperation({ summary: 'Edit a planogram; items replaces the product list (audit: planogram.updated)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody(OBJ)
  @ApiOkResponse(OBJ)
  @ApiErrors(400, 404)
  updatePlanogram(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @CurrentUser() identity: AuthenticatedUser): Promise<unknown> {
    const raw = asObject(body);
    if (raw.active !== undefined && typeof raw.active !== 'boolean') throw new BadRequestException('active must be true or false');
    return this.field.updatePlanogram(
      id,
      {
        ...(raw.name !== undefined ? { name: requiredString('name', raw.name, 200) } : {}),
        ...(raw.category !== undefined ? { category: optionalString('category', raw.category, 100) } : {}),
        ...(raw.storeId !== undefined ? { storeId: optionalUuid('storeId', raw.storeId) } : {}),
        ...(raw.active !== undefined ? { active: raw.active as boolean } : {}),
        ...(raw.items !== undefined ? { items: planogramItems(raw.items) } : {}),
      },
      identity,
    );
  }

  @Get('orders')
  @ApiOperation({ summary: 'Field orders (latest 200)' })
  @ApiQuery({ name: 'status', required: false, enum: ORDER_STATUSES })
  @ApiQuery({ name: 'storeId', required: false })
  @ApiOkResponse(OBJ)
  @ApiErrors(400)
  orders(@Query('status') status?: string, @Query('storeId') storeId?: string): Promise<unknown[]> {
    return this.field.orders(status ? oneOf('status', status, ORDER_STATUSES) : null, optionalUuid('storeId', storeId));
  }

  @Get('orders/:id')
  @ApiOperation({ summary: 'Field order with lines and total' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse(OBJ)
  @ApiErrors(404)
  order(@Param('id', ParseUUIDPipe) id: string): Promise<unknown> {
    return this.field.order(id);
  }

  @Post('orders')
  @ApiOperation({ summary: 'Create a draft field order for a store; prices are taken from the catalogue (audit: field_order.created)' })
  @ApiBody(OBJ)
  @ApiCreatedResponse(OBJ)
  @ApiErrors(400)
  createOrder(@Body() body: unknown, @CurrentUser() identity: AuthenticatedUser): Promise<unknown> {
    const raw = asObject(body);
    const storeId = optionalUuid('storeId', raw.storeId);
    if (!storeId) throw new BadRequestException('storeId is required');
    return this.field.createOrder(
      { storeId, visitId: optionalUuid('visitId', raw.visitId), notes: optionalString('notes', raw.notes, 2000), lines: raw.lines === undefined ? [] : orderLines(raw.lines) },
      identity,
    );
  }

  @Patch('orders/:id')
  @ApiOperation({ summary: 'Change notes or lines of a draft order (audit: field_order.updated)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody(OBJ)
  @ApiOkResponse(OBJ)
  @ApiErrors(400, 404, 409)
  updateOrder(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @CurrentUser() identity: AuthenticatedUser): Promise<unknown> {
    const raw = asObject(body);
    return this.field.updateOrder(
      id,
      { ...(raw.notes !== undefined ? { notes: optionalString('notes', raw.notes, 2000) } : {}), ...(raw.lines !== undefined ? { lines: orderLines(raw.lines) } : {}) },
      identity,
    );
  }

  @Patch('orders/:id/status')
  @ApiOperation({ summary: 'Submit, confirm, deliver or cancel an order (audit: field_order.status_changed)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody(OBJ)
  @ApiOkResponse(OBJ)
  @ApiErrors(400, 404, 409)
  setOrderStatus(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @CurrentUser() identity: AuthenticatedUser): Promise<unknown> {
    return this.field.setOrderStatus(id, oneOf('status', asObject(body).status, ORDER_STATUSES), identity);
  }

  @Get('audit-rounds')
  @ApiOperation({ summary: 'Audit rounds with progress' })
  @ApiOkResponse(OBJ)
  rounds(): Promise<unknown[]> {
    return this.field.rounds();
  }

  @Get('audit-rounds/:id')
  @ApiOperation({ summary: 'Audit round with its store visits and results' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse(OBJ)
  @ApiErrors(404)
  round(@Param('id', ParseUUIDPipe) id: string): Promise<unknown> {
    return this.field.round(id);
  }

  @Post('audit-rounds')
  @ApiOperation({ summary: 'Create an audit round and plan one visit per store (audit: audit_round.created)' })
  @ApiBody(OBJ)
  @ApiCreatedResponse(OBJ)
  @ApiErrors(400)
  createRound(@Body() body: unknown, @CurrentUser() identity: AuthenticatedUser): Promise<unknown> {
    const raw = asObject(body);
    const checklist = raw.checklist === undefined ? [] : raw.checklist;
    if (!Array.isArray(checklist) || checklist.length > 30 || checklist.some((c) => typeof c !== 'string' || c.trim() === '' || c.length > 200)) {
      throw new BadRequestException('checklist must be a list of up to 30 items (max 200 characters each)');
    }
    const visitDate = parseTimestamp('visitDate', raw.visitDate);
    if (!visitDate) throw new BadRequestException('visitDate is required');
    return this.field.createRound(
      {
        name: requiredString('name', raw.name, 200),
        checklist: checklist.map((c: string) => c.trim()),
        dueDate: optionalDate('dueDate', raw.dueDate),
        visitDate,
        fieldRepId: optionalUuid('fieldRepId', raw.fieldRepId),
        storeIds: uuidList('storeIds', raw.storeIds, 200),
      },
      identity,
    );
  }

  @Patch('audit-rounds/:id/status')
  @ApiOperation({ summary: 'Close or reopen an audit round (audit: audit_round.closed / reopened)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody(OBJ)
  @ApiOkResponse(OBJ)
  @ApiErrors(400, 404)
  setRoundStatus(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @CurrentUser() identity: AuthenticatedUser): Promise<unknown> {
    return this.field.setRoundStatus(id, oneOf('status', asObject(body).status, ['open', 'closed'] as const), identity);
  }

  @Get('visits/:visitId/context')
  @ApiOperation({ summary: 'Audit-round checklist and applicable planograms for a visit report' })
  @ApiParam({ name: 'visitId', format: 'uuid' })
  @ApiOkResponse(OBJ)
  @ApiErrors(404)
  visitContext(@Param('visitId', ParseUUIDPipe) visitId: string): Promise<unknown> {
    return this.field.visitContext(visitId);
  }
}
