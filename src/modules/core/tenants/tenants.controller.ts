import { BadRequestException, Body, Controller, Get, Post } from '@nestjs/common';
import type { AuthenticatedUser } from '../../auth/authenticated-user.js';
import { CurrentUser } from '../../auth/current-user.decorator.js';
import { PLATFORM_ADMIN_ROLE, Roles } from '../../auth/roles.decorator.js';
import type { Tenant } from '../entities/index.js';
import { TenantContext, type TenantSource } from '../tenancy/tenant-context.service.js';
import { type CreateTenantInput, TenantsService } from './tenants.service.js';

const DOMAIN_PATTERN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export interface TenantResponse {
  id: string;
  name: string;
  domain: string;
  createdAt: Date;
  updatedAt: Date;
}

function toResponse(tenant: Tenant): TenantResponse {
  return {
    id: tenant.id,
    name: tenant.name,
    domain: tenant.domain,
    createdAt: tenant.createdAt,
    updatedAt: tenant.updatedAt,
  };
}

function parseCreateTenant(body: unknown): CreateTenantInput {
  if (typeof body !== 'object' || body === null) {
    throw new BadRequestException('Body must be a JSON object with name and domain');
  }
  const { name, domain } = body as Record<string, unknown>;
  if (typeof name !== 'string' || name.trim().length === 0 || name.trim().length > 100) {
    throw new BadRequestException('name must be a non-empty string of at most 100 characters');
  }
  const normalizedDomain = typeof domain === 'string' ? domain.trim().toLowerCase() : '';
  if (normalizedDomain.length > 150 || !DOMAIN_PATTERN.test(normalizedDomain)) {
    throw new BadRequestException('domain must be a valid hostname of at most 150 characters');
  }
  return { name: name.trim(), domain: normalizedDomain };
}

@Controller('tenants')
export class TenantsController {
  constructor(
    private readonly tenants: TenantsService,
    private readonly context: TenantContext,
  ) {}

  @Get('me')
  async me(): Promise<TenantResponse & { resolvedBy: TenantSource }> {
    const tenant = await this.tenants.getActive();
    return { ...toResponse(tenant), resolvedBy: this.context.tenant.source };
  }

  @Post()
  @Roles(PLATFORM_ADMIN_ROLE)
  async create(@Body() body: unknown, @CurrentUser() actor: AuthenticatedUser): Promise<TenantResponse> {
    return toResponse(await this.tenants.create(parseCreateTenant(body), actor));
  }
}
