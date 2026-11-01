export interface DatabaseConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  name: string;
}

export interface KeycloakConfig {
  /** Public realm URL; must equal the `iss` claim of issued tokens. */
  realmUrl: string;
  /** Where signing keys are fetched; may be an internal URL when Keycloak sits behind a proxy. */
  jwksUrl: string;
  clientId: string;
  /** Secret of the agera-backend client; enables in-app user management via its service account. */
  clientSecret: string | null;
}

export type StorageDriver = 'local';

export interface StorageConfig {
  /** Only `local` exists today; an S3-compatible EU provider (MinIO, Hetzner) can be added as another driver. */
  driver: StorageDriver;
  /** Root directory for the local driver (local disk or a mounted Docker volume). */
  localDir: string;
}

export interface AppConfig {
  port: number;
  /** Path prefix for all API routes, e.g. `api` behind the production reverse proxy; empty = none. */
  apiPrefix: string;
  /** Serve OpenAPI docs at /api/docs. Defaults to on unless NODE_ENV=production. */
  swaggerEnabled: boolean;
  storage: StorageConfig;
  db: DatabaseConfig;
  keycloak: KeycloakConfig;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

function storageDriver(value: string): StorageDriver {
  if (value !== 'local') {
    throw new Error(`Unsupported STORAGE_DRIVER "${value}" (supported: local)`);
  }
  return value;
}

function keycloakConfig(): KeycloakConfig {
  const realmUrl = required('KEYCLOAK_REALM_URL').replace(/\/+$/, '');
  return {
    realmUrl,
    jwksUrl: process.env.KEYCLOAK_JWKS_URL || `${realmUrl}/protocol/openid-connect/certs`,
    clientId: required('KEYCLOAK_CLIENT_ID'),
    clientSecret: process.env.KEYCLOAK_CLIENT_SECRET || null,
  };
}

export default (): AppConfig => ({
  port: Number(process.env.PORT ?? 3000),
  apiPrefix: (process.env.API_PREFIX ?? '').replace(/^\/+|\/+$/g, ''),
  swaggerEnabled: process.env.SWAGGER_ENABLED
    ? process.env.SWAGGER_ENABLED === 'true'
    : process.env.NODE_ENV !== 'production',
  storage: {
    driver: storageDriver(process.env.STORAGE_DRIVER ?? 'local'),
    localDir: process.env.UPLOAD_DIR ?? './uploads',
  },
  db: {
    host: required('DB_HOST'),
    port: Number(process.env.DB_PORT ?? 5432),
    user: required('DB_USER'),
    password: required('DB_PASSWORD'),
    name: required('DB_NAME'),
  },
  keycloak: keycloakConfig(),
});
