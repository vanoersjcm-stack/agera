import { BadRequestException } from '@nestjs/common';

export const MAX_PAGE_LIMIT = 100;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:\d{2})$/;

export function asObject(body: unknown): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new BadRequestException('Body must be a JSON object');
  }
  return body as Record<string, unknown>;
}

export function assertPagination(page: number, limit: number): void {
  if (page < 1 || limit < 1 || limit > MAX_PAGE_LIMIT) {
    throw new BadRequestException(`page must be >= 1 and limit between 1 and ${MAX_PAGE_LIMIT}`);
  }
}

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

/** Parses an ISO 8601 timestamp that carries an explicit timezone; returns null for undefined. */
export function parseTimestamp(name: string, value: unknown): Date | null {
  if (value === undefined) {
    return null;
  }
  const date = typeof value === 'string' && ISO_TIMESTAMP_PATTERN.test(value) ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) {
    throw new BadRequestException(`${name} must be an ISO 8601 timestamp with timezone`);
  }
  return date;
}

export function requiredString(name: string, value: unknown, maxLength: number): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.trim().length > maxLength) {
    throw new BadRequestException(`${name} must be a non-empty string of at most ${maxLength} characters`);
  }
  return value.trim();
}

export function optionalString(name: string, value: unknown, maxLength: number): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== 'string' || value.length > maxLength) {
    throw new BadRequestException(`${name} must be a string of at most ${maxLength} characters`);
  }
  return value;
}

export function optionalUuid(name: string, value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (!isUuid(value)) {
    throw new BadRequestException(`${name} must be a UUID`);
  }
  return value;
}
