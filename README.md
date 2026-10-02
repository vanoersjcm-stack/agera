# Agera Symphony – Backend

Enterprise backend foundation with a 100% European sovereign stack:
PostgreSQL 16 (data) + Keycloak 26 (OAuth2/OIDC), self-hosted via Docker (Hetzner or local Linux).

## Layout

```
docker/
  docker-compose.yml        # PostgreSQL + Keycloak
  postgres/init.sql         # creates Keycloak DB/role + least-privilege app role
  postgres/00_init_roles.sh # runs init.sql with credentials from .env
  postgres/dev_seed.sql     # dev tenant `agera.local` (local only)
  keycloak/realm-agera.json # dev realm, auto-imported on start
migrations/
  V1__initial_schema.sql    # tenants, users, roles_permissions, audit_logs
src/                        # NestJS app (TypeScript, ESM)
  main.ts                   # bootstrap
  app.module.ts
  config/configuration.ts   # typed env config
  modules/core/             # TypeORM connection, entities, AuditService, GET /health
  modules/auth/             # global Keycloak JWT guard, @Public(), @CurrentUser()
  modules/user/             # GET /users/me (auto-provisions user, writes audit log)
.env.example
```

## Run locally

Requirements: Docker with Compose v2.

```bash
cp .env.example .env            # adjust passwords
docker compose --env-file .env -f docker/docker-compose.yml up -d
```

On first start (empty volume) PostgreSQL automatically:
1. creates the `keycloak` database/role and the backend role `DB_USER` (DML only, no DDL)
2. applies `migrations/V1__initial_schema.sql` to the application database
3. seeds the dev tenant `agera.local` (`dev_seed.sql`)

Keycloak then starts against its own database and imports the `agera` realm.

| Service    | URL / port                       | Credentials (from `.env`)                   |
|------------|----------------------------------|---------------------------------------------|
| PostgreSQL | `localhost:5432`                 | `POSTGRES_USER` / `POSTGRES_PASSWORD`       |
| Keycloak   | http://localhost:8080/admin      | `KEYCLOAK_ADMIN` / `KEYCLOAK_ADMIN_PASSWORD`|

Dev realm `agera` (development only – change before any shared deployment):
- client `agera-backend`, secret `dev-backend-secret-change-me`
- user `dev.admin` / `devadmin` (realm roles `admin`, `user`)

Init scripts only run on an empty volume (coming from Phase 1, recreate it once so the
`DB_USER` role and dev tenant exist). To re-run them from scratch:

```bash
docker compose --env-file .env -f docker/docker-compose.yml down -v
```

## Backend API (NestJS)

Requirements: Node.js 22 (`.nvmrc`).

```bash
npm install
npm run build
npm start                           # reads .env, listens on PORT (default 3000)
```

`npm run typecheck` runs the TypeScript compiler without emitting.

The backend connects with `DB_*` and validates tokens against `KEYCLOAK_REALM_URL`
(issuer, signature via the realm JWKS endpoint, audience `KEYCLOAK_CLIENT_ID`).
All routes require a valid Bearer token unless marked `@Public()`.

### Test with a Keycloak token

```bash
curl -i http://localhost:3000/health          # 200 {"status":"ok"} (public)
curl -i http://localhost:3000/users/me        # 401 (no token)

TOKEN=$(curl -s -d grant_type=password -d client_id=agera-backend \
  -d client_secret=dev-backend-secret-change-me \
  -d username=dev.admin -d password=devadmin \
  http://localhost:8080/realms/agera/protocol/openid-connect/token | jq -r .access_token)

curl -s -H "Authorization: Bearer $TOKEN" http://localhost:3000/users/me   # 200, user profile
```

The first `/users/me` call creates the `users` row (`user.provisioned` audit entry); later calls
log `user.profile_fetched`. The user's tenant is resolved from the email domain
(`dev.admin@agera.local` → tenant `agera.local`); an unknown domain returns `403`.

To add another dev user: create it in the Keycloak admin console (realm `agera`, with an email)
and insert a tenant whose `domain` matches the email domain.

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
