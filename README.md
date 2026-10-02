# Agera Symphony – Backend

Enterprise backend foundation with a 100% European sovereign stack:
PostgreSQL 16 (data) + Keycloak 26 (OAuth2/OIDC), self-hosted via Docker (Hetzner or local Linux).

## Layout

```
docker/
  docker-compose.yml        # PostgreSQL + Keycloak
  postgres/init.sql         # creates Keycloak DB/role + least-privilege app role
  postgres/00_init_roles.sh # runs init.sql with credentials from .env
  postgres/dev_seed.sql     # dev tenants `agera.local`, `acme.test` (local only)
  keycloak/realm-agera.json # dev realm, auto-imported on start
migrations/
  V1__initial_schema.sql    # tenants, users, roles_permissions, audit_logs
  V2__work_orders_schema.sql # work_orders, work_order_logs
src/                        # NestJS app (TypeScript, ESM)
  main.ts                   # bootstrap
  app.module.ts
  config/configuration.ts   # typed env config
  modules/core/             # TypeORM connection, entities, GET /health
  modules/core/tenancy/     # TenantContext (AsyncLocalStorage), resolver, interceptor, TenantRepository
  modules/core/audit/       # async AuditService (event emitter + listener), GET /audit-logs
  modules/core/tenants/     # GET /tenants/me, POST /tenants (platform-admin)
  modules/auth/             # global Keycloak JWT guard + roles guard, @Public(), @Roles(), @CurrentUser()
  modules/user/             # GET /users/me (auto-provisions user, writes audit log)
  modules/work-orders/      # work orders + status history (Phase 4)
test/                       # integration tests against the running stack (node:test)
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
2. applies `migrations/V1__initial_schema.sql` and `V2__work_orders_schema.sql` to the application database
3. seeds the dev tenants `agera.local` and `acme.test` (`dev_seed.sql`)

Keycloak then starts against its own database and imports the `agera` realm.

| Service    | URL / port                       | Credentials (from `.env`)                   |
|------------|----------------------------------|---------------------------------------------|
| PostgreSQL | `localhost:5432`                 | `POSTGRES_USER` / `POSTGRES_PASSWORD`       |
| Keycloak   | http://localhost:8080/admin      | `KEYCLOAK_ADMIN` / `KEYCLOAK_ADMIN_PASSWORD`|

Dev realm `agera` (development only – change before any shared deployment):
- client `agera-backend`, secret `dev-backend-secret-change-me`
- realm role `platform-admin` (may create tenants); user attribute `tenant_id` is mapped
  into the access token as the `tenant_id` claim

| User (password)         | Email                   | `tenant_id` claim         | Resolves to                     |
|-------------------------|-------------------------|---------------------------|---------------------------------|
| `dev.admin` (`devadmin`) | `dev.admin@agera.local` | –                         | Agera Dev (domain), platform-admin |
| `alice` (`alice`)       | `alice@freelance.eu`    | `a9e1a000-…-000000000002` | Acme Test (claim)               |
| `bob` (`bob`)           | `bob@acme.test`         | –                         | Acme Test (domain)              |

Dev tenant IDs: Agera Dev `a9e1a000-0000-4000-8000-000000000001`,
Acme Test `a9e1a000-0000-4000-8000-000000000002`.

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

`npm run typecheck` type-checks `src/` and `test/` without emitting.

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
log `user.profile_fetched`.

### Multi-tenancy

For every authenticated request the active tenant is resolved once and held in `TenantContext`
for the rest of the request:

1. **`tenant_id` claim** in the access token (Keycloak user attribute `tenant_id`). Must be the
   UUID of an existing tenant, otherwise `403`.
2. **Email domain** fallback when the claim is absent: `tenants.domain` = domain of the token's
   `email`. No match → `403`.

Tenant-owned tables (`users`, `audit_logs`) are accessed through `TenantRepository`, which adds
`tenant_id = <active tenant>` to every query and stamps it on every insert; saving a row of
another tenant throws.

Audit entries are written **asynchronously**: `AuditService.logAction()` emits an `audit.log`
event and returns immediately; a listener inserts the row into `audit_logs`. A failed write is
logged and never fails the HTTP request. There are no webhooks or push notifications – portals
read `GET /audit-logs`.

### Endpoints

| Method | Path          | Auth                   | Description |
|--------|---------------|------------------------|-------------|
| GET    | `/health`     | public                 | liveness |
| GET    | `/users/me`   | token                  | profile, auto-provisions into the active tenant |
| GET    | `/tenants/me` | token                  | active tenant + `resolvedBy` (`claim` / `domain`) |
| GET    | `/audit-logs` | token                  | `?page=1&limit=20` (max 100), active tenant only, newest first |
| POST   | `/tenants`    | token + `platform-admin` | body `{"name": "...", "domain": "example.eu"}`; `409` if domain exists |
| POST   | `/work-orders` | token                 | body `{"title", "description"?, "assignedUserId"?}`; created as `PENDING` |
| GET    | `/work-orders` | token                 | `?page&limit&updated_since=<ISO 8601 with timezone>` |
| GET    | `/work-orders/:id` | token             | single work order (`404` for other tenants) |
| GET    | `/work-orders/:id/logs` | token        | status history from `work_order_logs` |
| PATCH  | `/work-orders/:id/status` | token      | body `{"status": "IN_PROGRESS"}` |

### Simulating multi-tenant JWT payloads

```bash
token() {
  curl -s -d grant_type=password -d client_id=agera-backend \
    -d client_secret=dev-backend-secret-change-me -d username=$1 -d password=$2 \
    http://localhost:8080/realms/agera/protocol/openid-connect/token | jq -r .access_token
}
ADMIN=$(token dev.admin devadmin); ALICE=$(token alice alice); BOB=$(token bob bob)

# Inspect the claim (alice has tenant_id, bob/dev.admin don't)
echo $ALICE | cut -d. -f2 | base64 -d 2>/dev/null | jq '{email, tenant_id}'

curl -i http://localhost:3000/tenants/me                                      # 401
curl -i http://localhost:3000/audit-logs                                      # 401
curl -s -H "Authorization: Bearer $ALICE" http://localhost:3000/tenants/me    # Acme Test, resolvedBy=claim
curl -s -H "Authorization: Bearer $BOB"   http://localhost:3000/tenants/me    # Acme Test, resolvedBy=domain
curl -s -H "Authorization: Bearer $ADMIN" http://localhost:3000/tenants/me    # Agera Dev, resolvedBy=domain

# Generate audit entries, then read them per tenant
for T in $ADMIN $ALICE $BOB; do curl -s -o /dev/null -H "Authorization: Bearer $T" http://localhost:3000/users/me; done
curl -s -H "Authorization: Bearer $ALICE" 'http://localhost:3000/audit-logs?page=1&limit=10' | jq   # only Acme Test rows
curl -s -H "Authorization: Bearer $ADMIN" http://localhost:3000/audit-logs | jq                     # only Agera Dev rows

# Tenant creation
curl -s -H "Authorization: Bearer $ALICE" -H 'Content-Type: application/json' \
  -d '{"name":"Nordic BV","domain":"nordic.eu"}' http://localhost:3000/tenants   # 403
curl -s -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' \
  -d '{"name":"Nordic BV","domain":"nordic.eu"}' http://localhost:3000/tenants   # 201
```

To simulate another claim, set the `tenant_id` attribute on a user in the Keycloak admin console
(realm `agera` → Users → Attributes; admin-only) and request a new token. A claim pointing at a
non-existent tenant returns `403`. To add a domain-based user, create a tenant for the domain
(`POST /tenants`) and a Keycloak user with a matching email.

### Work orders and delta sync (Phase 4)

Statuses: `PENDING` → `IN_PROGRESS` / `COMPLETED` / `CANCELLED`, `IN_PROGRESS` → `PENDING` /
`COMPLETED` / `CANCELLED`. `COMPLETED` and `CANCELLED` are final (`409` on further changes).
Every change, including creation, is written to `work_order_logs` in the same transaction (row
locked, so concurrent updates can't both win) and an `audit_logs` entry follows asynchronously
(`work_order.created`, `work_order.status_changed`). Nothing is pushed to clients.

`updated_at` and `completed_at` are maintained by a database trigger (`completed_at` is set when
the status becomes `COMPLETED`). Timestamps have millisecond precision, so a portal can pass the
largest `updatedAt` it has seen back as `updated_since`; results are then sorted oldest-first.
Without `updated_since` the list is newest-first.

Tenant isolation is enforced twice: `TenantRepository` filters every query, and composite foreign
keys `(tenant_id, …)` stop a work order, log row or assignee from referencing another tenant.

```bash
WO=$(curl -s -H "Authorization: Bearer $ALICE" -H 'Content-Type: application/json' \
  -d '{"title":"Replace filter","description":"Unit 3"}' http://localhost:3000/work-orders)
ID=$(echo $WO | jq -r .id); SINCE=$(echo $WO | jq -r .updatedAt)

curl -s -X PATCH -H "Authorization: Bearer $BOB" -H 'Content-Type: application/json' \
  -d '{"status":"COMPLETED"}' http://localhost:3000/work-orders/$ID/status | jq '{status, completedAt}'
curl -s -H "Authorization: Bearer $ALICE" "http://localhost:3000/work-orders?updated_since=$(jq -rn --arg s $SINCE '$s|@uri')" | jq
curl -s -H "Authorization: Bearer $ALICE" http://localhost:3000/work-orders/$ID/logs | jq
curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $ADMIN" http://localhost:3000/work-orders/$ID   # 404
```

URL-encode `updated_since` (a `+hh:mm` offset otherwise turns into a space).

### Integration tests

With the stack and the backend running (`npm start`):

```bash
npm run test:e2e
```

The tests use the dev realm users and cover authentication, tenant-isolated create/read/update,
status transitions with `work_order_logs` and async audit entries, concurrent updates, and
`updated_since`. They create work orders with unique titles and can be re-run.

### Upgrading an existing local database

Coming from Phase 3, apply V2 without losing data:

```bash
docker compose --env-file .env -f docker/docker-compose.yml exec -T postgres \
  psql -v ON_ERROR_STOP=1 -U agera -d agera_symphony < migrations/V2__work_orders_schema.sql
```

Coming from Phase 2, recreate the volumes once (`down -v`) so the new seed and realm users are
imported.

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
