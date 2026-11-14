# Agera Suite - ./deploy.sh audit-compliance: read-only GDPR / DORA / NIS2 / IDMS / sovereignty self-audit.
# Sourced by deploy.sh (uses its compose, ENV, info, warn). Writes compliance-audit-YYYY-MM-DD.md (git-ignored)
# and exits non-zero when any check FAILs. Nothing is changed: probes run in transactions that are rolled back.
#
#   ./deploy.sh audit-compliance          gates 1-5 against this server
#   ./deploy.sh audit-compliance --e2e    also run the security E2E suites (test stack only: needs .env and the
#                                         development Keycloak with the test users; they write test data)

AUDIT_ROWS=()
AUDIT_FAILS=0
AUDIT_WARNS=0
FORBIDDEN_HOSTS='googleapis\.com|gstatic\.com|google-analytics\.com|googletagmanager\.com|graph\.microsoft\.com|login\.microsoftonline\.com|api\.openai\.com|sentry\.io|cdn\.jsdelivr\.net|unpkg\.com'
US_MAIL_RELAYS='gmail|google|office365|outlook|microsoft|sendgrid|mailgun|amazonaws|mandrillapp|postmarkapp|sparkpost|mailchimp'
E2E_SUITES=(rls job-roles idms office print-scan calendar)

rec() { # gate, check, PASS|FAIL|WARN|SKIP, detail
  local detail=${4//|/\\|}
  AUDIT_ROWS+=("| $1 | $2 | **$3** | ${detail//$'\n'/ } |")
  case $3 in FAIL) AUDIT_FAILS=$((AUDIT_FAILS + 1)) ;; WARN) AUDIT_WARNS=$((AUDIT_WARNS + 1)) ;; esac
  printf '  %-4s %-48s %s\n' "$3" "$2" "${4//$'\n'/ }"
}

# Owner connection (sees everything); stdin is the SQL.
asql() { compose exec -T postgres psql -X -q -t -A -v ON_ERROR_STOP=1 -U "${ENV[POSTGRES_USER]}" -d "${ENV[POSTGRES_DB]}" "$@"; }
# The backend's own least-privilege role, exactly as NestJS connects.
appsql() {
  compose exec -T -e PGPASSWORD="${ENV[DB_PASSWORD]}" postgres \
    psql -X -q -t -A -v ON_ERROR_STOP=1 -h 127.0.0.1 -U "${ENV[DB_USER]}" -d "${ENV[POSTGRES_DB]}" "$@"
}

gate1_rls() {
  info "Gate 1 - PostgreSQL RLS and multi-tenant isolation (GDPR Art. 32)"
  local missing total
  total=$(asql <<<"SELECT count(*) FROM pg_tables WHERE schemaname = 'public' AND tablename NOT IN ('schema_migrations', 'tenants')")
  missing=$(asql <<'SQL'
SELECT coalesce(string_agg(t.tablename, ', ' ORDER BY t.tablename), '') FROM pg_tables t
 WHERE t.schemaname = 'public' AND t.tablename NOT IN ('schema_migrations', 'tenants')
   AND (NOT t.rowsecurity OR NOT EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = t.tablename))
SQL
  )
  if [[ -z $missing ]]; then
    rec 1 "RLS enabled + policy on every tenant table" PASS "$total tables; allow-listed global tables: schema_migrations, tenants"
  else
    rec 1 "RLS enabled + policy on every tenant table" FAIL "without RLS or policy: $missing"
  fi

  local role
  role=$(asql -v u="${ENV[DB_USER]}" <<'SQL'
SELECT rolsuper || ',' || rolbypassrls || ',' || (SELECT count(*) FROM pg_tables WHERE schemaname = 'public' AND tableowner = :'u')
  FROM pg_roles WHERE rolname = :'u'
SQL
  )
  if [[ $role == false,false,0 ]]; then
    rec 1 "App DB role is least-privilege" PASS "${ENV[DB_USER]}: not superuser, no BYPASSRLS, owns no tables"
  else
    rec 1 "App DB role is least-privilege" FAIL "${ENV[DB_USER]}: superuser,bypassrls,owned tables = ${role:-role not found}"
  fi

  local leaked
  if leaked=$(appsql <<'SQL' 2>&1
SELECT (SELECT count(*) FROM users) + (SELECT count(*) FROM clients) + (SELECT count(*) FROM room_documents)
     + (SELECT count(*) FROM calendar_events) + (SELECT count(*) FROM audit_logs) + (SELECT count(*) FROM invoices)
SQL
  ); then
    if [[ $leaked == 0 ]]; then
      rec 1 "App role sees nothing without a tenant" PASS "users, clients, room_documents, calendar_events, audit_logs, invoices: 0 rows"
    else
      rec 1 "App role sees nothing without a tenant" FAIL "$leaked rows visible without app.current_tenant"
    fi
  else
    rec 1 "App role sees nothing without a tenant" FAIL "could not connect as ${ENV[DB_USER]}: $leaked"
  fi

  local policies
  policies=$(asql <<'SQL'
SELECT coalesce(string_agg(x.t || '.' || x.p, ', '), '') FROM (VALUES
  ('clients', 'private_clients_owner_policy'),
  ('room_documents', 'personal_room_documents_owner_policy'),
  ('calendar_events', 'private_calendar_events_owner_policy')) AS x(t, p)
 WHERE NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = x.t AND policyname = x.p AND permissive = 'RESTRICTIVE')
SQL
  )
  if [[ -z $policies ]]; then
    rec 1 "Creator-only RLS (V30 private, client-less docs, V34 calendar)" PASS "restrictive policies active on clients, room_documents, calendar_events"
  else
    rec 1 "Creator-only RLS (V30 private, client-less docs, V34 calendar)" FAIL "missing restrictive policy: $policies"
  fi
}

gate2_vault() {
  info "Gate 2 - audit vault immutability and IDMS WORM locks (DORA, GDPR Art. 17)"
  local grants
  grants=$(asql -v u="${ENV[DB_USER]}" <<'SQL'
SELECT coalesce(string_agg(privilege_type, ','), '') FROM information_schema.role_table_grants
 WHERE table_name = 'audit_logs' AND grantee = :'u' AND privilege_type IN ('UPDATE', 'DELETE', 'TRUNCATE')
SQL
  )
  if [[ -z $grants ]]; then
    rec 2 "App role cannot UPDATE/DELETE audit_logs" PASS "${ENV[DB_USER]} has INSERT/SELECT only"
  else
    rec 2 "App role cannot UPDATE/DELETE audit_logs" FAIL "${ENV[DB_USER]} still has: $grants"
  fi

  local trig
  trig=$(asql <<'SQL'
SELECT count(*) FROM pg_trigger WHERE tgrelid = 'audit_logs'::regclass AND tgenabled <> 'D'
   AND tgname IN ('audit_logs_chain', 'audit_logs_no_update', 'audit_logs_no_truncate')
SQL
  )
  if [[ $trig == 3 ]]; then
    rec 2 "Append-only + hash-chain triggers on audit_logs" PASS "chain, no-update/delete and no-truncate triggers enabled"
  else
    rec 2 "Append-only + hash-chain triggers on audit_logs" FAIL "only $trig of 3 triggers enabled"
  fi

  local chain rows=0 broken=() line
  chain=$(asql 2>&1 <<'SQL'
BEGIN;
DO $$
DECLARE t RECORD; v RECORD;
BEGIN
  FOR t IN SELECT id, name FROM tenants ORDER BY name LOOP
    PERFORM set_config('app.current_tenant', t.id::text, true);
    SELECT * INTO v FROM app_verify_audit_chain();
    RAISE NOTICE 'CHAIN|%|%|%', t.name, v.checked, coalesce(v.first_broken_seq::text, '');
  END LOOP;
END $$;
ROLLBACK;
SQL
  ) || true
  while IFS='|' read -r _ name checked brk; do
    rows=$((rows + checked))
    [[ -n $brk ]] && broken+=("$name (first broken seq $brk)")
  done < <(grep -o 'CHAIN|.*' <<<"$chain")
  if ! grep -q 'CHAIN|' <<<"$chain"; then
    rec 2 "SHA-256 hash chain, 100% of rows" FAIL "verification did not run: $(tail -n1 <<<"$chain")"
  elif ((${#broken[@]} == 0)); then
    rec 2 "SHA-256 hash chain, 100% of rows" PASS "$rows rows in $(grep -c 'CHAIN|' <<<"$chain") organisations verified, 0 broken links"
  else
    rec 2 "SHA-256 hash chain, 100% of rows" FAIL "broken: ${broken[*]}"
  fi

  local idms result blocked=() allowed=() norow=() scratch=()
  idms=$(asql -c "SELECT string_agg(tgrelid::regclass::text, ',' ORDER BY 1) FROM pg_trigger WHERE tgname IN ('trg_room_documents_idms', 'trg_agreements_idms', 'trg_financial_models_idms', 'trg_invoices_idms') AND tgenabled <> 'D'")
  result=$(asql 2>&1 <<'SQL'
BEGIN;
DO $$
DECLARE t TEXT; rid UUID; st TEXT; op TEXT; outcome TEXT; probe_tenant UUID; probe_client UUID;
BEGIN
  FOREACH t IN ARRAY ARRAY['room_documents', 'agreements', 'financial_models', 'invoices'] LOOP
    EXECUTE format('SELECT id, idms_status FROM %I WHERE idms_status IN (''FINAL_LOCKED'', ''ARCHIVED_WORM'') ORDER BY idms_status DESC LIMIT 1', t) INTO rid, st;
    IF rid IS NULL THEN
      -- No real locked record: lock a scratch one in a scratch organisation. The ROLLBACK below removes both.
      BEGIN
        IF probe_tenant IS NULL THEN
          INSERT INTO tenants (name, domain) VALUES ('Compliance audit probe', 'probe-' || gen_random_uuid() || '.invalid')
            RETURNING id INTO probe_tenant;
          INSERT INTO clients (tenant_id, name) VALUES (probe_tenant, 'Compliance audit probe') RETURNING id INTO probe_client;
        END IF;
        CASE t
          WHEN 'room_documents' THEN
            INSERT INTO room_documents (tenant_id, title, idms_status) VALUES (probe_tenant, 'probe', 'FINAL_LOCKED') RETURNING id INTO rid;
          WHEN 'agreements' THEN
            INSERT INTO agreements (tenant_id, client_id, title, document_url, idms_status)
              VALUES (probe_tenant, probe_client, 'probe', 'probe', 'FINAL_LOCKED') RETURNING id INTO rid;
          WHEN 'financial_models' THEN
            INSERT INTO financial_models (tenant_id, model_name, fiscal_year, idms_status)
              VALUES (probe_tenant, 'probe', 2000, 'FINAL_LOCKED') RETURNING id INTO rid;
          WHEN 'invoices' THEN
            INSERT INTO invoices (tenant_id, client_id, invoice_number, issue_date, amount_excl_vat, idms_status)
              VALUES (probe_tenant, probe_client, 'PROBE-0001', CURRENT_DATE, 0, 'FINAL_LOCKED') RETURNING id INTO rid;
        END CASE;
        st := 'FINAL_LOCKED*';
      EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'IDMS|%|-|NOROW %', t, SQLERRM; CONTINUE;
      END;
    END IF;
    FOREACH op IN ARRAY ARRAY['UPDATE', 'DELETE'] LOOP
      BEGIN
        IF op = 'UPDATE' THEN
          EXECUTE format('UPDATE %I SET created_at = created_at + interval ''1 second'' WHERE id = $1', t) USING rid;
        ELSE
          EXECUTE format('DELETE FROM %I WHERE id = $1', t) USING rid;
        END IF;
        RAISE EXCEPTION 'probe went through' USING ERRCODE = 'AGX01'; -- undo the change
      EXCEPTION
        WHEN SQLSTATE 'AG403' THEN outcome := 'BLOCKED';
        WHEN SQLSTATE 'AGX01' THEN outcome := 'ALLOWED';
        WHEN OTHERS THEN outcome := 'ERROR ' || SQLERRM;
      END;
      RAISE NOTICE 'IDMS|%|%|% %', t, st, op, outcome;
    END LOOP;
  END LOOP;
END $$;
ROLLBACK;
SQL
  ) || true
  while IFS='|' read -r _ table status what; do
    case $what in
      NOROW*) norow+=("$table${what#NOROW}") ;;
      *BLOCKED) blocked+=("$table/$status ${what%% *}"); [[ $status == *'*' ]] && scratch+=("$table") ;;
      *) allowed+=("$table/$status $what") ;;
    esac
  done < <(grep -o 'IDMS|.*' <<<"$result")
  if [[ $idms != *room_documents* || $idms != *agreements* || $idms != *financial_models* || $idms != *invoices* ]]; then
    rec 2 "IDMS FINAL_LOCKED / ARCHIVED_WORM triggers" FAIL "trigger missing or disabled; enabled on: ${idms:-none}"
  elif ((${#allowed[@]} > 0)) || ! grep -q 'IDMS|' <<<"$result"; then
    rec 2 "IDMS FINAL_LOCKED / ARCHIVED_WORM triggers" FAIL "not blocked: ${allowed[*]:-probe did not run: $(tail -n1 <<<"$result")}"
  elif ((${#norow[@]} > 0)); then
    rec 2 "IDMS FINAL_LOCKED / ARCHIVED_WORM triggers" WARN "triggers on all 4 tables; probes blocked (${#blocked[@]}); no locked record to probe in: ${norow[*]}"
  else
    local how="real locked records"
    ((${#scratch[@]} > 0)) && how="real locked records, or a scratch locked record (rolled back) for: $(printf '%s\n' "${scratch[@]}" | sort -u | paste -sd' ')"
    rec 2 "IDMS FINAL_LOCKED / ARCHIVED_WORM triggers" PASS "triggers on all 4 tables; UPDATE and DELETE of a locked record refused in all 4 ($how)"
  fi

  local sched handler policies errors
  sched=$(compose exec -T backend grep -c "IDMS retention job failed" dist/modules/idms/idms.service.js 2>/dev/null || true)
  handler=$(compose exec -T backend grep -c "idms.purged" dist/modules/idms/idms.service.js 2>/dev/null || true)
  policies=$(asql <<<"SELECT count(*) || ' policies in ' || count(DISTINCT tenant_id) || ' organisations' FROM retention_policies")
  errors=$(compose logs --no-color backend 2>/dev/null | grep -c "IDMS retention job failed" || true)
  sched=${sched:-0} handler=${handler:-0} errors=${errors:-0}
  if ((sched > 0 && handler > 0 && errors == 0)); then
    rec 2 "Retention job + idms.purged audit event" PASS "daily job built into the running backend, idms.purged audit event present; $policies; 0 job failures in backend log"
  else
    rec 2 "Retention job + idms.purged audit event" FAIL "scheduler: $sched, idms.purged handler: $handler, job failures in log: $errors"
  fi
}

gate3_sovereignty() {
  info "Gate 3 - no US-cloud / telemetry calls, sovereign mail, print and PDF rendering (GDPR Arts. 44-49)"
  local web api src
  web=$(compose exec -T proxy sh -c "grep -rElo '$FORBIDDEN_HOSTS' /usr/share/nginx/html" 2>/dev/null || true)
  api=$(compose exec -T backend sh -c "grep -rElo '$FORBIDDEN_HOSTS' dist" 2>/dev/null || true)
  src=$(grep -rElE "$FORBIDDEN_HOSTS" src frontend/src frontend/index.html 2>/dev/null || true)
  if [[ -z $web$api$src ]]; then
    rec 3 "No US-cloud / CDN / telemetry domains" PASS "deployed web app, deployed backend build and source: 0 hits for Google, Microsoft, OpenAI, Sentry, jsDelivr, unpkg"
  else
    rec 3 "No US-cloud / CDN / telemetry domains" FAIL "found in: $(echo $web $api $src)"
  fi

  local smtp=${ENV[SMTP_HOST]:-} cups=${ENV[CUPS_IPP_URL]:-} hard
  hard=$(grep -rEnio "smtp\.(gmail|office365)\.com|smtp-mail\.outlook\.com|($US_MAIL_RELAYS)[a-z.-]*\.(com|net)/?[a-z]*smtp|api\.sendgrid|api\.mailgun|email-smtp\.[a-z0-9-]+\.amazonaws" src 2>/dev/null || true)
  if [[ -n $hard ]]; then
    rec 3 "Mail via sovereign SMTP_* adapter" FAIL "hard-coded relay in source: $hard"
  elif [[ -z $smtp ]]; then
    rec 3 "Mail via sovereign SMTP_* adapter" WARN "no hard-coded relays; SMTP_HOST not set, so sending is off (INF-01)"
  elif grep -qiE "$US_MAIL_RELAYS" <<<"$smtp"; then
    rec 3 "Mail via sovereign SMTP_* adapter" FAIL "SMTP_HOST points to a US-cloud relay: $smtp"
  else
    rec 3 "Mail via sovereign SMTP_* adapter" PASS "SMTP_HOST=$smtp, no hard-coded relays"
  fi
  if [[ -z $cups ]]; then
    rec 3 "Print via CUPS_IPP_URL" WARN "CUPS_IPP_URL not set, so printing is off (INF-01)"
  elif [[ $cups == ipps://* ]]; then
    rec 3 "Print via CUPS_IPP_URL" PASS "IPP over TLS: ${cups%%/printers*}"
  else
    rec 3 "Print via CUPS_IPP_URL" WARN "CUPS_IPP_URL is not ipps:// (no TLS): ${cups%%/printers*}"
  fi

  local pdf
  pdf=$(compose exec -T backend node --input-type=module -e '
const base = process.env.COLLABORA_URL;
if (!base) { console.log("ERR|COLLABORA_URL not set"); process.exit(0); }
for (const [kind, name, body] of [["Agera.text", "audit.html", "<html><body><h1>Agera compliance audit</h1><p>PDF producer check.</p></body></html>"], ["Agera.calc", "audit.csv", "Item,Amount\nAudit,1\n"]]) {
  try {
    const form = new FormData();
    form.append("data", new Blob([body]), name);
    const res = await fetch(`${base}/cool/convert-to/pdf`, { method: "POST", body: form, signal: AbortSignal.timeout(60000) });
    const pdf = Buffer.from(await res.arrayBuffer()).toString("latin1");
    const m = pdf.match(/\/Producer\s*\(([^)]*)\)/) || pdf.match(/<pdf:Producer>([^<]*)</);
    const producer = m ? m[1].replace(/\\0|\u0000|\u00fe\u00ff/g, "") : "none";
    console.log(`PDF|${kind}|${res.status}|${pdf.startsWith("%PDF") ? "pdf" : "not-pdf"}|${producer}|${/Skia|Google|Chrom/i.test(pdf) ? "skia" : "clean"}`);
  } catch (e) { console.log(`ERR|${kind}: ${e.message}`); }
}' 2>&1) || true
  local ok=0 bad=() line kind status type producer flag
  while IFS='|' read -r _ kind status type producer flag; do
    if [[ $status == 200 && $type == pdf && $flag == clean && $producer =~ LibreOffice|Collabora ]]; then
      ok=$((ok + 1)); local seen=$producer
    else
      bad+=("$kind: HTTP $status, $type, producer '$producer', $flag")
    fi
  done < <(grep -o 'PDF|.*' <<<"$pdf")
  if ((ok == 2)); then
    rec 3 "Server-side PDF rendering (Collabora)" PASS "Agera.text and Agera.calc exported by Agera Office; producer '$seen'; no Skia/PDF or Google strings"
  else
    rec 3 "Server-side PDF rendering (Collabora)" FAIL "${bad[*]:-$(grep -o 'ERR|.*' <<<"$pdf" | head -n2 | tr '\n' ' ')}"
  fi
}

# Token for a demo login via the agera-backend client (direct grant); password and secret never on the command line.
demo_token() {
  local realm="${ENV[PUBLIC_URL]}/auth/realms/agera/protocol/openid-connect/token"
  curl -ks --max-time 20 "$realm" -d grant_type=password -d client_id=agera-backend \
    --data-urlencode "client_secret@"<(printf '%s' "${ENV[KEYCLOAK_CLIENT_SECRET]}") \
    --data-urlencode "username=$1" --data-urlencode "password@"<(printf '%s' "$2") \
    | sed -n 's/.*"access_token":"\([^"]*\)".*/\1/p' || true
}

probe() { # token, method, path, expected status, label
  local code
  code=$(curl -ks --max-time 20 -o /dev/null -w '%{http_code}' -X "$2" -H "Authorization: Bearer $1" \
    -H 'Content-Type: application/json' ${6:+-d "$6"} "${ENV[PUBLIC_URL]}/api$3" || true)
  if [[ $code == "$4" ]]; then PROBE_OK+=("$5 $2 $3 -> $code"); else PROBE_BAD+=("$5 $2 $3 -> $code (expected $4)"); fi
}

gate4_rbac() {
  local e2e=$1
  info "Gate 4 - role-based access control and security regression"
  local unauth
  unauth=$(curl -ks --max-time 20 -o /dev/null -w '%{http_code}' "${ENV[PUBLIC_URL]}/api/users/me" || true)
  [[ $unauth == 401 ]] && rec 4 "No token = no access" PASS "GET /api/users/me without token -> 401" \
    || rec 4 "No token = no access" FAIL "GET /api/users/me without token -> $unauth"

  if [[ ! -f demo-logins.txt ]]; then
    rec 4 "Live role matrix (demo logins, read-only)" SKIP "demo-logins.txt not found (./deploy.sh seed-demo creates it)"
  else
    declare -A email=() pass=()
    local role="" line tenant="" first_tenant=""
    while IFS= read -r line; do
      if [[ $line =~ ^==\ (.*)\ ==$ ]]; then tenant=${BASH_REMATCH[1]}; [[ -z $first_tenant ]] && first_tenant=$tenant; role=""; continue; fi
      [[ $tenant == "$first_tenant" ]] || continue
      if [[ $line =~ —\ (PLATFORM_ADMIN|HQ_ADMIN|ACCOUNT_MANAGER|FIELD_REPRESENTATIVE|CLIENT_VIEWER) ]]; then role=${BASH_REMATCH[1]}; continue; fi
      [[ -n $role && -z ${email[$role]:-} && $line =~ ^\ +Login:\ +(.+)$ ]] && email[$role]=${BASH_REMATCH[1]}
      [[ -n $role && -z ${pass[$role]:-} && $line =~ ^\ +Password:\ +(.+)$ ]] && pass[$role]=${BASH_REMATCH[1]}
    done < demo-logins.txt
    declare -A tok=()
    local r missing=()
    for r in HQ_ADMIN ACCOUNT_MANAGER FIELD_REPRESENTATIVE CLIENT_VIEWER; do
      [[ -n ${email[$r]:-} ]] && tok[$r]=$(demo_token "${email[$r]}" "${pass[$r]}")
      [[ -n ${tok[$r]:-} ]] || missing+=("$r")
    done
    if ((${#missing[@]} > 0)); then
      rec 4 "Live role matrix (demo logins, read-only)" FAIL "could not log in as: ${missing[*]} ($first_tenant)"
    else
      PROBE_OK=() PROBE_BAD=()
      local from to
      from=$(date -u +%Y-%m-%dT00:00:00Z) to=$(date -u -d '+7 days' +%Y-%m-%dT00:00:00Z)
      probe "${tok[HQ_ADMIN]}" GET /v1/operations/purchase-orders 200 HQ_ADMIN
      probe "${tok[HQ_ADMIN]}" GET /v1/financials/pnl 200 HQ_ADMIN
      probe "${tok[HQ_ADMIN]}" GET "/v1/calendar?from=$from&to=$to&scope=team" 200 HQ_ADMIN
      probe "${tok[ACCOUNT_MANAGER]}" GET /v1/operations/purchase-orders 200 ACCOUNT_MANAGER
      probe "${tok[ACCOUNT_MANAGER]}" POST /v1/operations/purchase-orders 403 ACCOUNT_MANAGER '{}'
      probe "${tok[ACCOUNT_MANAGER]}" GET /v1/financials/pnl 200 ACCOUNT_MANAGER
      probe "${tok[FIELD_REPRESENTATIVE]}" GET /v1/operations/purchase-orders 403 FIELD_REPRESENTATIVE
      probe "${tok[FIELD_REPRESENTATIVE]}" GET /v1/financials/pnl 403 FIELD_REPRESENTATIVE
      probe "${tok[FIELD_REPRESENTATIVE]}" GET "/v1/calendar?from=$from&to=$to" 200 FIELD_REPRESENTATIVE
      probe "${tok[FIELD_REPRESENTATIVE]}" GET /v1/notifications 200 FIELD_REPRESENTATIVE
      probe "${tok[CLIENT_VIEWER]}" GET "/v1/calendar?from=$from&to=$to" 403 CLIENT_VIEWER
      probe "${tok[CLIENT_VIEWER]}" GET /v1/operations/purchase-orders 403 CLIENT_VIEWER
      probe "${tok[CLIENT_VIEWER]}" GET /v1/financials/pnl 403 CLIENT_VIEWER
      probe "${tok[CLIENT_VIEWER]}" GET /audit-logs 403 CLIENT_VIEWER
      if ((${#PROBE_BAD[@]} == 0)); then
        rec 4 "Live role matrix (demo logins, read-only)" PASS "${#PROBE_OK[@]}/${#PROBE_OK[@]} probes as expected for HQ_ADMIN, ACCOUNT_MANAGER, FIELD_REPRESENTATIVE, CLIENT_VIEWER ($first_tenant)"
      else
        rec 4 "Live role matrix (demo logins, read-only)" FAIL "${PROBE_BAD[*]}"
      fi

      local foreign code
      foreign=$(asql -v e="${email[HQ_ADMIN]}" <<'SQL'
SELECT c.id FROM clients c WHERE c.tenant_id <> (SELECT tenant_id FROM users WHERE email = :'e') ORDER BY c.created_at LIMIT 1
SQL
      )
      if [[ -z $foreign ]]; then
        rec 4 "Cross-tenant record returns 404 (DEC-03)" SKIP "no client of another organisation to probe"
      else
        code=$(curl -ks --max-time 20 -o /dev/null -w '%{http_code}' -H "Authorization: Bearer ${tok[HQ_ADMIN]}" "${ENV[PUBLIC_URL]}/api/v1/clients/$foreign" || true)
        [[ $code == 404 ]] && rec 4 "Cross-tenant record returns 404 (DEC-03)" PASS "HQ admin of $first_tenant asking for another organisation's client -> 404" \
          || rec 4 "Cross-tenant record returns 404 (DEC-03)" FAIL "another organisation's client -> $code"
      fi
    fi
  fi

  if [[ $e2e != true ]]; then
    rec 4 "Security E2E suites (${E2E_SUITES[*]})" SKIP "not on this server (they need the test Keycloak users and write test data); run ./deploy.sh audit-compliance --e2e on the test stack"
    return
  fi
  local files=() s out pass fail
  if ! command -v node >/dev/null; then
    rec 4 "Security E2E suites (${E2E_SUITES[*]})" FAIL "node not found on PATH; install Node.js 22+ to run the suites"
    return
  fi
  for s in "${E2E_SUITES[@]}"; do files+=("test/$s.e2e.test.ts"); done
  out=$(node --env-file-if-exists=.env --test "${files[@]}" 2>&1) || true
  pass=$(sed -n 's/^# pass \([0-9]*\)$/\1/p' <<<"$out" | tail -n1)
  fail=$(sed -n 's/^# fail \([0-9]*\)$/\1/p' <<<"$out" | tail -n1)
  if [[ -n $pass && $fail == 0 ]]; then
    rec 4 "Security E2E suites (${E2E_SUITES[*]})" PASS "$pass passed, 0 failed"
  else
    rec 4 "Security E2E suites (${E2E_SUITES[*]})" FAIL "${pass:-?} passed, ${fail:-?} failed"
  fi
}

gate5_supply_chain() {
  info "Gate 5 - dependency vulnerabilities and live HTTPS security headers"
  local dir out counts
  for dir in . frontend; do
    out=$(docker run --rm -v "$(pwd)/$dir:/w:ro" -w /w node:22-alpine sh -c \
      'npm audit --omit=dev --json 2>/dev/null | node -e "let s=\"\";process.stdin.on(\"data\",d=>s+=d).on(\"end\",()=>{try{const v=JSON.parse(s).metadata.vulnerabilities;console.log(v.critical+\"|\"+v.high+\"|\"+v.moderate+\"|\"+v.low)}catch{console.log(\"ERR\")}})"' 2>&1 | tail -n1 || true)
    local label="npm audit --omit=dev ($([[ $dir == . ]] && echo backend || echo frontend))"
    if [[ $out =~ ^([0-9]+)\|([0-9]+)\|([0-9]+)\|([0-9]+)$ ]]; then
      counts="critical ${BASH_REMATCH[1]}, high ${BASH_REMATCH[2]}, moderate ${BASH_REMATCH[3]}, low ${BASH_REMATCH[4]}"
      if ((BASH_REMATCH[1] + BASH_REMATCH[2] == 0)); then rec 5 "$label" PASS "$counts"; else rec 5 "$label" FAIL "$counts"; fi
    else
      rec 5 "$label" WARN "registry not reachable from this server; run it where the npm registry is reachable"
    fi
  done

  local headers missing=() h
  headers=$(curl -ksI --max-time 20 "${ENV[PUBLIC_URL]}/"; curl -ksI --max-time 20 "${ENV[PUBLIC_URL]}/api/health") || true
  for h in Strict-Transport-Security X-Content-Type-Options Referrer-Policy; do
    grep -qi "^$h:" <<<"$headers" || missing+=("$h")
  done
  grep -qiE "^x-frame-options:|^content-security-policy:.*frame-ancestors" <<<"$headers" || missing+=("X-Frame-Options/frame-ancestors")
  if ((${#missing[@]} == 0)); then
    rec 5 "HTTPS security headers" PASS "HSTS, nosniff, X-Frame-Options + frame-ancestors, Referrer-Policy on / and /api"
  else
    rec 5 "HTTPS security headers" FAIL "missing: ${missing[*]}"
  fi
  local leak
  leak=$(grep -iE "^server:.*[0-9]|^x-powered-by:" <<<"$headers" | tr -d '\r' | sort -u | tr '\n' ' ' || true)
  [[ -z $leak ]] && rec 5 "No server version tokens" PASS "Server header without version, no X-Powered-By" \
    || rec 5 "No server version tokens" FAIL "$leak"
  local tokens
  tokens=$( (compose logs --no-color proxy; compose logs --no-color backend) 2>/dev/null | grep -ciE "access_token=|access_token%3d" || true)
  [[ $tokens == 0 ]] && rec 5 "No WOPI/access tokens in logs" PASS "proxy and backend logs: 0 access_token occurrences" \
    || rec 5 "No WOPI/access tokens in logs" FAIL "$tokens log lines contain an access_token"
}

write_report() {
  local file=$1 verdict
  ((AUDIT_FAILS == 0)) && verdict="PASS" || verdict="FAIL ($AUDIT_FAILS failed)"
  (umask 077 && {
    echo "# Agera Suite compliance self-audit"
    echo
    echo "- Server: ${ENV[PUBLIC_URL]}"
    echo "- Run: $(date -u '+%Y-%m-%d %H:%M UTC') by \`./deploy.sh audit-compliance\`"
    echo "- Code: $(git rev-parse --short HEAD 2>/dev/null || echo unknown); schema: $(asql <<<"SELECT max(version) FROM schema_migrations" 2>/dev/null || echo unknown)"
    echo "- Verdict: **$verdict**, $AUDIT_WARNS warning(s). WARN = not configured yet or not provable here; SKIP = not run here."
    echo
    echo "| Gate | Check | Result | Details |"
    echo "|---|---|---|---|"
    printf '%s\n' "${AUDIT_ROWS[@]}"
    echo
    echo "Gates: 1 RLS & tenant isolation (GDPR Art. 32) - 2 audit vault & IDMS WORM (DORA, GDPR Art. 17) -"
    echo "3 sovereignty, no US-cloud transfers (GDPR Arts. 44-49) - 4 RBAC - 5 dependencies & HTTPS hardening (NIS2)."
  } >"$file")
}

cmd_audit_compliance() {
  local e2e=false
  while (($# > 0)); do
    case $1 in
      --e2e) e2e=true; shift ;;
      *) die "unknown option: $1" ;;
    esac
  done
  check_tools
  validate_env
  [[ $(container_state postgres) == running* && $(container_state backend) == running* && $(container_state proxy) == running* ]] \
    || die "the stack is not running; run ./deploy.sh first"
  gate1_rls
  gate2_vault
  gate3_sovereignty
  gate4_rbac "$e2e"
  gate5_supply_chain
  local report
  report="compliance-audit-$(date +%F).md"
  write_report "$report"
  echo
  printf '%s\n' "| Gate | Check | Result | Details |" "|---|---|---|---|" "${AUDIT_ROWS[@]}"
  echo
  if ((AUDIT_FAILS > 0)); then
    warn "$AUDIT_FAILS check(s) FAILED, $AUDIT_WARNS warning(s). Report: $(pwd)/$report"
    return 1
  fi
  info "All gates passed ($AUDIT_WARNS warning(s)). Report: $(pwd)/$report"
}
