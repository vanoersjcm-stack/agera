import { applyDecorators } from '@nestjs/common';
import { ApiProperty, ApiQuery, ApiResponse } from '@nestjs/swagger';
import { MAX_PAGE_LIMIT } from './validation.js';

/** Name of the Keycloak bearer security scheme in the OpenAPI document. */
export const BEARER_AUTH = 'keycloak';
export const API_KEY_AUTH = 'apiKey';

export class ErrorResponseDto {
  @ApiProperty()
  statusCode!: number;

  @ApiProperty()
  message!: string;

  @ApiProperty()
  error!: string;
}

export class PageMetaDto {
  @ApiProperty({ minimum: 1, example: 1 })
  page!: number;

  @ApiProperty({ minimum: 1, maximum: MAX_PAGE_LIMIT, example: 20 })
  limit!: number;

  @ApiProperty({ description: 'Total number of matching records', example: 42 })
  total!: number;
}

const ERRORS: Record<number, { description: string; error: string; message: string }> = {
  400: { description: 'Invalid input', error: 'Bad Request', message: 'storeId must be a UUID' },
  503: { description: 'A dependent service (e.g. Keycloak user management) is unavailable or not configured', error: 'Service Unavailable', message: 'User management is not configured' },
  401: {
    description: 'Missing, invalid or expired Keycloak access token',
    error: 'Unauthorized',
    message: 'Invalid token',
  },
  403: {
    description: 'Authenticated, but no tenant could be resolved or a required role is missing',
    error: 'Forbidden',
    message: 'Forbidden resource',
  },
  404: { description: 'Not found in the active tenant', error: 'Not Found', message: 'Work order not found' },
  409: {
    description: 'Conflicts with the current state',
    error: 'Conflict',
    message: 'Cannot reassign a COMPLETED work order',
  },
};

export function ApiErrors(...statuses: number[]): MethodDecorator & ClassDecorator {
  return applyDecorators(
    ...statuses.map((status) => {
      const { description, error, message } = ERRORS[status];
      return ApiResponse({
        status,
        description,
        type: ErrorResponseDto,
        example: { statusCode: status, message, error },
      });
    }),
  );
}

export function ApiPagination(): MethodDecorator {
  return applyDecorators(
    ApiQuery({ name: 'page', required: false, schema: { type: 'integer', minimum: 1, default: 1 } }),
    ApiQuery({
      name: 'limit',
      required: false,
      schema: { type: 'integer', minimum: 1, maximum: MAX_PAGE_LIMIT, default: 20 },
    }),
  );
}

export function ApiUpdatedSince(): MethodDecorator {
  return ApiQuery({
    name: 'updatedSince',
    required: false,
    schema: { type: 'string', format: 'date-time', example: '2026-10-01T12:00:00.000Z' },
    description:
      'Delta sync: only records with updatedAt strictly after this ISO 8601 timestamp (timezone required, ' +
      'URL-encode a +hh:mm offset). Results are then sorted oldest-first; pass the largest updatedAt received next time.',
  });
}
