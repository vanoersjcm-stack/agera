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

export interface AppConfig {
  port: number;
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

export default (): AppConfig => ({
  port: Number(process.env.PORT ?? 3000),
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
