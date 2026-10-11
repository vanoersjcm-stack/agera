# Agera Symphony – Backend

Enterprise backend foundation with a 100% European sovereign stack:
PostgreSQL 16 (data) + Keycloak 26 (OAuth2/OIDC), self-hosted via Docker (Hetzner or local Linux).

Production on a local Ubuntu server: see [DEPLOYMENT.md](DEPLOYMENT.md) (`./deploy.sh`).

## Layout

```
docker-compose.prod.yml     # production stack: postgres, migrate, keycloak, backend, nginx proxy
deploy.sh                   # production checks, .env.production, deploy, first platform admin
Dockerfile                  # production backend image
.env.production.example     # production settings template
DEPLOYMENT.md               # Ubuntu Server installation guide
docker/
  docker-compose.yml        # development: PostgreSQL + Keycloak
  postgres/init.sql         # creates Keycloak DB/role + least-privilege app role
  postgres/00_init_roles.sh # runs init.sql with credentials from .env
  postgres/dev_seed.sql     # dev tenants `agera.local`, `acme.test` (local only)
  keycloak/realm-agera.json # dev realm, auto-imported on start
  keycloak/prod/realm-agera.json # production realm (no demo users, client secret from env)
  postgres/migrate.sh       # production migration runner (schema_migrations, checksums)
  nginx/default.conf.template # production reverse proxy: /api -> backend, /auth -> Keycloak
migrations/
  V1__initial_schema.sql    # tenants, users, roles_permissions, audit_logs
  V2__work_orders_schema.sql # work_orders, work_order_logs
  V3__retailcare_initial_schema.sql # stores, merchandising_visits
  V4__retailcare_reports_and_media.sql # visit_reports, visit_media
  V5__api_keys_and_portal_sync.sql # api_keys
src/                        # NestJS app (TypeScript, ESM)
  main.ts                   # bootstrap
  swagger.ts                # OpenAPI document + Swagger UI at /api/docs
  app.module.ts
  config/configuration.ts   # typed env config
  modules/core/             # TypeORM connection, entities, GET /health
  modules/core/tenancy/     # TenantContext (AsyncLocalStorage), resolver, interceptor, TenantRepository
  modules/core/audit/       # async AuditService (event emitter + listener), GET /audit-logs
  modules/core/tenants/     # GET /tenants/me, POST /tenants (platform-admin)
  modules/core/storage/     # StorageService abstraction + LocalStorageProvider (disk / Docker volume)
  modules/api-keys/         # tenant-scoped API keys for portal connectors (platform-admin)
  modules/portal/           # GET /portal/sync/overview (pull-based delta feed)
  modules/auth/             # global Keycloak JWT guard, X-API-Key guard, roles guard, @Public(), @Roles(), @AllowApiKey(), @CurrentUser()
  modules/user/             # GET /users/me (auto-provisions user, writes audit log)
  modules/work-orders/      # work orders, status history, assignment (Phase 4/5)
  modules/retailcare/       # stores + merchandising visits (Phase 5)
  modules/core/http/        # shared request validation + OpenAPI helpers
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
2. applies `migrations/V1__initial_schema.sql`, `V2__work_orders_schema.sql`,
   `V3__retailcare_initial_schema.sql`, `V4__retailcare_reports_and_media.sql` and
   `V5__api_keys_and_portal_sync.sql` to the application database
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

### API conventions and Swagger (Phase 6)

All request bodies, query parameters and JSON responses use camelCase (`assignedUserId`,
`storeId`, `updatedSince`); PostgreSQL columns stay snake_case and are mapped in the TypeORM
entities. Unknown fields and query parameters are ignored, so old snake_case names
(`assigned_user_id`, `updated_since`, `store_id`) no longer have any effect.

Interactive OpenAPI docs are served at <http://localhost:3000/api/docs> (raw document:
`/api/docs-json`). Click **Authorize** and paste a Keycloak access token (see below) to try the
protected endpoints. The UI assets are bundled (`swagger-ui-dist`), no CDN. Docs are on by default
and off when `NODE_ENV=production`; override with `SWAGGER_ENABLED=true|false`.

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
| GET    | `/work-orders` | token                 | `?page&limit&updatedSince=<ISO 8601 with timezone>` |
| GET    | `/work-orders/:id` | token             | single work order (`404` for other tenants) |
| GET    | `/work-orders/:id/logs` | token        | status history from `work_order_logs` |
| PATCH  | `/work-orders/:id/status` | token      | body `{"status": "IN_PROGRESS"}` |
| PATCH  | `/work-orders/:id/assign` | token      | body `{"assignedUserId": "<uuid>"}` (or `null` to unassign) |
| POST   | `/stores`     | token                  | body `{"storeCode", "name", "address"?, "city"?, "postalCode"?, "country"? (default `ES`)}` |
| GET    | `/stores`     | token                  | `?page&limit`, sorted by `storeCode` |
| POST   | `/visits`     | token                  | body `{"storeId", "visitDate", "fieldRepId"? (default: caller), "workOrderId"?, "notes"?}` |
| GET    | `/visits`     | token                  | `?page&limit&storeId&updatedSince` |
| PATCH  | `/visits/:id/status` | token           | body `{"status": "IN_PROGRESS"}` |
| POST   | `/visits/:id/report` | token           | body `{"summary"?, "auditData"? (JSON object)}`; creates (`201`) or replaces (`200`) the visit's report |
| POST   | `/visits/:id/media`  | token           | multipart `file` (JPEG/PNG/WebP, max 10 MB) |
| GET    | `/visits/:id/media/:mediaId` | token   | the image itself |
| GET    | `/visits/:id/summary` | token          | `{visit, report, media[]}` in one payload |
| DELETE | `/visits/:id/media/:mediaId` | token   | deletes the record and the file; `204` |
| POST   | `/api-keys`   | token + `platform-admin` | body `{"name", "tenantId"? (default: own), "expiresAt"?}`; returns the secret once |
| GET    | `/api-keys`   | token + `platform-admin` | `?page&limit&tenantId`, newest first, never returns secrets |
| DELETE | `/api-keys/:id` | token + `platform-admin` | revokes a key immediately; `204` |
| GET    | `/portal/sync/overview` | token or `X-API-Key` | `?updatedSince&limit` (max 500); `{workOrders, visits, reports, hasMore, nextUpdatedSince}` |

Endpoints marked "token or `X-API-Key`" in Swagger (`/portal/sync/overview`, `/tenants/me` and the
`GET` endpoints of work orders, stores, visits, summaries and photos) also accept an API key.

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
largest `updatedAt` it has seen back as `updatedSince`; results are then sorted oldest-first.
Without `updatedSince` the list is newest-first.

Tenant isolation is enforced twice: `TenantRepository` filters every query, and composite foreign
keys `(tenant_id, …)` stop a work order, log row or assignee from referencing another tenant.

```bash
WO=$(curl -s -H "Authorization: Bearer $ALICE" -H 'Content-Type: application/json' \
  -d '{"title":"Replace filter","description":"Unit 3"}' http://localhost:3000/work-orders)
ID=$(echo $WO | jq -r .id); SINCE=$(echo $WO | jq -r .updatedAt)

curl -s -X PATCH -H "Authorization: Bearer $BOB" -H 'Content-Type: application/json' \
  -d '{"status":"COMPLETED"}' http://localhost:3000/work-orders/$ID/status | jq '{status, completedAt}'
curl -s -H "Authorization: Bearer $ALICE" "http://localhost:3000/work-orders?updatedSince=$(jq -rn --arg s $SINCE '$s|@uri')" | jq
curl -s -H "Authorization: Bearer $ALICE" http://localhost:3000/work-orders/$ID/logs | jq
curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $ADMIN" http://localhost:3000/work-orders/$ID   # 404
```

URL-encode `updatedSince` (a `+hh:mm` offset otherwise turns into a space).

### Assignment and RetailCare (Phase 5)

`PATCH /work-orders/:id/assign` only accepts an active user of the work order's tenant: an
assignee from another tenant (or an unknown ID) returns `400`, another tenant's work order `404`,
and a `COMPLETED`/`CANCELLED` work order `409`. The change bumps `updated_at` (so it shows up in
`updatedSince`) and writes `work_order.assigned` to `audit_logs` asynchronously.

`stores.store_code` is unique per tenant (`409` on duplicates). A visit must reference a store,
field rep and (optional) work order of the caller's tenant (`400` otherwise; composite foreign
keys enforce the same in the database). Visit statuses: `PLANNED` → `IN_PROGRESS` / `COMPLETED` /
`CANCELLED`, `IN_PROGRESS` → `PLANNED` / `COMPLETED` / `CANCELLED`; `COMPLETED` and `CANCELLED`
are final. Audit actions: `store.created`, `visit.planned`, `visit.status_changed`.

```bash
STORE=$(curl -s -H "Authorization: Bearer $ALICE" -H 'Content-Type: application/json' \
  -d '{"storeCode":"MAD-001","name":"Madrid Centro","city":"Madrid","postalCode":"28013"}' \
  http://localhost:3000/stores | jq -r .id)
BOB_ID=$(curl -s -H "Authorization: Bearer $BOB" http://localhost:3000/users/me | jq -r .id)

curl -s -X PATCH -H "Authorization: Bearer $ALICE" -H 'Content-Type: application/json' \
  -d "{\"assignedUserId\":\"$BOB_ID\"}" http://localhost:3000/work-orders/$ID/assign | jq
curl -s -H "Authorization: Bearer $ALICE" -H 'Content-Type: application/json' \
  -d "{\"storeId\":\"$STORE\",\"fieldRepId\":\"$BOB_ID\",\"workOrderId\":\"$ID\",\"visitDate\":\"2026-11-02T09:30:00Z\"}" \
  http://localhost:3000/visits | jq
curl -s -H "Authorization: Bearer $BOB" "http://localhost:3000/visits?storeId=$STORE" | jq
curl -s -H "Authorization: Bearer $ADMIN" "http://localhost:3000/visits?storeId=$STORE" | jq .total   # 0
```

### Visit reports and photos (Phase 7)


Each visit has at most one report; `POST /visits/:id/report` replaces it as a whole
(`summary` defaults to `null`, `auditData` to `{}`). `auditData` is a free-form JSON object for
questionnaires and shelf audits and is stored as-is.

Photos are uploaded as multipart field `file`. The type is checked from the file content (a
text file renamed to `.png` is rejected) and must be JPEG, PNG or WebP, at most 10 MB; anything
else returns `400`. Files are written to `UPLOAD_DIR/<tenantId>/<visitId>/<mediaId>.<ext>` on
local disk; only the metadata goes to `visit_media`. `GET /visits/:id/media/:mediaId` streams the
file back after checking the tenant. Media of another tenant (or under another visit) returns `404`.

Saving a report or uploading a photo bumps the visit's `updatedAt`, so portals polling
`GET /visits?updatedSince=` notice the change and can fetch `GET /visits/:id/summary`.
`CANCELLED` visits accept no new reports or photos (`409`). Audit actions:
`visit.report_saved`, `visit.media_uploaded`.

To keep uploads in a Docker volume, mount it at `/uploads` and set `UPLOAD_DIR=/uploads`
(the directory must be writable by the app user). For example, with the backend in a container:

```bash
docker volume create agera_uploads
docker run --rm -v agera_uploads:/uploads node:22-alpine chown "$(id -u):$(id -g)" /uploads
docker run -d --name agera-api --user "$(id -u):$(id -g)" --network host \
  -e UPLOAD_DIR=/uploads -v agera_uploads:/uploads -v "$PWD:/app" -w /app node:22-alpine npm start
```

```bash
curl -s -H "Authorization: Bearer $ALICE" -H 'Content-Type: application/json' \
  -d '{"summary":"Shelf restocked","auditData":{"facings":12,"priceTagsOk":true}}' \
  http://localhost:3000/visits/$VISIT/report | jq
curl -s -H "Authorization: Bearer $ALICE" -F "file=@shelf.jpg;type=image/jpeg" \
  http://localhost:3000/visits/$VISIT/media | jq
curl -s -H "Authorization: Bearer $BOB" http://localhost:3000/visits/$VISIT/summary | jq
```

### Portal sync and API keys (Phase 8)

Portal connectors authenticate with `X-API-Key` instead of a Keycloak token. A key belongs to
exactly one tenant, and every response is scoped to it. Keys are read-only: writes, `/users/me`,
`/audit-logs` and the `/api-keys` endpoints themselves return `403`. Only a SHA-256 hash is stored,
so the secret (`agk_…`) is shown once, at creation; revoking a key (`DELETE /api-keys/:id`) or
reaching its `expiresAt` makes it return `401` immediately.

`GET /portal/sync/overview` is the single delta feed for dashboards: work orders, visits and
reports changed after `updatedSince`, oldest change first, at most `limit` rows per collection
(default 100, max 500). Poll with `updatedSince` set to the previous `nextUpdatedSince`, and poll
again straight away while `hasMore` is `true`. Rows that share the cut-off millisecond are never
split across pages, so no change can be skipped; a row may be delivered twice. Saving a report or
uploading/deleting a photo also updates the visit, so a changed visit signals changed media.

```bash
KEY=$(curl -s -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' \
  -d '{"name":"Portal Production Key","tenantId":"a9e1a000-0000-4000-8000-000000000002"}' \
  http://localhost:3000/api-keys | jq -r .key)
curl -s -H "X-API-Key: $KEY" http://localhost:3000/tenants/me | jq          # resolvedBy=apiKey
curl -s -H "X-API-Key: $KEY" 'http://localhost:3000/portal/sync/overview?limit=50' | jq
curl -i -H "X-API-Key: $KEY" -X POST http://localhost:3000/work-orders      # 403 (read-only)
```

### Media storage drivers

All file access goes through `StorageService` (`put` / `get` / `delete` on keys like
`<tenantId>/<visitId>/<mediaId>.<ext>`); controllers never touch paths. `STORAGE_DRIVER=local`
(the only driver today) writes below `UPLOAD_DIR`. An S3-compatible European provider (MinIO,
Hetzner Object Storage) can be added as a second driver without touching the endpoints.

### Integration tests

With the stack and the backend running (`npm start`):

```bash
npm run test:e2e
```

Set `TEST_UPLOAD_DIR` to the backend's `UPLOAD_DIR` (readable from the test process) to also
assert that uploaded files appear on and disappear from disk.

The tests use the dev realm users and cover authentication, tenant-isolated create/read/update,
status transitions with `work_order_logs` and async audit entries, concurrent updates,
`updatedSince`, assignment (including cross-tenant rejection), store/visit isolation, and the
API conventions (camelCase in every response and in the OpenAPI document, Swagger UI reachable),
visit reports, photo uploads (type and size limits), photo deletion with file cleanup, tenant
isolation of reports and files, API key creation/revocation/expiry, read-only API key access and
the paged portal sync feed.
They create records with unique names and can be re-run.

### Upgrading an existing local database

Apply the migrations your database doesn't have yet, in order, without losing data
(coming from Phase 7: only V5; from Phase 5/6: V4 then V5; from Phase 4: V3, V4, V5):

```bash
docker compose --env-file .env -f docker/docker-compose.yml exec -T postgres \
  psql -v ON_ERROR_STOP=1 -U agera -d agera_symphony < migrations/V5__api_keys_and_portal_sync.sql
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
