import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { BEARER_AUTH } from './modules/core/http/api-docs.js';

export const SWAGGER_PATH = 'api/docs';

export function setupSwagger(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('Agera Symphony API')
    .setDescription(
      'Tenant-scoped backend for Agera Symphony and RetailCare. All endpoints except /health require a ' +
        'Keycloak access token (realm `agera`, audience `agera-backend`); the active tenant is taken from the ' +
        '`tenant_id` claim or, if absent, the email domain. State is pull-based: there are no webhooks or pushes.',
    )
    .setVersion('0.1.0')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', description: 'Keycloak access token' },
      BEARER_AUTH,
    )
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup(SWAGGER_PATH, app, document, {
    jsonDocumentUrl: `${SWAGGER_PATH}-json`,
    swaggerOptions: { persistAuthorization: true },
  });
}
