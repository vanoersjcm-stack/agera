# Agera Symphony – Deployment on a local Ubuntu Server

This guide installs Agera Symphony and RetailCare on one on-premise Ubuntu Server with Docker.
Everything runs on that server: PostgreSQL, Keycloak, the NestJS backend and an Nginx reverse
proxy. Photos are stored in a local Docker volume. No cloud services are used, and the server
never sends data out on its own: portals pull data with API keys.

```
 LAN clients ──HTTPS──▶ Nginx (ports 80/443)
                          ├── /api/   ─▶ backend (NestJS)  ─▶ PostgreSQL (data)
                          │   /api/docs  Swagger UI          └▶ volume "uploads" (photos)
                          └── /auth/  ─▶ Keycloak (logins)   ─▶ PostgreSQL (keycloak DB)
```

Only Nginx is reachable from the network. PostgreSQL, Keycloak and the backend listen on an
internal Docker network only.

| Path | What |
|---|---|
| `docker-compose.prod.yml` | production stack (postgres, migrate, keycloak, backend, proxy) |
| `deploy.sh` | checks, configuration, deployment and first-admin helper |
| `.env.production.example` | template for `.env.production` (all settings live there) |
| `docker/nginx/default.conf.template` | reverse proxy routes |
| `docker/nginx/certs/` | TLS certificate and key (not in git) |
| `docker/keycloak/prod/realm-agera.json` | production realm: roles, `agera-backend` client, no demo users |
| `docker/postgres/migrate.sh` | applies `migrations/V*.sql` on every deploy |
| `Dockerfile` | backend image |

---

## 1. Prepare the server

Tested on **Ubuntu Server 24.04 LTS**; 22.04 LTS works the same way.

Minimum: 2 CPU cores, 4 GB RAM (Keycloak uses about 1 GB), 20 GB free disk plus room for photos.
Give the server a fixed IP address on your network.

Install Docker, Compose v2 and the tools `deploy.sh` uses, all from the Ubuntu archive:

```bash
sudo apt update
sudo apt install -y docker.io docker-compose-v2 git openssl curl
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"     # run docker without sudo
```

Log out and back in (so the group change applies), then check:

```bash
docker --version
docker compose version              # must print "Docker Compose version v2..."
docker run --rm hello-world
```

Firewall: allow SSH and the web ports only.

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

The containers pull their images from Docker Hub (`postgres`, `nginx`, `node`) and Quay
(`keycloak`) on the first deploy and on updates. After that the server needs no internet access.

## 2. Choose the server address

Clients (browsers, portal connectors) reach the system at one address, the **public URL**, for
example `https://symphony.example.lan`. Pick one of:

- a host name in your local DNS (router or internal DNS server) pointing to the server's IP;
- the server's IP address, e.g. `https://192.168.1.50`;
- for a quick test, a line in each client's hosts file (`/etc/hosts` or
  `C:\Windows\System32\drivers\etc\hosts`): `192.168.1.50  symphony.example.lan`.

The public URL is written into every login token, so choose it before the first deploy. If you
change it later, the server keeps working, but users must log in again.

## 3. Get the code

```bash
sudo mkdir -p /opt/agera-symphony && sudo chown "$USER": /opt/agera-symphony
git clone <repository-url> /opt/agera-symphony
#   or unpack a release tarball:  tar -xzf agera-symphony-*.tar.gz -C /opt/agera-symphony
cd /opt/agera-symphony
```

## 4. Configure `.env.production`

All production settings are in one file, `.env.production`, next to `deploy.sh`. Create it
with random secrets:

```bash
./deploy.sh init-env https://symphony.example.lan
```

This copies `.env.production.example`, sets `PUBLIC_URL`, fills every secret with a random
32-character value and makes the file readable by your user only. Open it to review:

```bash
nano .env.production
```

| Setting | Meaning |
|---|---|
| `PUBLIC_URL` | address from step 2, `https://` and no trailing slash; add `:port` only if `HTTPS_PORT` is not 443 |
| `HTTP_PORT`, `HTTPS_PORT` | ports Nginx listens on (default 80 and 443; port 80 only redirects to HTTPS) |
| `SWAGGER_ENABLED` | `true` serves the interactive API docs at `/api/docs`; `false` hides them |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | database owner; used only for migrations and backups |
| `DB_USER`, `DB_PASSWORD` | account the backend uses: may read and write data, cannot change tables |
| `KEYCLOAK_DB_NAME`, `KEYCLOAK_DB_USER`, `KEYCLOAK_DB_PASSWORD` | Keycloak's own database |
| `KEYCLOAK_ADMIN`, `KEYCLOAK_ADMIN_PASSWORD` | temporary Keycloak administrator (see step 7) |
| `KEYCLOAK_CLIENT_SECRET` | secret of the `agera-backend` client, needed to request login tokens |

Rules checked by `deploy.sh`: secrets at least 16 characters from `A-Z a-z 0-9 . _ ~ -`, no
placeholders left, the app password different from the owner password.

**Keep a copy of `.env.production` in your password manager.** The database passwords are set
when the database is created on the first deploy; changing them in the file afterwards does not
change them in the database (see Operations → Changing passwords).

## 5. TLS certificate

Nginx serves HTTPS with `docker/nginx/certs/fullchain.pem` and `docker/nginx/certs/privkey.pem`.

- **Default:** if the files are missing, `deploy.sh` creates a self-signed certificate for the
  host in `PUBLIC_URL`. Browsers show a warning until the certificate is trusted. To trust it,
  copy `docker/nginx/certs/fullchain.pem` to the clients and import it (Windows: "Trusted Root
  Certification Authorities"; Ubuntu: copy to `/usr/local/share/ca-certificates/agera.crt` and
  run `sudo update-ca-certificates`). Portal connectors can use it with `curl --cacert fullchain.pem`.
- **Your own certificate** (company CA, or any CA your clients already trust): put the
  certificate chain in `fullchain.pem` and the private key in `privkey.pem` before running
  `deploy.sh`, or replace them later and run `./deploy.sh compose restart proxy`.

`deploy.sh` refuses to start with an expired certificate and warns 30 days before expiry.

## 6. Deploy

```bash
./deploy.sh
```

On a fresh server this:

1. checks that `docker`, `docker compose` (v2), `openssl` and `curl` are installed and that
   Docker is running;
2. validates `.env.production`;
3. creates the self-signed certificate if needed;
4. validates `docker-compose.prod.yml`;
5. pulls the PostgreSQL and Keycloak images and builds the backend image and the proxy image
   (Nginx plus the Agera Nexus web app);
6. starts everything in the background: PostgreSQL creates the databases and accounts, the
   one-shot `migrate` container applies every migration not yet applied (V1 to V6), Keycloak imports the `agera` realm,
   then the backend and Nginx start;
7. waits until `https://<server>/api/health` and Keycloak answer (a minute or two the first time).

It ends with:

```
==> Agera Symphony is running
    API:            https://symphony.example.lan/api
    Web app:        https://symphony.example.lan/
    Swagger UI:     https://symphony.example.lan/api/docs
    Keycloak:       https://symphony.example.lan/auth  (admin console: .../auth/admin, user admin)
```

All containers use `restart: unless-stopped`, so they come back after a reboot or crash.
Running `./deploy.sh` again is safe: it rebuilds, applies only new migrations and keeps all data.

## 7. Create the first platform admin

The production realm has no users. Create the first one; it gets the `platform-admin`,
`admin` and `user` roles and belongs to your own company's tenant, which is created if needed:

```bash
./deploy.sh create-admin \
  --email hans@agera.eu \
  --tenant-name "Agera" \
  --tenant-domain agera.eu \
  --first-name Hans --last-name "van Oers"
```

It prints the tenant ID and a generated password **once**. Then:

1. Log in at `https://symphony.example.lan/auth/realms/agera/account` and change the password.
2. Replace the temporary Keycloak administrator. Open `https://symphony.example.lan/auth/admin`,
   log in with `KEYCLOAK_ADMIN` / `KEYCLOAK_ADMIN_PASSWORD` from `.env.production`, create a
   permanent administrator in the `master` realm (Users → Add user, then Role mapping → `admin`),
   log in as that user and delete the temporary one. `create-admin` uses the temporary account,
   so do this after you have created your platform admin.

More users: create them in the Keycloak admin console in the `agera` realm (Users → Add user).
A user belongs to the tenant whose domain matches their email domain, or to the tenant set in
the user's `tenant_id` attribute (Attributes tab), which takes precedence.

## 8. Get a token, create tenants and API keys

Requests to the API need a Keycloak access token (valid 5 minutes). On the server:

```bash
cd /opt/agera-symphony
SECRET=$(grep '^KEYCLOAK_CLIENT_SECRET=' .env.production | cut -d= -f2)
URL=https://symphony.example.lan
CA="--cacert docker/nginx/certs/fullchain.pem"     # leave empty if the certificate is trusted

read -rsp 'Password: ' PW; echo
TOKEN=$(curl -s $CA -X POST "$URL/auth/realms/agera/protocol/openid-connect/token" \
  -d grant_type=password -d client_id=agera-backend -d client_secret="$SECRET" \
  -d username=hans@agera.eu --data-urlencode password="$PW" \
  | sed -n 's/.*"access_token":"\([^"]*\)".*/\1/p')

curl -s $CA -H "Authorization: Bearer $TOKEN" "$URL/api/users/me"
```

You can also paste the token into **Authorize → keycloak** in the Swagger UI at `/api/docs` and
try every endpoint from the browser.

**Create a customer tenant** (users with an email at `nordic.eu` will belong to it):

```bash
curl -s $CA -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"Nordic Retail","domain":"nordic.eu"}' "$URL/api/tenants"
```

**Create an API key for a client portal.** Leave out `tenantId` for a key on your own tenant;
`expiresAt` is optional:

```bash
curl -s $CA -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"Nordic portal","tenantId":"<tenant id>","expiresAt":"2027-12-31T23:59:59Z"}' \
  "$URL/api/api-keys"
```

The response contains `"key": "agk_..."`. **It is shown only once**; only a hash is stored. Give
it to the portal team over a secure channel. List keys with `GET /api/api-keys` and revoke one
with `DELETE /api/api-keys/<id>`; a revoked or expired key stops working immediately.

**What the portal does with it** (read-only, scoped to that one tenant):

```bash
curl -s $CA -H "X-API-Key: agk_..." "$URL/api/portal/sync/overview?limit=100"
# then repeatedly, with nextUpdatedSince from the previous answer:
curl -s $CA -H "X-API-Key: agk_..." "$URL/api/portal/sync/overview?updatedSince=2026-10-02T09:28:13.605Z"
```

Poll again straight away while `hasMore` is `true`. Photo links in responses (`url`) already
include the `/api` prefix: download them with the same `X-API-Key` header.

---

## Agera Nexus web app and voice processing

The web app (financial projections, DSR activity, `Cmd+K` / `Ctrl+K` command bar) is served at
`https://<server>/`. It logs in through Keycloak with the public `agera-frontend` client (PKCE),
which the realm import creates on a fresh install.

**Installs created before Phase 10:** Keycloak only imports the realm on its first start, so add
the client once by hand (replace the address):

```bash
./deploy.sh compose exec keycloak sh -c '
  /opt/keycloak/bin/kcadm.sh config credentials --server http://localhost:8080/auth --realm master --user "$KC_BOOTSTRAP_ADMIN_USERNAME" --password "$KC_BOOTSTRAP_ADMIN_PASSWORD" &&
  /opt/keycloak/bin/kcadm.sh create clients -r agera -s clientId=agera-frontend -s publicClient=true \
    -s standardFlowEnabled=true -s directAccessGrantsEnabled=false \
    -s "redirectUris=[\"https://symphony.example.lan/*\"]" -s "webOrigins=[\"https://symphony.example.lan\"]" \
    -s "attributes={\"pkce.code.challenge.method\":\"S256\"}"'
```

then copy the `agera-backend-audience` and `tenant_id` mappers from `agera-backend` to it in the
admin console (Clients → agera-frontend → Client scopes → Dedicated scope → Add mapper).

**Voice clips** (`POST /api/v1/nexus/voice-event`) are stored in the `uploads` volume under
`<tenantId>/voice/` and queued with status `pending`. The `whisper-local` container is a
placeholder for local, open-source Whisper transcription; nothing leaves the server. It is not
started by default and the backend does not call it yet:

```bash
./deploy.sh compose --profile voice up -d whisper-local   # downloads the model on first start
```

## Operations

All `docker compose` commands need the production settings; `./deploy.sh compose ...` adds them.

| Task | Command |
|---|---|
| Status and health | `./deploy.sh status` |
| Logs | `./deploy.sh compose logs -f backend` (or `keycloak`, `proxy`, `postgres`, `migrate`) |
| Restart one service | `./deploy.sh compose restart backend` |
| Stop everything (data kept) | `./deploy.sh compose down` |
| Start again | `./deploy.sh` |

Never run `docker compose down -v` on the server: `-v` deletes the database and photo volumes.

### Updating

```bash
cd /opt/agera-symphony
git pull                     # or unpack the new release over the old one, keeping .env.production and docker/nginx/certs
./deploy.sh
```

New migrations (`V6__...sql` and later) are applied automatically and recorded in the
`schema_migrations` table. A migration that was already applied must never be edited: the
deploy stops with "checksum mismatch" if it was.

### Backups

Data lives in two Docker volumes: `agera-symphony-prod_postgres_data` (both databases) and
`agera-symphony-prod_uploads` (photos). Back up both, for example nightly from cron:

```bash
cd /opt/agera-symphony
STAMP=$(date +%F)
B=/var/backups/agera && sudo mkdir -p $B && sudo chown "$USER": $B
PGUSER=$(grep '^POSTGRES_USER=' .env.production | cut -d= -f2)
./deploy.sh compose exec -T postgres pg_dump -U "$PGUSER" -Fc agera_symphony > $B/app-$STAMP.dump
./deploy.sh compose exec -T postgres pg_dump -U "$PGUSER" -Fc keycloak > $B/keycloak-$STAMP.dump
docker run --rm -v agera-symphony-prod_uploads:/uploads:ro -v $B:/backup alpine \
  tar -czf /backup/uploads-$STAMP.tar.gz -C /uploads .
```

Also keep `.env.production` and `docker/nginx/certs/` safe, and copy the backups to another machine.

**Restore** (on the same server, or on a new one set up with the same `.env.production` and one
`./deploy.sh` run):

```bash
./deploy.sh compose stop proxy backend keycloak
./deploy.sh compose exec -T postgres pg_restore -U "$PGUSER" -d agera_symphony --clean --if-exists < $B/app-<date>.dump
./deploy.sh compose exec -T postgres pg_restore -U "$PGUSER" -d keycloak --clean --if-exists < $B/keycloak-<date>.dump
docker run --rm -v agera-symphony-prod_uploads:/uploads -v $B:/backup alpine \
  sh -c 'rm -rf /uploads/* && tar -xzf /backup/uploads-<date>.tar.gz -C /uploads'
./deploy.sh
```

### Changing passwords

The database passwords in `.env.production` are applied when the database is first created.
To change one later, change it in the database and then in the file, e.g. for the app account:

```bash
./deploy.sh compose exec postgres psql -U "$PGUSER" -d agera_symphony \
  -c "ALTER ROLE symphony_app PASSWORD 'new-value'"
# set DB_PASSWORD=new-value in .env.production, then
./deploy.sh
```

`KEYCLOAK_CLIENT_SECRET` is imported once with the realm. To change it later, regenerate it in
the admin console (`agera` realm → Clients → agera-backend → Credentials) and copy it into
`.env.production`. `KEYCLOAK_ADMIN_PASSWORD` is only used to create the temporary admin.

## Security notes

- Only ports 80 and 443 are open; port 80 only redirects to HTTPS.
- The backend connects with `DB_USER`, which cannot change tables or read the migration history.
- API keys are read-only and limited to one tenant.
- To restrict the Keycloak admin console to an admin subnet, uncomment the `/auth/admin/` block
  in `docker/nginx/default.conf.template` and run `./deploy.sh compose restart proxy`.
- Set `SWAGGER_ENABLED=false` and run `./deploy.sh` if the API docs should not be served.
- The `agera-backend` client allows the password grant used in step 8, so scripts can get tokens.
  Disable "Direct access grants" for the client in Keycloak once a web front end with a login
  page is in place.
- Realm defaults: passwords need at least 12 characters, and repeated failed logins lock the
  account temporarily.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `cannot talk to the Docker daemon` | `sudo systemctl start docker`; log out and in after `usermod -aG docker` |
| `.env.production is not valid` | fix the listed settings; `./deploy.sh init-env` creates a correct file |
| `database migrations failed` / `checksum mismatch` | an applied migration file was edited; restore it from git and put the change in a new `V<n>__...sql` |
| `tables exist but schema_migrations is empty` | the volume holds a database created another way (e.g. the development compose file); use a fresh volume, or restore a backup into a fresh installation |
| `did not become healthy` | see the logs printed; often Keycloak is still starting on a slow machine: run `WAIT_SECONDS=900 ./deploy.sh` |
| Browser shows a certificate warning | expected with the self-signed certificate; trust it (step 5) or use your own |
| API answers `401` with a valid-looking token | the token was issued for another address: request tokens via `PUBLIC_URL`, not via the IP if `PUBLIC_URL` uses a name |
| `403 No tenant could be resolved for this user` | the user's email domain matches no tenant and the user has no `tenant_id` attribute |
| Port 80 or 443 already in use | stop the other web server (`sudo systemctl disable --now apache2` or `nginx`) or set `HTTP_PORT`/`HTTPS_PORT` |
