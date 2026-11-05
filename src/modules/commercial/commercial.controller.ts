import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { ApiErrors, BEARER_AUTH } from '../core/http/api-docs.js';
import { amount, asObject, oneOf, optionalDate, optionalString, optionalUuid, requiredString } from '../core/http/validation.js';
import { CommercialService, TEMPLATE_KINDS, TEMPLATE_PLACEHOLDERS, type PriceListInput, type PriceListItemInput, type TemplateInput } from './commercial.service.js';

const OBJ = { schema: { type: 'object' } };

function bool(name: string, value: unknown): boolean {
  if (typeof value !== 'boolean') throw new BadRequestException(`${name} must be true or false`);
  return value;
}

function items(value: unknown): PriceListItemInput[] {
  if (!Array.isArray(value) || value.length > 500) throw new BadRequestException('items must be a list of at most 500 prices');
  return value.map((raw, i) => {
    const o = asObject(raw);
    const productId = optionalUuid(`items[${i}].productId`, o.productId);
    if (!productId) throw new BadRequestException(`items[${i}].productId must be a uuid`);
    const q = o.minQuantity ?? 1;
    if (typeof q !== 'number' || !Number.isInteger(q) || q < 1 || q > 1_000_000) throw new BadRequestException(`items[${i}].minQuantity must be a whole number of at least 1`);
    return { productId, unitPrice: amount(`items[${i}].unitPrice`, o.unitPrice), minQuantity: q };
  });
}

function listFields(raw: Record<string, unknown>, partial: boolean): Partial<PriceListInput> {
  const out: Partial<PriceListInput> = {};
  if (!partial || raw.name !== undefined) out.name = requiredString('name', raw.name, 200);
  if (!partial || raw.clientId !== undefined) out.clientId = optionalUuid('clientId', raw.clientId);
  if (!partial || raw.validFrom !== undefined) out.validFrom = optionalDate('validFrom', raw.validFrom);
  if (!partial || raw.validTo !== undefined) out.validTo = optionalDate('validTo', raw.validTo);
  if (out.validFrom && out.validTo && out.validTo < out.validFrom) throw new BadRequestException('validTo must be on or after validFrom');
  if (raw.active !== undefined) out.active = bool('active', raw.active);
  if (raw.items !== undefined || !partial) out.items = items(raw.items ?? []);
  return out;
}

function templateFields(raw: Record<string, unknown>, partial: boolean): Partial<TemplateInput> {
  const out: Partial<TemplateInput> = {};
  if (!partial || raw.name !== undefined) out.name = requiredString('name', raw.name, 200);
  if (!partial || raw.kind !== undefined) out.kind = oneOf('kind', raw.kind ?? 'letter', TEMPLATE_KINDS);
  if (!partial || raw.body !== undefined) out.body = requiredString('body', raw.body, 50_000);
  if (raw.active !== undefined) out.active = bool('active', raw.active);
  return out;
}

@ApiTags('commercial')
@ApiBearerAuth(BEARER_AUTH)
@Controller({ path: 'price-lists', version: '1' })
export class PriceListsController {
  constructor(private readonly commercial: CommercialService) {}

  @Get()
  @ApiOperation({ summary: 'Price lists (general and per client)' })
  @ApiQuery({ name: 'clientId', required: false })
  @ApiOkResponse(OBJ)
  list(@Query('clientId') clientId?: string): Promise<unknown[]> {
    return this.commercial.priceLists(optionalUuid('clientId', clientId));
  }

  @Get(':id')
  @ApiOperation({ summary: 'Price list with its product prices and quantity tiers' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse(OBJ)
  @ApiErrors(404)
  get(@Param('id', ParseUUIDPipe) id: string): Promise<unknown> {
    return this.commercial.priceList(id);
  }

  @Post()
  @ApiOperation({ summary: 'Create a price list; a client list overrides catalogue prices on field orders (audit: price_list.created)' })
  @ApiBody(OBJ)
  @ApiCreatedResponse(OBJ)
  @ApiErrors(400)
  create(@Body() body: unknown, @CurrentUser() identity: AuthenticatedUser): Promise<unknown> {
    return this.commercial.createPriceList(listFields(asObject(body), false) as PriceListInput, identity);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Edit a price list; items replace all prices (audit: price_list.updated)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody(OBJ)
  @ApiOkResponse(OBJ)
  @ApiErrors(400, 404)
  update(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @CurrentUser() identity: AuthenticatedUser): Promise<unknown> {
    return this.commercial.updatePriceList(id, listFields(asObject(body), true), identity);
  }
}

@ApiTags('commercial')
@ApiBearerAuth(BEARER_AUTH)
@Controller({ path: 'document-templates', version: '1' })
export class DocumentTemplatesController {
  constructor(private readonly commercial: CommercialService) {}

  @Get()
  @ApiOperation({ summary: 'Document templates, with the placeholders they may use' })
  @ApiQuery({ name: 'includeInactive', required: false, type: Boolean })
  @ApiOkResponse(OBJ)
  async list(@Query('includeInactive') includeInactive?: string): Promise<{ placeholders: readonly string[]; items: unknown[] }> {
    return { placeholders: TEMPLATE_PLACEHOLDERS, items: await this.commercial.templates(includeInactive === 'true') };
  }

  @Get(':id')
  @ApiOperation({ summary: 'One document template' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse(OBJ)
  @ApiErrors(404)
  get(@Param('id', ParseUUIDPipe) id: string): Promise<unknown> {
    return this.commercial.template(id);
  }

  @Post()
  @ApiOperation({ summary: 'Create a template; use {{client.name}} style placeholders (audit: document_template.created)' })
  @ApiBody(OBJ)
  @ApiCreatedResponse(OBJ)
  @ApiErrors(400)
  create(@Body() body: unknown, @CurrentUser() identity: AuthenticatedUser): Promise<unknown> {
    return this.commercial.createTemplate(templateFields(asObject(body), false) as TemplateInput, identity);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Edit or (de)activate a template (audit: document_template.updated)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody(OBJ)
  @ApiOkResponse(OBJ)
  @ApiErrors(400, 404)
  update(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @CurrentUser() identity: AuthenticatedUser): Promise<unknown> {
    return this.commercial.updateTemplate(id, templateFields(asObject(body), true), identity);
  }

  @Post(':id/render')
  @ApiOperation({ summary: 'Fill a template with a client room’s data (roomId) or a client’s data (clientId); neither gives the blank template with [placeholders]' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody(OBJ)
  @ApiOkResponse(OBJ)
  @ApiErrors(400, 404)
  render(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @CurrentUser() identity: AuthenticatedUser): Promise<unknown> {
    const b = asObject(body);
    return this.commercial.render(id, { roomId: optionalUuid('roomId', b.roomId), clientId: optionalUuid('clientId', b.clientId) }, identity);
  }
}

@ApiTags('commercial')
@ApiBearerAuth(BEARER_AUTH)
@Controller({ path: 'nexus/client-rooms/:roomId/documents/from-template', version: '1' })
export class RoomTemplateDocumentsController {
  constructor(private readonly commercial: CommercialService) {}

  @Post()
  @ApiOperation({ summary: 'Generate a room document from a template (stored like an upload, audit: document.uploaded)' })
  @ApiParam({ name: 'roomId', format: 'uuid' })
  @ApiBody(OBJ)
  @ApiCreatedResponse(OBJ)
  @ApiErrors(400, 404)
  generate(@Param('roomId', ParseUUIDPipe) roomId: string, @Body() body: unknown, @CurrentUser() identity: AuthenticatedUser): Promise<unknown> {
    const raw = asObject(body);
    const templateId = optionalUuid('templateId', raw.templateId);
    if (!templateId) throw new BadRequestException('templateId must be a uuid');
    return this.commercial.generate(templateId, roomId, optionalString('title', raw.title, 200), identity);
  }
}
