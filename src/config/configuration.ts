export interface DatabaseConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  name: string;
}

export interface KeycloakConfig {
  realmUrl: string;
  clientId: string;
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

export default (): AppConfig => ({
  port: Number(process.env.PORT ?? 3000),
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
  keycloak: {
    realmUrl: required('KEYCLOAK_REALM_URL').replace(/\/+$/, ''),
    clientId: required('KEYCLOAK_CLIENT_ID'),
  },
});
