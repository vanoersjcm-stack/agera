import { createHash, randomBytes } from 'node:crypto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { type FindOptionsWhere, Repository } from 'typeorm';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { AuditService } from '../core/audit/audit.service.js';
import { Tenant } from '../core/entities/index.js';
import { TenantContext } from '../core/tenancy/tenant-context.service.js';
import { UserService } from '../user/user.service.js';
import { ApiKey } from './api-key.entity.js';

const KEY_PREFIX = 'agk_';
const PREFIX_LENGTH = 12;

export interface CreateApiKeyInput {
  name: string;
  /** Defaults to the caller's tenant. */
  tenantId: string | null;
  expiresAt: Date | null;
}

export interface ApiKeyPage {
  items: ApiKey[];
  page: number;
  limit: number;
  total: number;
}

function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

/**
 * API keys are looked up before any tenant is known and are managed by platform admins across tenants,
 * so this service uses the raw repository; each key row carries the tenant it grants access to.
 */
@Injectable()
export class ApiKeysService {
  constructor(
    @InjectRepository(ApiKey) private readonly keys: Repository<ApiKey>,
    @InjectRepository(Tenant) private readonly tenants: Repository<Tenant>,
    private readonly context: TenantContext,
    private readonly userService: UserService,
    private readonly audit: AuditService,
  ) {}

  /** Returns the key row for a valid, unexpired key, otherwise null. */
  async authenticate(rawKey: string): Promise<ApiKey | null> {
    if (!rawKey.startsWith(KEY_PREFIX) || rawKey.length > 200) {
      return null;
    }
    const key = await this.keys.findOneBy({ keyHash: hashKey(rawKey) });
    if (!key || (key.expiresAt !== null && key.expiresAt.getTime() <= Date.now())) {
      return null;
    }
    return key;
  }

  async create(input: CreateApiKeyInput, identity: AuthenticatedUser): Promise<{ apiKey: ApiKey; key: string }> {
    const actor = await this.userService.resolveActor(identity);
    const tenantId = input.tenantId ?? this.context.tenantId;
    if (!(await this.tenants.existsBy({ id: tenantId }))) {
      throw new BadRequestException('tenantId is not a known tenant');
    }
    if (input.expiresAt !== null && input.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException('expiresAt must be in the future');
    }

    const key = `${KEY_PREFIX}${randomBytes(32).toString('base64url')}`;
    const apiKey = await this.keys.save(
      this.keys.create({
        tenantId,
        name: input.name,
        keyPrefix: key.slice(0, PREFIX_LENGTH),
        keyHash: hashKey(key),
        expiresAt: input.expiresAt,
      }),
    );
    this.audit.logAction(this.context.tenantId, actor.id, 'api_key.created', {
      apiKeyId: apiKey.id,
      keyTenantId: tenantId,
      name: apiKey.name,
      expiresAt: apiKey.expiresAt,
    });
    return { apiKey, key };
  }

  async list(page: number, limit: number, tenantId: string | null): Promise<ApiKeyPage> {
    const where: FindOptionsWhere<ApiKey> = tenantId === null ? {} : { tenantId };
    const [items, total] = await this.keys.findAndCount({
      where,
      order: { createdAt: 'DESC', id: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return { items, page, limit, total };
  }

  async revoke(id: string, identity: AuthenticatedUser): Promise<void> {
    const actor = await this.userService.resolveActor(identity);
    const apiKey = await this.keys.findOneBy({ id });
    if (!apiKey) {
      throw new NotFoundException('API key not found');
    }
    await this.keys.delete({ id });
    this.audit.logAction(this.context.tenantId, actor.id, 'api_key.revoked', {
      apiKeyId: id,
      keyTenantId: apiKey.tenantId,
      name: apiKey.name,
    });
  }
}
