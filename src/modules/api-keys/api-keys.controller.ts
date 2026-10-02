import {
  Body,
  Controller,
  DefaultValuePipe,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { PLATFORM_ADMIN_ROLE, Roles } from '../auth/roles.decorator.js';
import { ApiErrors, ApiPagination, BEARER_AUTH } from '../core/http/api-docs.js';
import { asObject, assertPagination, optionalUuid, parseTimestamp, requiredString } from '../core/http/validation.js';
import type { ApiKey } from './api-key.entity.js';
import { type CreateApiKeyInput, ApiKeysService } from './api-keys.service.js';
import { ApiKeyDto, ApiKeyPageDto, CreateApiKeyDto, CreatedApiKeyDto } from './dto/api-key.dto.js';

function toResponse(apiKey: ApiKey): ApiKeyDto {
  return {
    id: apiKey.id,
    tenantId: apiKey.tenantId,
    name: apiKey.name,
    keyPrefix: apiKey.keyPrefix,
    createdAt: apiKey.createdAt,
    expiresAt: apiKey.expiresAt ?? null,
  };
}

function parseCreateApiKey(body: unknown): CreateApiKeyInput {
  const { name, tenantId, expiresAt } = asObject(body);
  return {
    name: requiredString('name', name, 100),
    tenantId: optionalUuid('tenantId', tenantId),
    expiresAt: parseTimestamp('expiresAt', expiresAt ?? undefined),
  };
}

@ApiTags('api-keys')
@ApiBearerAuth(BEARER_AUTH)
@ApiErrors(401, 403)
@Roles(PLATFORM_ADMIN_ROLE)
@Controller('api-keys')
export class ApiKeysController {
  constructor(private readonly apiKeys: ApiKeysService) {}

  @Post()
  @ApiOperation({
    summary: 'Create a tenant-scoped API key for a portal connector (platform-admin, audit: api_key.created)',
    description: 'The plaintext key is returned once in `key`; only its hash is stored.',
  })
  @ApiBody({ type: CreateApiKeyDto })
  @ApiCreatedResponse({ type: CreatedApiKeyDto })
  @ApiErrors(400)
  async create(@Body() body: unknown, @CurrentUser() identity: AuthenticatedUser): Promise<CreatedApiKeyDto> {
    const { apiKey, key } = await this.apiKeys.create(parseCreateApiKey(body), identity);
    return { ...toResponse(apiKey), key };
  }

  @Get()
  @ApiOperation({ summary: 'List API keys of all tenants, newest first (platform-admin)' })
  @ApiPagination()
  @ApiQuery({ name: 'tenantId', required: false, schema: { type: 'string', format: 'uuid' } })
  @ApiOkResponse({ type: ApiKeyPageDto })
  @ApiErrors(400)
  async list(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('tenantId') tenantId?: string,
  ): Promise<ApiKeyPageDto> {
    assertPagination(page, limit);
    const result = await this.apiKeys.list(page, limit, optionalUuid('tenantId', tenantId));
    return { ...result, items: result.items.map(toResponse) };
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Revoke (delete) an API key (platform-admin, audit: api_key.revoked)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiNoContentResponse({ description: 'Revoked; the key stops working immediately' })
  @ApiErrors(400, 404)
  async revoke(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() identity: AuthenticatedUser): Promise<void> {
    await this.apiKeys.revoke(id, identity);
  }
}
