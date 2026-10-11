import type { Category } from './api';

export const CATEGORY_LABELS: Record<Category, string> = {
  revenue: 'Revenue',
  license_fee: 'License fees',
  cogs: 'Cost of goods sold',
  opex: 'Operating expenses',
};

/** Above plan is good for income, bad for costs. */
const COST_CATEGORIES: Category[] = ['cogs', 'opex'];

export function formatAmount(value: string | null, currency: string): string {
  if (value === null) {
    return '–';
  }
  return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(Number(value));
}

export function varianceTone(category: Category, variance: string | null): 'good' | 'bad' | 'neutral' {
  if (variance === null || Number(variance) === 0) {
    return 'neutral';
  }
  const above = Number(variance) > 0;
  return above !== COST_CATEGORIES.includes(category) ? 'good' : 'bad';
}

export function formatPercent(value: number | null): string {
  return value === null ? '' : `${value > 0 ? '+' : ''}${value.toFixed(1)}%`;
}
