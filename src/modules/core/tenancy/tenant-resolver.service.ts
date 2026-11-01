import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { ApiKeyPrincipal, AuthenticatedUser } from '../../auth/authenticated-user.js';
import { Tenant } from '../entities/index.js';
import { EXTERNAL_CLIENT_ROLE, PLATFORM_ADMIN_ROLE } from '../../auth/roles.decorator.js';
import type { ActiveTenant } from './tenant-context.service.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class TenantResolver {
  constructor(@InjectRepository(Tenant) private readonly tenants: Repository<Tenant>) {}

  async resolveApiKey(apiKey: ApiKeyPrincipal): Promise<ActiveTenant> {
    const tenant = await this.tenants.findOneBy({ id: apiKey.tenantId });
    if (!tenant) {
      throw new ForbiddenException('Unknown tenant for this API key');
    }
    return { id: tenant.id, name: tenant.name, domain: tenant.domain, source: 'apiKey', access: { scope: 'apiKey' } };
  }

  /** `requested` (X-Agera-Organisation header) lets platform admins view another organisation read-only. */
  async resolve(user: AuthenticatedUser, requested?: string): Promise<ActiveTenant> {
    const home = await this.resolveHome(user);
    if (!requested || requested.toLowerCase() === home.id.toLowerCase()) {
      return home;
    }
    if (home.access.scope !== 'internal' || !user.roles.includes(PLATFORM_ADMIN_ROLE)) {
      throw new ForbiddenException('Only platform administrators can view other organisations');
    }
    if (!UUID_PATTERN.test(requested)) {
      throw new BadRequestException('X-Agera-Organisation must be an organisation id (UUID)');
    }
    const tenant = await this.tenants.findOneBy({ id: requested });
    if (!tenant) {
      throw new ForbiddenException('Unknown organisation in X-Agera-Organisation');
    }
    return { id: tenant.id, name: tenant.name, domain: tenant.domain, source: 'switch', access: { scope: 'internal' }, readOnly: true };
  }

  private async resolveHome(user: AuthenticatedUser): Promise<ActiveTenant> {
    if (user.roles.includes(EXTERNAL_CLIENT_ROLE)) {
      return this.resolveExternal(user);
    }
    if (user.tenantIdClaim !== null) {
      if (!UUID_PATTERN.test(user.tenantIdClaim)) {
        throw new ForbiddenException('Invalid tenant_id claim');
      }
      const tenant = await this.tenants.findOneBy({ id: user.tenantIdClaim });
      if (!tenant) {
        throw new ForbiddenException('Unknown tenant in tenant_id claim');
      }
      return { id: tenant.id, name: tenant.name, domain: tenant.domain, source: 'claim', access: { scope: 'internal' } };
    }

    const domain = user.email.split('@')[1];
    const tenant = domain ? await this.tenants.findOneBy({ domain }) : null;
    if (!tenant) {
      throw new ForbiddenException('No tenant could be resolved for this user');
    }
    return { id: tenant.id, name: tenant.name, domain: tenant.domain, source: 'domain', access: { scope: 'internal' } };
  }

  /** External users need both claims; there is no email-domain fallback for them. */
  private async resolveExternal(user: AuthenticatedUser): Promise<ActiveTenant> {
    if (user.tenantIdClaim === null || !UUID_PATTERN.test(user.tenantIdClaim)) {
      throw new ForbiddenException('External users need a valid tenant_id claim');
    }
    if (user.clientIdClaim === null || !UUID_PATTERN.test(user.clientIdClaim)) {
      throw new ForbiddenException('External users need a valid client_id claim');
    }
    const tenant = await this.tenants.findOneBy({ id: user.tenantIdClaim });
    if (!tenant) {
      throw new ForbiddenException('Unknown tenant in tenant_id claim');
    }
    return {
      id: tenant.id,
      name: tenant.name,
      domain: tenant.domain,
      source: 'claim',
      access: { scope: 'external', clientId: user.clientIdClaim.toLowerCase() },
    };
  }
}
