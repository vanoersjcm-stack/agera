import { Body, Controller, DefaultValuePipe, Get, ParseIntPipe, Post, Query } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { asObject, assertPagination, optionalString, requiredString } from '../core/http/validation.js';
import type { Store } from './entities/store.entity.js';
import { type CreateStoreInput, StoresService } from './stores.service.js';

export interface StoreResponse {
  id: string;
  tenantId: string;
  storeCode: string;
  name: string;
  address: string | null;
  city: string | null;
  postalCode: string | null;
  country: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function toResponse(store: Store): StoreResponse {
  return {
    id: store.id,
    tenantId: store.tenantId,
    storeCode: store.storeCode,
    name: store.name,
    address: store.address ?? null,
    city: store.city ?? null,
    postalCode: store.postalCode ?? null,
    country: store.country ?? null,
    createdAt: store.createdAt,
    updatedAt: store.updatedAt,
  };
}

function parseCreateStore(body: unknown): CreateStoreInput {
  const { storeCode, name, address, city, postalCode, country } = asObject(body);
  return {
    storeCode: requiredString('storeCode', storeCode, 50),
    name: requiredString('name', name, 200),
    address: optionalString('address', address, 255),
    city: optionalString('city', city, 100),
    postalCode: optionalString('postalCode', postalCode, 20),
    country: optionalString('country', country, 100) ?? 'ES',
  };
}

@Controller('stores')
export class StoresController {
  constructor(private readonly stores: StoresService) {}

  @Post()
  async create(@Body() body: unknown, @CurrentUser() identity: AuthenticatedUser): Promise<StoreResponse> {
    return toResponse(await this.stores.create(parseCreateStore(body), identity));
  }

  @Get()
  async list(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ): Promise<{ items: StoreResponse[]; page: number; limit: number; total: number }> {
    assertPagination(page, limit);
    const result = await this.stores.list(page, limit);
    return { ...result, items: result.items.map(toResponse) };
  }
}
