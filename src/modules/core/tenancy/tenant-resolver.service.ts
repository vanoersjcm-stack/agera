import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { AuthenticatedUser } from '../../auth/authenticated-user.js';
import { Tenant } from '../entities/index.js';
import type { ActiveTenant } from './tenant-context.service.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class TenantResolver {
  constructor(@InjectRepository(Tenant) private readonly tenants: Repository<Tenant>) {}

  async resolve(user: AuthenticatedUser): Promise<ActiveTenant> {
    if (user.tenantIdClaim !== null) {
      if (!UUID_PATTERN.test(user.tenantIdClaim)) {
        throw new ForbiddenException('Invalid tenant_id claim');
      }
      const tenant = await this.tenants.findOneBy({ id: user.tenantIdClaim });
      if (!tenant) {
        throw new ForbiddenException('Unknown tenant in tenant_id claim');
      }
      return { id: tenant.id, name: tenant.name, domain: tenant.domain, source: 'claim' };
    }

    const domain = user.email.split('@')[1];
    const tenant = domain ? await this.tenants.findOneBy({ domain }) : null;
    if (!tenant) {
      throw new ForbiddenException('No tenant could be resolved for this user');
    }
    return { id: tenant.id, name: tenant.name, domain: tenant.domain, source: 'domain' };
  }
}
