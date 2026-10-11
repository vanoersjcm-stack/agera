import { BadRequestException } from '@nestjs/common';

export const PERIOD_CODE_PATTERN = /^\d{4}-(Q[1-4]|0[1-9]|1[0-2])$/;

/** A P&L period filter: a whole year (`2026`), a quarter (`2026-Q1`, which includes its months) or a month (`2026-01`). */
export type PeriodFilter = { kind: 'year'; year: string } | { kind: 'codes'; codes: string[] };

export function parsePeriodFilter(value: unknown): PeriodFilter | null {
  if (value === undefined || value === '') {
    return null;
  }
  if (typeof value === 'string' && /^\d{4}$/.test(value)) {
    return { kind: 'year', year: value };
  }
  if (typeof value !== 'string' || !PERIOD_CODE_PATTERN.test(value)) {
    throw new BadRequestException('period must be YYYY, YYYY-Qn or YYYY-MM');
  }
  const quarter = /^(\d{4})-Q([1-4])$/.exec(value);
  if (!quarter) {
    return { kind: 'codes', codes: [value] };
  }
  const first = (Number(quarter[2]) - 1) * 3 + 1;
  const months = [first, first + 1, first + 2].map((m) => `${quarter[1]}-${String(m).padStart(2, '0')}`);
  return { kind: 'codes', codes: [value, ...months] };
}
