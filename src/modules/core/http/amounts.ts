import { BadRequestException } from '@nestjs/common';

const AMOUNT_PATTERN = /^-?\d{1,13}(\.\d{1,2})?$/;

/** Parses a NUMERIC(15,2) amount given as a JSON number or decimal string; returns it as a decimal string. */
export function parseAmount(name: string, value: unknown): string {
  const text = typeof value === 'number' && Number.isFinite(value) ? String(value) : value;
  if (typeof text !== 'string' || !AMOUNT_PATTERN.test(text)) {
    throw new BadRequestException(`${name} must be a decimal amount with at most 13 digits and 2 decimals`);
  }
  return text;
}

export function parseOptionalAmount(name: string, value: unknown): string | null {
  return value === undefined || value === null ? null : parseAmount(name, value);
}
