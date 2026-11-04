import { HttpException, HttpStatus } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import type { LicenseTier } from '../entities/tenant.entity.js';

const tierChangedAt = new Map<string, number>();

/** Called when an organisation's edition changes: tokens issued before this moment carry a stale tier claim. */
export function markTierChanged(tenantId: string): void {
  tierChangedAt.set(tenantId, Date.now());
}

/** The `tenant_license_tier` claim, unless the edition changed after the token was issued. */
export function claimedTier(tenantId: string, claim: LicenseTier | null | undefined, issuedAtMs: number | null | undefined): LicenseTier | null {
  if (!claim || !issuedAtMs) return null;
  const changed = tierChangedAt.get(tenantId);
  return changed !== undefined && issuedAtMs <= changed ? null : claim;
}

/** Tenant edition: the token claim on the active tenant when present and fresh, else the database. */
export async function licenseTier(m: EntityManager, tenant: string | { id: string; licenseTier?: LicenseTier }): Promise<LicenseTier> {
  if (typeof tenant !== 'string' && tenant.licenseTier) return tenant.licenseTier;
  const tenantId = typeof tenant === 'string' ? tenant : tenant.id;
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

export async function assertEnterprise(m: EntityManager, tenant: string | { id: string; licenseTier?: LicenseTier }, feature: string): Promise<void> {
  if ((await licenseTier(m, tenant)) !== 'symphony') throw enterpriseRequired(feature);
}
