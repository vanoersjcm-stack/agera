import {BadRequestException, Body, Controller, DefaultValuePipe, Get, Param, ParseIntPipe, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { AllowApiKey } from '../auth/allow-api-key.decorator.js';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { ApiErrors, ApiPagination, BEARER_AUTH } from '../core/http/api-docs.js';
import { asObject, assertPagination, optionalString, optionalUuid, requiredString } from '../core/http/validation.js';
import { CreateStoreDto, StoreDto, StorePageDto, UpdateStoreDto } from './dto/store.dto.js';
import { STORE_STATUSES, type Store, type StoreStatus } from './entities/store.entity.js';
import { type CreateStoreInput, StoresService, type UpdateStoreInput } from './stores.service.js';

function toResponse(store: Store): StoreDto {
  return {
    id: store.id,
    tenantId: store.tenantId,
    storeCode: store.storeCode,
    name: store.name,
    address: store.address ?? null,
    city: store.city ?? null,
    postalCode: store.postalCode ?? null,
    country: store.country ?? null,
    status: store.status,
    clientId: store.clientId ?? null,
    createdAt: store.createdAt,
    updatedAt: store.updatedAt,
  };
}

function parseCreateStore(body: unknown): CreateStoreInput {
  const { storeCode, name, address, city, postalCode, country, clientId } = asObject(body);
  return {
    storeCode: requiredString('storeCode', storeCode, 50),
    name: requiredString('name', name, 200),
    address: optionalString('address', address, 255),
    city: optionalString('city', city, 100),
    postalCode: optionalString('postalCode', postalCode, 20),
    country: optionalString('country', country, 100) ?? 'ES',
    clientId: optionalUuid('clientId', clientId),
  };
}

function parseUpdateStore(body: unknown): UpdateStoreInput {
  const raw = asObject(body);
  const out: UpdateStoreInput = {};
  if (raw.storeCode !== undefined) out.storeCode = requiredString('storeCode', raw.storeCode, 50);
  if (raw.name !== undefined) out.name = requiredString('name', raw.name, 200);
  for (const [key, max] of [['address', 255], ['city', 100], ['postalCode', 20], ['country', 100]] as const) {
    if (raw[key] !== undefined) out[key] = optionalString(key, raw[key], max);
  }
  if (raw.clientId !== undefined) out.clientId = optionalUuid('clientId', raw.clientId);
  if (raw.status !== undefined) {
    if (!STORE_STATUSES.includes(raw.status as StoreStatus)) {
      throw new BadRequestException(`status must be one of ${STORE_STATUSES.join(', ')}`);
    }
    out.status = raw.status as StoreStatus;
  }
  if (Object.keys(out).length === 0) {
    throw new BadRequestException('Provide at least one field to change');
  }
  return out;
}

@ApiTags('stores')
@ApiBearerAuth(BEARER_AUTH)
@ApiErrors(401, 403)
@Controller('stores')
export class StoresController {
  constructor(private readonly stores: StoresService) {}

  @Post()
  @ApiOperation({ summary: 'Create a RetailCare store in the active tenant (audit: store.created)' })
  @ApiBody({ type: CreateStoreDto })
  @ApiCreatedResponse({ type: StoreDto })
  @ApiErrors(400, 409)
  async create(@Body() body: unknown, @CurrentUser() identity: AuthenticatedUser): Promise<StoreDto> {
    return toResponse(await this.stores.create(parseCreateStore(body), identity));
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Edit a store: name, code, address or status (audit: store.updated)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody({ type: UpdateStoreDto })
  @ApiOkResponse({ type: StoreDto })
  @ApiErrors(400, 404, 409)
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @CurrentUser() identity: AuthenticatedUser): Promise<StoreDto> {
    return toResponse(await this.stores.update(id, parseUpdateStore(body), identity));
  }

  @Get()
  @AllowApiKey()
  @ApiOperation({ summary: 'List stores of the active tenant, sorted by storeCode' })
  @ApiPagination()
  @ApiOkResponse({ type: StorePageDto })
  @ApiErrors(400)
  async list(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ): Promise<StorePageDto> {
    assertPagination(page, limit);
    const result = await this.stores.list(page, limit);
    return { ...result, items: result.items.map(toResponse) };
  }
}
