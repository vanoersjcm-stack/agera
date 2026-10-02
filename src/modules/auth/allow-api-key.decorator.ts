import { applyDecorators, SetMetadata } from '@nestjs/common';
import { ApiSecurity } from '@nestjs/swagger';
import { API_KEY_AUTH } from '../core/http/api-docs.js';

export const ALLOW_API_KEY = 'allowApiKey';

/** Read-only endpoint that also accepts a tenant-scoped `X-API-Key` instead of a Keycloak token. */
export const AllowApiKey = () => applyDecorators(SetMetadata(ALLOW_API_KEY, true), ApiSecurity(API_KEY_AUTH));
