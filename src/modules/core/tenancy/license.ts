import { HttpException, HttpStatus } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import type { LicenseTier } from '../entities/tenant.entity.js';

export async function licenseTier(m: EntityManager, tenantId: string): Promise<LicenseTier> {
  const [row] = await m.query('SELECT license_tier FROM tenants WHERE id = $1', [tenantId]);
  return (row?.license_tier as LicenseTier) ?? 'symphony';
}

/** 402 with an upgrade message when a Vanguard organisation uses an Enterprise-only feature. */
export function enterpriseRequired(feature: string): HttpException {
  return new HttpException(
    { statusCode: 402, error: 'Payment Required', message: `${feature} needs Agera Symphony (Enterprise tier required). Ask your administrator to upgrade from Agera Vanguard.` },
    HttpStatus.PAYMENT_REQUIRED,
  );
}

export async function assertEnterprise(m: EntityManager, tenantId: string, feature: string): Promise<void> {
  if ((await licenseTier(m, tenantId)) !== 'symphony') throw enterpriseRequired(feature);
}
