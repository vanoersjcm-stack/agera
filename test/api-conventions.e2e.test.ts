import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { before, describe, it } from 'node:test';
import { API_URL, api, setupUsers, type TestUser } from './helpers.ts';

const CAMEL_CASE = /^[a-z][a-zA-Z0-9]*$/;

interface OpenApiParameter {
  name: string;
  in: string;
}

interface OpenApiOperation {
  parameters?: OpenApiParameter[];
  requestBody?: { content: Record<string, { schema: { $ref?: string } }> };
  responses?: Record<string, { content?: Record<string, { schema: OpenApiSchema & { type?: string; format?: string } }> }>;
  security?: Record<string, string[]>[];
}

interface OpenApiSchema {
  type?: string;
  format?: string;
  required?: string[];
  properties?: Record<string, OpenApiSchema>;
  items?: OpenApiSchema;
  allOf?: OpenApiSchema[];
}

interface OpenApiDocument {
  openapi: string;
  paths: Record<string, Record<string, OpenApiOperation>>;
  components: {
    schemas: Record<string, OpenApiSchema>;
    securitySchemes: Record<string, { type: string; scheme?: string; bearerFormat?: string; in?: string; name?: string }>;
  };
}

function assertCamelCaseKeys(value: unknown, path = '$'): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertCamelCaseKeys(item, `${path}[${index}]`));
  } else if (value !== null && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) {
      assert.match(key, CAMEL_CASE, `${path}.${key} is not camelCase`);
      assertCamelCaseKeys(nested, `${path}.${key}`);
    }
  }
}

function schemaPropertyNames(schema: OpenApiSchema): string[] {
  return [
    ...Object.entries(schema.properties ?? {}).flatMap(([name, nested]) => [name, ...schemaPropertyNames(nested)]),
    ...(schema.items ? schemaPropertyNames(schema.items) : []),
    ...(schema.allOf ?? []).flatMap(schemaPropertyNames),
  ];
}

const API_KEY_OPERATIONS = new Set([
  'GET /portal/sync/overview',
  'GET /tenants/me',
  'GET /work-orders',
  'GET /work-orders/{id}',
  'GET /work-orders/{id}/logs',
  'GET /stores',
  'GET /visits',
  'GET /visits/{id}/summary',
  'GET /visits/{id}/media/{mediaId}',
]);

let alice: TestUser;
let bob: TestUser;
let document: OpenApiDocument;

before(async () => {
  ({ alice, bob } = await setupUsers());
  const response = await fetch(`${API_URL}/api/docs-json`);
  assert.equal(response.status, 200);
  document = (await response.json()) as OpenApiDocument;
});

describe('Swagger UI', () => {
  it('serves the interactive UI at /api/docs without authentication, using bundled assets only', async () => {
    const response = await fetch(`${API_URL}/api/docs`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /text\/html/);
    const html = await response.text();
    assert.match(html, /swagger-ui/);
    assert.doesNotMatch(html, /(?:src|href)=["']https?:\/\//);

    const init = await fetch(`${API_URL}/api/docs/swagger-ui-init.js`);
    assert.equal(init.status, 200);
  });
});

describe('OpenAPI document', () => {
  it('documents every endpoint', () => {
    const expected: Record<string, string[]> = {
      '/health': ['get'],
      '/users/me': ['get'],
      '/tenants/me': ['get'],
      '/tenants': ['post'],
      '/audit-logs': ['get'],
      '/work-orders': ['get', 'post'],
      '/work-orders/{id}': ['get'],
      '/work-orders/{id}/logs': ['get'],
      '/work-orders/{id}/assign': ['patch'],
      '/work-orders/{id}/status': ['patch'],
      '/stores': ['get', 'post'],
      '/visits': ['get', 'post'],
      '/visits/{id}/status': ['patch'],
      '/visits/{id}/report': ['post'],
      '/visits/{id}/media': ['post'],
      '/visits/{id}/media/{mediaId}': ['delete', 'get'],
      '/api-keys': ['get', 'post'],
      '/api-keys/{id}': ['delete'],
      '/portal/sync/overview': ['get'],
      '/visits/{id}/summary': ['get'],
    };
    assert.match(document.openapi, /^3\./);
    assert.deepEqual(Object.keys(document.paths).sort(), Object.keys(expected).sort());
    for (const [path, methods] of Object.entries(expected)) {
      assert.deepEqual(Object.keys(document.paths[path]).sort(), methods.sort(), path);
    }
  });

  it('requires the Keycloak bearer token everywhere except /health; read endpoints also accept X-API-Key', () => {
    assert.deepEqual(document.components.securitySchemes.keycloak, {
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT',
      description: 'Keycloak access token',
    });
    assert.deepEqual(document.components.securitySchemes.apiKey, {
      type: 'apiKey',
      in: 'header',
      name: 'X-API-Key',
      description: 'Tenant-scoped API key (read-only portal access)',
    });
    for (const [path, operations] of Object.entries(document.paths)) {
      for (const [method, operation] of Object.entries(operations)) {
        const expected =
          path === '/health'
            ? undefined
            : API_KEY_OPERATIONS.has(`${method.toUpperCase()} ${path}`)
              ? [{ keycloak: [] }, { apiKey: [] }]
              : [{ keycloak: [] }];
        assert.deepEqual(operation.security, expected, `${method.toUpperCase()} ${path}`);
      }
    }
  });

  it('documents the multipart photo upload and the binary download', () => {
    const uploadOperation = document.paths['/visits/{id}/media'].post;
    assert.deepEqual(Object.keys(uploadOperation.requestBody?.content ?? {}), ['multipart/form-data']);
    const ref = uploadOperation.requestBody?.content['multipart/form-data'].schema.$ref ?? '';
    const schema = document.components.schemas[ref.replace('#/components/schemas/', '')];
    assert.deepEqual(schema.required, ['file']);
    assert.equal(schema.properties?.file.type, 'string');
    assert.equal(schema.properties?.file.format, 'binary');

    const downloadContent = document.paths['/visits/{id}/media/{mediaId}'].get.responses?.['200'].content ?? {};
    assert.deepEqual(Object.keys(downloadContent).sort(), ['image/jpeg', 'image/png', 'image/webp']);
    assert.equal(downloadContent['image/png'].schema.format, 'binary');
  });

  it('uses camelCase for all parameters and schema properties', () => {
    const parameters = Object.values(document.paths)
      .flatMap((operations) => Object.values(operations))
      .flatMap((operation) => operation.parameters ?? []);
    assert.ok(parameters.some((p) => p.name === 'updatedSince'));
    assert.ok(parameters.some((p) => p.name === 'storeId'));
    for (const parameter of parameters) {
      assert.match(parameter.name, CAMEL_CASE, `${parameter.in} parameter ${parameter.name}`);
    }

    assert.deepEqual(Object.keys(document.components.schemas.AssignWorkOrderDto.properties ?? {}), ['assignedUserId']);
    for (const [name, schema] of Object.entries(document.components.schemas)) {
      for (const property of schemaPropertyNames(schema)) {
        assert.match(property, CAMEL_CASE, `${name}.${property}`);
      }
    }
  });
});

describe('JSON responses', () => {
  it('use camelCase keys on every resource', async () => {
    const run = randomUUID().slice(0, 8);
    const { body: workOrder } = await api<{ id: string }>(alice.token, 'POST', '/work-orders', { title: `conventions ${run}` });
    const assigned = await api(alice.token, 'PATCH', `/work-orders/${workOrder.id}/assign`, { assignedUserId: bob.profile.id });
    assert.equal(assigned.status, 200);
    const { body: store } = await api<{ id: string }>(alice.token, 'POST', '/stores', { storeCode: `C-${run}`, name: 'Conventions' });
    await api(alice.token, 'POST', '/visits', { storeId: store.id, workOrderId: workOrder.id, visitDate: '2026-11-02T09:30:00Z' });

    const responses = [
      assigned,
      await api(null, 'GET', '/health'),
      await api(alice.token, 'GET', '/users/me'),
      await api(alice.token, 'GET', '/tenants/me'),
      await api(alice.token, 'GET', '/audit-logs?limit=100'),
      await api(alice.token, 'GET', '/work-orders?limit=100'),
      await api(alice.token, 'GET', `/work-orders/${workOrder.id}/logs`),
      await api(alice.token, 'GET', '/stores?limit=100'),
      await api(alice.token, 'GET', `/visits?storeId=${store.id}`),
      await api(alice.token, 'GET', '/visits?updatedSince=yesterday'),
    ];
    for (const response of responses) {
      assertCamelCaseKeys(response.body);
    }
    assert.deepEqual(Object.keys(assigned.body as object).sort(), [
      'assignedUserId',
      'completedAt',
      'createdAt',
      'description',
      'id',
      'status',
      'tenantId',
      'title',
      'updatedAt',
    ]);
  });
});
