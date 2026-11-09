-- V25: database-level tenant isolation for the older core tables, and an append-only, hash-chained audit log.
-- Rows are visible only when tenant_id matches app.current_tenant (set per transaction by the backend).
-- api_keys are additionally readable in the 'system' access scope, because keys are looked up before
-- the tenant is known and are managed by platform admins across organisations.

BEGIN;

CREATE OR REPLACE FUNCTION app_is_system()
RETURNS BOOLEAN
LANGUAGE sql STABLE
AS $$ SELECT COALESCE(app_access_scope() = 'system', false) $$;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['stores', 'merchandising_visits', 'visit_reports', 'visit_media', 'work_orders', 'work_order_logs', 'users', 'audit_logs'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_tenant_isolation', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant())',
      t || '_tenant_isolation', t);
  END LOOP;
END $$;

ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS api_keys_tenant_isolation ON api_keys;
CREATE POLICY api_keys_tenant_isolation ON api_keys FOR ALL
  USING (tenant_id = app_current_tenant() OR app_is_system())
  WITH CHECK (tenant_id = app_current_tenant() OR app_is_system());

-- Audit vault ------------------------------------------------------------------------------------
-- Each row carries the SHA-256 of its own content plus the previous row's hash (chain per tenant).
-- seq gives the chain order; it is assigned by the trigger under a per-tenant lock.

CREATE SEQUENCE IF NOT EXISTS audit_logs_seq_seq;
ALTER TABLE audit_logs
  ADD COLUMN IF NOT EXISTS seq BIGINT,
  ADD COLUMN IF NOT EXISTS prev_hash CHAR(64),
  ADD COLUMN IF NOT EXISTS row_hash CHAR(64);

UPDATE audit_logs a SET seq = o.rn
  FROM (SELECT id, row_number() OVER (ORDER BY created_at, id) AS rn FROM audit_logs) o
 WHERE a.id = o.id AND a.seq IS NULL;
SELECT setval('audit_logs_seq_seq', COALESCE((SELECT max(seq) FROM audit_logs), 0) + 1, false);
ALTER SEQUENCE audit_logs_seq_seq OWNED BY audit_logs.seq;
ALTER TABLE audit_logs ALTER COLUMN seq SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_audit_logs_seq ON audit_logs (seq);
CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant_seq ON audit_logs (tenant_id, seq DESC);

CREATE OR REPLACE FUNCTION app_audit_row_hash(prev TEXT, r audit_logs)
RETURNS CHAR(64)
LANGUAGE sql IMMUTABLE
AS $$
  SELECT encode(sha256(convert_to(concat_ws('|',
    COALESCE(prev, ''), r.seq::text, r.id::text, r.tenant_id::text, COALESCE(r.user_id::text, ''), r.action,
    COALESCE(r.details::text, ''), to_char(r.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US')), 'UTF8')), 'hex')
$$;

DO $$
DECLARE r audit_logs; prev TEXT; cur UUID;
BEGIN
  FOR r IN SELECT * FROM audit_logs ORDER BY tenant_id, seq LOOP
    IF cur IS DISTINCT FROM r.tenant_id THEN prev := NULL; cur := r.tenant_id; END IF;
    UPDATE audit_logs SET prev_hash = prev, row_hash = app_audit_row_hash(prev, r) WHERE id = r.id RETURNING row_hash INTO prev;
  END LOOP;
END $$;

ALTER TABLE audit_logs ALTER COLUMN row_hash SET NOT NULL;

CREATE OR REPLACE FUNCTION app_audit_chain()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE prev TEXT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('audit_logs:' || NEW.tenant_id::text));
  NEW.seq := nextval('audit_logs_seq_seq');
  SELECT row_hash INTO prev FROM audit_logs WHERE tenant_id = NEW.tenant_id ORDER BY seq DESC LIMIT 1;
  NEW.prev_hash := prev;
  NEW.row_hash := app_audit_row_hash(prev, NEW);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS audit_logs_chain ON audit_logs;
CREATE TRIGGER audit_logs_chain BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION app_audit_chain();
-- Also fires in replica mode (bulk demo seeding), so every row is always chained.
ALTER TABLE audit_logs ENABLE ALWAYS TRIGGER audit_logs_chain;

CREATE OR REPLACE FUNCTION app_audit_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$ BEGIN RAISE EXCEPTION 'audit_logs is append-only' USING ERRCODE = 'insufficient_privilege'; END $$;

DROP TRIGGER IF EXISTS audit_logs_no_update ON audit_logs;
CREATE TRIGGER audit_logs_no_update BEFORE UPDATE OR DELETE ON audit_logs FOR EACH ROW EXECUTE FUNCTION app_audit_immutable();
DROP TRIGGER IF EXISTS audit_logs_no_truncate ON audit_logs;
CREATE TRIGGER audit_logs_no_truncate BEFORE TRUNCATE ON audit_logs FOR EACH STATEMENT EXECUTE FUNCTION app_audit_immutable();

-- Users are deactivated, never deleted; SET NULL would rewrite (and break) chained rows.
DO $$
DECLARE c TEXT;
BEGIN
  SELECT conname INTO c FROM pg_constraint
   WHERE conrelid = 'audit_logs'::regclass AND contype = 'f' AND conkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = 'audit_logs'::regclass AND attname = 'user_id')];
  IF c IS NOT NULL THEN EXECUTE format('ALTER TABLE audit_logs DROP CONSTRAINT %I', c); END IF;
  ALTER TABLE audit_logs ADD CONSTRAINT audit_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT;
END $$;

-- Only the owner (migrations) keeps UPDATE/DELETE; every other role may only read and insert.
DO $$
DECLARE g TEXT;
BEGIN
  FOR g IN SELECT DISTINCT grantee FROM information_schema.role_table_grants
            WHERE table_name = 'audit_logs' AND grantee NOT IN (current_user, 'PUBLIC')
              AND grantee <> (SELECT tableowner FROM pg_tables WHERE tablename = 'audit_logs' AND schemaname = 'public') LOOP
    EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs FROM %I', g);
  END LOOP;
END $$;

-- Verifies the active tenant's chain: rows checked, first broken seq (NULL when intact) and the head hash.
CREATE OR REPLACE FUNCTION app_verify_audit_chain()
RETURNS TABLE (checked BIGINT, first_broken_seq BIGINT, head_hash TEXT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE r audit_logs; prev TEXT; n BIGINT := 0; broken BIGINT; t UUID := app_current_tenant();
BEGIN
  IF t IS NULL THEN RAISE EXCEPTION 'app.current_tenant is not set'; END IF;
  FOR r IN SELECT * FROM audit_logs WHERE tenant_id = t ORDER BY seq LOOP
    n := n + 1;
    IF broken IS NULL AND (r.prev_hash IS DISTINCT FROM prev OR r.row_hash IS DISTINCT FROM app_audit_row_hash(prev, r)) THEN
      broken := r.seq;
    END IF;
    prev := r.row_hash;
  END LOOP;
  RETURN QUERY SELECT n, broken, prev;
END $$;

COMMIT;
