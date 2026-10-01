# Agera Symphony – Backend

Enterprise backend foundation with a 100% European sovereign stack:
PostgreSQL 16 (data) + Keycloak 26 (OAuth2/OIDC), self-hosted via Docker (Hetzner or local Linux).

## Layout

```
docker/
  docker-compose.yml        # PostgreSQL + Keycloak
  postgres/init.sql         # creates separate Keycloak DB + role
  postgres/00_keycloak_db.sh# runs init.sql with credentials from .env
  keycloak/realm-agera.json # dev realm, auto-imported on start
migrations/
  V1__initial_schema.sql    # tenants, users, roles_permissions, audit_logs
src/                        # NestJS app (TypeScript, ESM)
  main.ts                   # bootstrap
  app.module.ts
  config/configuration.ts   # typed env config
  modules/core|auth|user/   # feature modules (core exposes GET /health)
.env.example
```

## Run locally

Requirements: Docker with Compose v2.

```bash
cp .env.example .env            # adjust passwords
docker compose --env-file .env -f docker/docker-compose.yml up -d
```

On first start (empty volume) PostgreSQL automatically:
1. creates the `keycloak` database/role (`00_keycloak_db.sh` → `init.sql`)
2. applies `migrations/V1__initial_schema.sql` to the application database

Keycloak then starts against its own database and imports the `agera` realm.

| Service    | URL / port                       | Credentials (from `.env`)                   |
|------------|----------------------------------|---------------------------------------------|
| PostgreSQL | `localhost:5432`                 | `POSTGRES_USER` / `POSTGRES_PASSWORD`       |
| Keycloak   | http://localhost:8080/admin      | `KEYCLOAK_ADMIN` / `KEYCLOAK_ADMIN_PASSWORD`|

Dev realm `agera` (development only – change before any shared deployment):
- client `agera-backend`, secret `dev-backend-secret-change-me`
- user `dev.admin` / `devadmin` (realm roles `admin`, `user`)

Init scripts only run on an empty volume. To re-run them from scratch:

```bash
docker compose --env-file .env -f docker/docker-compose.yml down -v
```

## Backend API (NestJS)

Requirements: Node.js 22 (`.nvmrc`).

```bash
npm install
npm run build
npm start                           # reads .env, listens on APP_PORT (default 3000)
curl http://localhost:3000/health   # {"status":"ok"}
```

`npm run typecheck` runs the TypeScript compiler without emitting.

## Verify

```bash
C="docker compose --env-file .env -f docker/docker-compose.yml"

# Tables, constraints, indexes
$C exec postgres psql -U agera -d agera_symphony -c '\dt' -c '\d+ users' -c '\di'

# Keycloak realm is up
curl -s http://localhost:8080/realms/agera/.well-known/openid-configuration

# Obtain a token for the dev user
curl -s -d grant_type=password -d client_id=agera-backend \
  -d client_secret=dev-backend-secret-change-me \
  -d username=dev.admin -d password=devadmin \
  http://localhost:8080/realms/agera/protocol/openid-connect/token
```

Note: on Keycloak's first start PostgreSQL logs a few `relation "databasechangelog" does not exist`
errors. These are Keycloak's own migration probes and are expected.

## Schema (V1)

| Table               | Notes |
|---------------------|-------|
| `tenants`           | `domain` unique; `updated_at` maintained by trigger |
| `users`             | FK `tenant_id` → tenants (RESTRICT); `keycloak_id`, `email` unique |
| `roles_permissions` | FK `tenant_id` → tenants (CASCADE); unique `(tenant_id, role_name, permission)` |
| `audit_logs`        | FK `tenant_id` → tenants (RESTRICT), `user_id` → users (SET NULL); `details` JSONB |

All primary keys are `UUID DEFAULT gen_random_uuid()`, all timestamps `TIMESTAMPTZ`.
`tenant_id` is `NOT NULL` on every tenant-scoped table to enforce tenant isolation.
