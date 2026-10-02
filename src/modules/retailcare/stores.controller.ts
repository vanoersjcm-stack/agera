import { Body, Controller, DefaultValuePipe, Get, ParseIntPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AllowApiKey } from '../auth/allow-api-key.decorator.js';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { ApiErrors, ApiPagination, BEARER_AUTH } from '../core/http/api-docs.js';
import { asObject, assertPagination, optionalString, requiredString } from '../core/http/validation.js';
import { CreateStoreDto, StoreDto, StorePageDto } from './dto/store.dto.js';
import type { Store } from './entities/store.entity.js';
import { type CreateStoreInput, StoresService } from './stores.service.js';

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
