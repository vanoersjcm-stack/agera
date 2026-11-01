#!/usr/bin/env bash
# Agera Symphony - production deployment on a local Ubuntu server. See DEPLOYMENT.md.
#
#   ./deploy.sh init-env <public-url>   create .env.production with random secrets
#   ./deploy.sh [up]                    validate, build and (re)start the stack, apply migrations
#   ./deploy.sh create-admin --email <e> --tenant-name <n> --tenant-domain <d> [--first-name <f>] [--last-name <l>]
#                                       create the first tenant and its platform-admin user
#   ./deploy.sh seed-agera --tenant-domain <d> [--keycloak-users]
#                                       import seed/agera/*.json into that tenant (idempotent); optionally
#                                       create the matching Keycloak users (no passwords set)
#   ./deploy.sh status                  show containers and health
#   ./deploy.sh compose <args...>       any docker compose command with the production settings
set -euo pipefail

cd "$(dirname "$(readlink -f "$0")")"

ENV_FILE=.env.production
ENV_TEMPLATE=.env.production.example
COMPOSE_FILE=docker-compose.prod.yml
CERT_DIR=docker/nginx/certs
WAIT_SECONDS=${WAIT_SECONDS:-420}
SECRET_KEYS=(POSTGRES_PASSWORD DB_PASSWORD KEYCLOAK_DB_PASSWORD KEYCLOAK_ADMIN_PASSWORD KEYCLOAK_CLIENT_SECRET)
REQUIRED_KEYS=(PUBLIC_URL POSTGRES_USER POSTGRES_DB DB_USER KEYCLOAK_DB_NAME KEYCLOAK_DB_USER KEYCLOAK_ADMIN "${SECRET_KEYS[@]}")

declare -A ENV=()

info() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33mwarning:\033[0m %s\n' "$*" >&2; }
die() { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

compose() { docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"; }

random_secret() { openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | head -c 32; }

check_tools() {
  local tool
  for tool in docker openssl curl; do
    command -v "$tool" >/dev/null 2>&1 || die "'$tool' is not installed (see DEPLOYMENT.md, step 1)"
  done
  docker compose version >/dev/null 2>&1 || die "'docker compose' (v2) is missing: sudo apt install docker-compose-v2"
  docker info >/dev/null 2>&1 \
    || die "cannot talk to the Docker daemon. Is it running (sudo systemctl start docker) and is $(id -un) in the 'docker' group?"
}

# Reads KEY=VALUE lines without executing the file.
load_env() {
  [[ -f $ENV_FILE ]] || die "$ENV_FILE not found. Create it with: ./deploy.sh init-env https://<server-name>"
  local line key value
  while IFS= read -r line || [[ -n $line ]]; do
    line=${line%$'\r'}
    [[ $line =~ ^[[:space:]]*(#|$) ]] && continue
    [[ $line =~ ^([A-Z_][A-Z0-9_]*)=(.*)$ ]] || die "$ENV_FILE: cannot parse line: $line"
    key=${BASH_REMATCH[1]}
    value=${BASH_REMATCH[2]}
    if [[ $value =~ ^\"(.*)\"$ || $value =~ ^\'(.*)\'$ ]]; then
      value=${BASH_REMATCH[1]}
    fi
    ENV[$key]=$value
  done <"$ENV_FILE"
}

validate_env() {
  load_env
  local errors=() key value
  for key in "${REQUIRED_KEYS[@]}"; do
    [[ -n ${ENV[$key]:-} ]] || errors+=("$key is missing or empty")
  done
  for key in "${SECRET_KEYS[@]}"; do
    value=${ENV[$key]:-}
    [[ -z $value ]] && continue
    if [[ $value == *__GENERATE__* || $value == *change-me* ]]; then
      errors+=("$key still has a placeholder value")
    elif [[ ! $value =~ ^[A-Za-z0-9._~-]{16,}$ ]]; then
      errors+=("$key must be at least 16 characters from A-Z a-z 0-9 . _ ~ -")
    fi
  done
  if [[ -n ${ENV[POSTGRES_PASSWORD]:-} && ${ENV[POSTGRES_PASSWORD]} == "${ENV[DB_PASSWORD]:-}" ]]; then
    errors+=("DB_PASSWORD must differ from POSTGRES_PASSWORD (the app account must not have owner rights)")
  fi
  if [[ -n ${ENV[POSTGRES_USER]:-} && ${ENV[POSTGRES_USER]} == "${ENV[DB_USER]:-}" ]]; then
    errors+=("DB_USER must differ from POSTGRES_USER")
  fi
  local url=${ENV[PUBLIC_URL]:-}
  if [[ -n $url && ! $url =~ ^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?$ ]]; then
    errors+=("PUBLIC_URL must look like https://symphony.example.lan (no path, no trailing slash)")
  fi
  for key in HTTP_PORT HTTPS_PORT; do
    value=${ENV[$key]:-}
    if [[ -n $value && ! $value =~ ^[0-9]{1,5}$ ]]; then
      errors+=("$key must be a port number")
    fi
  done
  local https_port=${ENV[HTTPS_PORT]:-443}
  if [[ $https_port != 443 && -n $url && $url != *":$https_port" ]]; then
    errors+=("HTTPS_PORT is $https_port, so PUBLIC_URL must end with :$https_port")
  fi
  if ((${#errors[@]} > 0)); then
    printf '  - %s\n' "${errors[@]}" >&2
    die "$ENV_FILE is not valid"
  fi
  if [[ $(stat -c '%a' "$ENV_FILE") != 600 ]]; then
    warn "$ENV_FILE is readable by other users; restricting it to the owner (chmod 600)"
    chmod 600 "$ENV_FILE"
  fi
}

public_host() {
  local host=${ENV[PUBLIC_URL]#https://}
  echo "${host%%:*}"
}

ensure_certs() {
  local cert=$CERT_DIR/fullchain.pem key=$CERT_DIR/privkey.pem
  mkdir -p "$CERT_DIR"
  if [[ -f $cert && -f $key ]]; then
    openssl x509 -in "$cert" -noout -checkend 0 >/dev/null || die "$cert has expired; replace it (see DEPLOYMENT.md, TLS)"
    openssl x509 -in "$cert" -noout -checkend $((30 * 86400)) >/dev/null || warn "$cert expires within 30 days"
    return
  fi
  local host san
  host=$(public_host)
  if [[ $host =~ ^[0-9.]+$ ]]; then san="IP:$host"; else san="DNS:$host"; fi
  info "No TLS certificate in $CERT_DIR; creating a self-signed one for $host (valid 825 days)"
  openssl req -x509 -newkey rsa:3072 -sha256 -days 825 -nodes \
    -keyout "$key" -out "$cert" -subj "/CN=$host" -addext "subjectAltName=$san" >/dev/null 2>&1 \
    || die "could not create a self-signed certificate"
  chmod 600 "$key"
}

container_state() {
  local id
  id=$(compose ps -a -q "$1" 2>/dev/null | head -n1)
  [[ -n $id ]] || { echo "missing"; return; }
  docker inspect -f '{{.State.Status}} {{.State.ExitCode}} {{if .State.Health}}{{.State.Health.Status}}{{end}}' "$id"
}

wait_until_ready() {
  local port=${ENV[HTTPS_PORT]:-443} deadline=$((SECONDS + WAIT_SECONDS)) state
  info "Waiting for the stack to become healthy (up to ${WAIT_SECONDS}s; Keycloak needs a minute on first start)"
  while ((SECONDS < deadline)); do
    state=$(container_state migrate)
    if [[ $state == exited\ * && $state != "exited 0"* ]]; then
      compose logs --no-color migrate >&2 || true
      die "database migrations failed (output above)"
    fi
    if curl -ksf -o /dev/null "https://127.0.0.1:$port/api/health" \
      && curl -ksf -o /dev/null "https://127.0.0.1:$port/auth/realms/agera/.well-known/openid-configuration"; then
      return 0
    fi
    sleep 5
  done
  compose ps -a >&2 || true
  compose logs --no-color --tail 40 backend keycloak proxy >&2 || true
  die "the stack did not become healthy within ${WAIT_SECONDS}s (status and logs above)"
}

cmd_init_env() {
  local url=${1:-}
  [[ -n $url ]] || die "usage: ./deploy.sh init-env https://<server-name>[:port]"
  [[ $url =~ ^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?$ ]] || die "the URL must look like https://symphony.example.lan"
  [[ ! -e $ENV_FILE ]] || die "$ENV_FILE already exists; edit it instead (secrets cannot be changed after the first deploy)"
  command -v openssl >/dev/null 2>&1 || die "'openssl' is not installed"
  local line out=()
  while IFS= read -r line || [[ -n $line ]]; do
    if [[ $line == PUBLIC_URL=* ]]; then
      line="PUBLIC_URL=$url"
    elif [[ $url =~ :([0-9]+)$ && $line == HTTPS_PORT=* ]]; then
      line="HTTPS_PORT=${BASH_REMATCH[1]}"
    fi
    while [[ $line == *__GENERATE__* ]]; do
      line=${line/__GENERATE__/$(random_secret)}
    done
    out+=("$line")
  done <"$ENV_TEMPLATE"
  (umask 077 && printf '%s\n' "${out[@]}" >"$ENV_FILE")
  info "Created $ENV_FILE for $url with random secrets (owner-only permissions)."
  echo "    Review it, keep a copy in your password manager, then run: ./deploy.sh"
}

cmd_up() {
  check_tools
  info "Validating $ENV_FILE"
  validate_env
  ensure_certs
  info "Validating $COMPOSE_FILE"
  compose config --quiet
  info "Pulling base images"
  compose pull --quiet --ignore-buildable
  info "Building the backend and web app images"
  compose build --pull backend proxy
  info "Starting the stack (migrations run automatically)"
  local started
  started=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  if ! compose up -d --remove-orphans; then
    compose logs --no-color --since "$started" migrate >&2 || true
    compose ps -a >&2 || true
    die "the stack failed to start (migration output and container status above)"
  fi
  wait_until_ready
  info "Granting the backend user-management rights in Keycloak (People & access)"
  compose exec -T keycloak bash -s <<'KCADM' || info "warning: could not grant user-management rights; People & access will report it as unavailable"
set -euo pipefail
kc() { /opt/keycloak/bin/kcadm.sh "$@" --config "$CFG"; }
CFG=$(mktemp)
trap 'rm -f "$CFG"' EXIT
kc config credentials --server http://localhost:8080/auth --realm master \
  --user "$KC_BOOTSTRAP_ADMIN_USERNAME" --password "$KC_BOOTSTRAP_ADMIN_PASSWORD" >/dev/null
kc add-roles -r agera --uusername service-account-agera-backend --cclientid realm-management \
  --rolename manage-users --rolename view-users --rolename query-users
KCADM
  compose logs --no-color --since "$started" migrate | sed -n 's/^.*migrate: /    migrate: /p'
  local url=${ENV[PUBLIC_URL]}
  info "Agera Symphony is running"
  cat <<INFO
    API:            $url/api
    Web app:        $url/
    Swagger UI:     $url/api/docs
    Keycloak:       $url/auth  (admin console: $url/auth/admin, user ${ENV[KEYCLOAK_ADMIN]})
    Next (first install only): ./deploy.sh create-admin --email <you@company.eu> --tenant-name <Company> --tenant-domain <company.eu>
INFO
}

cmd_create_admin() {
  local email="" tenant_name="" tenant_domain="" first_name="Platform" last_name="Admin"
  while (($# > 0)); do
    case $1 in
      --email) email=${2:-}; shift 2 ;;
      --tenant-name) tenant_name=${2:-}; shift 2 ;;
      --tenant-domain) tenant_domain=${2:-}; shift 2 ;;
      --first-name) first_name=${2:-}; shift 2 ;;
      --last-name) last_name=${2:-}; shift 2 ;;
      *) die "unknown option: $1" ;;
    esac
  done
  [[ -n $email && -n $tenant_name && -n $tenant_domain ]] \
    || die "usage: ./deploy.sh create-admin --email <e> --tenant-name <n> --tenant-domain <d> [--first-name <f>] [--last-name <l>]"
  email=${email,,}
  tenant_domain=${tenant_domain,,}
  [[ $email =~ ^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$ ]] || die "--email is not a valid address"
  [[ $tenant_domain =~ ^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$ ]] || die "--tenant-domain must be a domain such as company.eu"
  ((${#tenant_name} <= 255)) || die "--tenant-name is too long"

  check_tools
  validate_env
  [[ $(container_state keycloak) == running* && $(container_state postgres) == running* ]] \
    || die "the stack is not running; run ./deploy.sh first"

  info "Creating or reusing tenant '$tenant_name' ($tenant_domain)"
  local tenant_id
  tenant_id=$(compose exec -T postgres psql -X -q -t -A -v ON_ERROR_STOP=1 \
    -U "${ENV[POSTGRES_USER]}" -d "${ENV[POSTGRES_DB]}" -v name="$tenant_name" -v domain="$tenant_domain" <<'SQL'
INSERT INTO tenants (name, domain) VALUES (:'name', :'domain')
ON CONFLICT (domain) DO UPDATE SET domain = EXCLUDED.domain
RETURNING id;
SQL
  )
  tenant_id=$(echo "$tenant_id" | tr -d '[:space:]')
  [[ $tenant_id =~ ^[0-9a-f-]{36}$ ]] || die "could not create the tenant"

  info "Creating Keycloak user $email with the platform-admin role"
  local password
  password="$(random_secret | head -c 20)-Ag1"
  compose exec -T -e AG_EMAIL="$email" -e AG_TENANT="$tenant_id" -e AG_PASSWORD="$password" \
    -e AG_FIRST="$first_name" -e AG_LAST="$last_name" keycloak bash -s <<'KCADM'
set -euo pipefail
kc() { /opt/keycloak/bin/kcadm.sh "$@" --config "$CFG"; }
CFG=$(mktemp)
trap 'rm -f "$CFG"' EXIT
kc config credentials --server http://localhost:8080/auth --realm master \
  --user "$KC_BOOTSTRAP_ADMIN_USERNAME" --password "$KC_BOOTSTRAP_ADMIN_PASSWORD" >/dev/null
if [[ -n $(kc get users -r agera -q email="$AG_EMAIL" -q exact=true --fields id --format csv --noquotes) ]]; then
  echo "error: a user with email $AG_EMAIL already exists in the agera realm" >&2
  exit 3
fi
kc create users -r agera -s username="$AG_EMAIL" -s email="$AG_EMAIL" -s emailVerified=true -s enabled=true \
  -s firstName="$AG_FIRST" -s lastName="$AG_LAST" -s "attributes.tenant_id=[\"$AG_TENANT\"]" >/dev/null
kc set-password -r agera --username "$AG_EMAIL" --new-password "$AG_PASSWORD" >/dev/null
kc add-roles -r agera --uusername "$AG_EMAIL" --rolename platform-admin --rolename admin --rolename user >/dev/null
KCADM

  local url=${ENV[PUBLIC_URL]}
  info "Platform admin created"
  cat <<INFO
    Tenant:    $tenant_name ($tenant_domain), id $tenant_id
    Login:     $email
    Password:  $password
               (shown only now; change it at $url/auth/realms/agera/account)
    Next:      create API keys for portal connectors, see DEPLOYMENT.md step 8.
INFO
}

cmd_seed_agera() {
  local tenant_domain="" keycloak_users=false
  while (($# > 0)); do
    case $1 in
      --tenant-domain) tenant_domain=${2:-}; shift 2 ;;
      --keycloak-users) keycloak_users=true; shift ;;
      *) die "unknown option: $1" ;;
    esac
  done
  [[ -n $tenant_domain ]] || die "usage: ./deploy.sh seed-agera --tenant-domain <d> [--keycloak-users]"
  tenant_domain=${tenant_domain,,}

  check_tools
  validate_env
  [[ $(container_state backend) == running* && $(container_state postgres) == running* ]] \
    || die "the stack is not running; run ./deploy.sh first"

  info "Importing seed/agera into tenant $tenant_domain"
  compose exec -T backend node dist/seed/agera-seed.js --tenant-domain "$tenant_domain" --dir seed/agera

  $keycloak_users || return 0
  local tenant_id
  tenant_id=$(compose exec -T postgres psql -X -q -t -A -v ON_ERROR_STOP=1 \
    -U "${ENV[POSTGRES_USER]}" -d "${ENV[POSTGRES_DB]}" -v domain="$tenant_domain" <<'SQL'
SELECT id FROM tenants WHERE domain = :'domain';
SQL
  )
  tenant_id=$(echo "$tenant_id" | tr -d '[:space:]')
  [[ $tenant_id =~ ^[0-9a-f-]{36}$ ]] || die "tenant $tenant_domain not found"

  info "Creating the seeded Keycloak users (existing usernames are skipped)"
  local users
  users=$(sed "s/a9e1a000-0000-4000-8000-000000000001/$tenant_id/g" seed/agera/keycloak-users.json)
  compose exec -T -e AG_USERS="$users" keycloak bash -s <<'KCADM'
set -euo pipefail
kc() { /opt/keycloak/bin/kcadm.sh "$@" --config "$CFG"; }
CFG=$(mktemp)
trap 'rm -f "$CFG"' EXIT
kc config credentials --server http://localhost:8080/auth --realm master \
  --user "$KC_BOOTSTRAP_ADMIN_USERNAME" --password "$KC_BOOTSTRAP_ADMIN_PASSWORD" >/dev/null
printf '%s' "$AG_USERS" | kc create partialImport -r agera -f - >/dev/null
KCADM
  info "Done. Set a password for each user in the Keycloak admin console (Users -> Credentials)."
}

cmd_status() {
  check_tools
  load_env
  compose ps -a
}

case ${1:-up} in
  init-env) shift; cmd_init_env "$@" ;;
  up) cmd_up ;;
  create-admin) shift; cmd_create_admin "$@" ;;
  seed-agera) shift; cmd_seed_agera "$@" ;;
  status) cmd_status ;;
  compose) shift; check_tools; load_env; compose "$@" ;;
  -h | --help | help) sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//' ;;
  *) die "unknown command '$1' (try ./deploy.sh help)" ;;
esac
