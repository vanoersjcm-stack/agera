import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { API_KEY_AUTH, BEARER_AUTH } from './modules/core/http/api-docs.js';

export const SWAGGER_PATH = 'api/docs';

export function setupSwagger(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('Agera Symphony API')
    .setDescription(
      'Tenant-scoped backend for Agera Symphony and RetailCare. All endpoints except /health require a ' +
        'Keycloak access token (realm `agera`, audience `agera-backend`); the active tenant is taken from the ' +
        '`tenant_id` claim or, if absent, the email domain. Read endpoints marked with `apiKey` also accept a ' +
        'tenant-scoped `X-API-Key` for portal sync connectors. State is pull-based: there are no webhooks or pushes.',
    )
    .setVersion('0.1.0')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', description: 'Keycloak access token' },
      BEARER_AUTH,
    )
    .addApiKey(
      { type: 'apiKey', in: 'header', name: 'X-API-Key', description: 'Tenant-scoped API key (read-only portal access)' },
      API_KEY_AUTH,
    )
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup(SWAGGER_PATH, app, document, {
    jsonDocumentUrl: `${SWAGGER_PATH}-json`,
    swaggerOptions: { persistAuthorization: true },
  });
}
