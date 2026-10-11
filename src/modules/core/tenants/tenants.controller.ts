import { BadRequestException, Body, Controller, Get, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiTags,
} from '@nestjs/swagger';
import { AllowApiKey } from '../../auth/allow-api-key.decorator.js';
import { AllowExternal } from '../../auth/allow-external.decorator.js';
import type { AuthenticatedUser } from '../../auth/authenticated-user.js';
import { CurrentUser } from '../../auth/current-user.decorator.js';
import { PLATFORM_ADMIN_ROLE, Roles } from '../../auth/roles.decorator.js';
import type { Tenant } from '../entities/index.js';
import { ApiErrors, BEARER_AUTH } from '../http/api-docs.js';
import { asObject } from '../http/validation.js';
import { TenantContext, type TenantSource } from '../tenancy/tenant-context.service.js';
import { type CreateTenantInput, TenantsService } from './tenants.service.js';

const DOMAIN_PATTERN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export class CreateTenantDto {
  @ApiProperty({ maxLength: 100, example: 'Nordic BV' })
  name!: string;

  @ApiProperty({ maxLength: 150, example: 'nordic.eu', description: 'Email domain mapped to this tenant (lower-cased)' })
  domain!: string;
}

export class TenantDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Acme Test' })
  name!: string;

  @ApiProperty({ example: 'acme.test' })
  domain!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: Date;
}

export class ActiveTenantDto extends TenantDto {
  @ApiProperty({ enum: ['claim', 'domain', 'apiKey'], description: 'How the tenant was resolved for this request' })
  resolvedBy!: TenantSource;
}

function toResponse(tenant: Tenant): TenantDto {
  return {
    id: tenant.id,
    name: tenant.name,
    domain: tenant.domain,
    createdAt: tenant.createdAt,
    updatedAt: tenant.updatedAt,
  };
}

function parseCreateTenant(body: unknown): CreateTenantInput {
  const { name, domain } = asObject(body);
  if (typeof name !== 'string' || name.trim().length === 0 || name.trim().length > 100) {
    throw new BadRequestException('name must be a non-empty string of at most 100 characters');
  }
  const normalizedDomain = typeof domain === 'string' ? domain.trim().toLowerCase() : '';
  if (normalizedDomain.length > 150 || !DOMAIN_PATTERN.test(normalizedDomain)) {
    throw new BadRequestException('domain must be a valid hostname of at most 150 characters');
  }
  return { name: name.trim(), domain: normalizedDomain };
}

@ApiTags('tenants')
@ApiBearerAuth(BEARER_AUTH)
@ApiErrors(401, 403)
@Controller('tenants')
export class TenantsController {
  constructor(
    private readonly tenants: TenantsService,
    private readonly context: TenantContext,
  ) {}

  @Get('me')
  @AllowApiKey()
  @AllowExternal()
  @ApiOperation({ summary: 'Active tenant of the caller' })
  @ApiOkResponse({ type: ActiveTenantDto })
  async me(): Promise<ActiveTenantDto> {
    const tenant = await this.tenants.getActive();
    return { ...toResponse(tenant), resolvedBy: this.context.tenant.source };
  }

  @Post()
  @Roles(PLATFORM_ADMIN_ROLE)
  @ApiOperation({ summary: 'Create a tenant (realm role platform-admin)' })
  @ApiBody({ type: CreateTenantDto })
  @ApiCreatedResponse({ type: TenantDto })
  @ApiErrors(400, 409)
  async create(@Body() body: unknown, @CurrentUser() actor: AuthenticatedUser): Promise<TenantDto> {
    return toResponse(await this.tenants.create(parseCreateTenant(body), actor));
  }
}
