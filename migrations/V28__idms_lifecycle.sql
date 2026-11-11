-- Agera Suite - V28: IDMS lifecycle (Phase 2). One canonical lifecycle on office documents (room_documents), agreements,
-- financial models and invoices, next to their business status:
--   DRAFT -> IN_REVIEW -> FINAL_LOCKED -> ARCHIVED_WORM -> EXPIRED_PURGE   (one step forward at a time)
-- FINAL_LOCKED and ARCHIVED_WORM freeze the content in the database; only the columns named in the trigger argument
-- (business status such as paid/active) stay changeable while FINAL_LOCKED, and nothing but WOPI lock bookkeeping
-- while ARCHIVED_WORM. EXPIRED_PURGE (GDPR Art. 17) is set by the retention job only (app.idms_purge = 'on').
-- Plus per-organisation retention policies for the retention/erasure job.

BEGIN;

CREATE FUNCTION idms_rank(status TEXT) RETURNS INT LANGUAGE sql IMMUTABLE AS $$
  SELECT array_position(ARRAY['DRAFT', 'IN_REVIEW', 'FINAL_LOCKED', 'ARCHIVED_WORM', 'EXPIRED_PURGE'], status)
$$;

CREATE FUNCTION idms_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  purge   BOOLEAN := coalesce(current_setting('app.idms_purge', true), '') = 'on';
  always  TEXT[]  := ARRAY['idms_status', 'idms_changed_at', 'idms_archived_at', 'updated_at', 'lock_token', 'lock_expires_at'];
  allowed TEXT[];
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.idms_status IN ('FINAL_LOCKED', 'ARCHIVED_WORM') THEN
      RAISE EXCEPTION 'IDMS: % record is % and cannot be deleted', TG_TABLE_NAME, OLD.idms_status USING ERRCODE = 'AG403';
    END IF;
    RETURN OLD;
  END IF;

  IF NEW.idms_status IS DISTINCT FROM OLD.idms_status THEN
    IF idms_rank(NEW.idms_status) IS DISTINCT FROM idms_rank(OLD.idms_status) + 1 THEN
      RAISE EXCEPTION 'IDMS: % cannot move from % to %', TG_TABLE_NAME, OLD.idms_status, NEW.idms_status USING ERRCODE = 'AG409';
    END IF;
    IF NEW.idms_status = 'EXPIRED_PURGE' AND NOT purge THEN
      RAISE EXCEPTION 'IDMS: only the retention job may expire records' USING ERRCODE = 'AG403';
    END IF;
    NEW.idms_changed_at := NOW();
    IF NEW.idms_status = 'ARCHIVED_WORM' THEN NEW.idms_archived_at := NOW(); END IF;
  END IF;

  IF purge AND NEW.idms_status = 'EXPIRED_PURGE' THEN
    RETURN NEW; -- the retention job pseudonymises in the same statement
  END IF;
  IF OLD.idms_status = 'EXPIRED_PURGE' THEN
    RAISE EXCEPTION 'IDMS: % record is expired and cannot be changed', TG_TABLE_NAME USING ERRCODE = 'AG403';
  END IF;
  IF OLD.idms_status IN ('FINAL_LOCKED', 'ARCHIVED_WORM') THEN
    allowed := always;
    IF OLD.idms_status = 'FINAL_LOCKED' AND TG_NARGS > 0 THEN
      allowed := allowed || string_to_array(TG_ARGV[0], ',');
    END IF;
    IF (to_jsonb(NEW) - allowed) IS DISTINCT FROM (to_jsonb(OLD) - allowed) THEN
      RAISE EXCEPTION 'IDMS: % record is % and cannot be changed', TG_TABLE_NAME, OLD.idms_status USING ERRCODE = 'AG403';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['room_documents', 'agreements', 'financial_models', 'invoices'] LOOP
    EXECUTE format(
      'ALTER TABLE %I
         ADD COLUMN idms_status      VARCHAR(15)    NOT NULL DEFAULT ''DRAFT'',
         ADD COLUMN idms_changed_at  TIMESTAMPTZ(3),
         ADD COLUMN idms_archived_at TIMESTAMPTZ(3),
         ADD CONSTRAINT chk_%s_idms_status CHECK (idms_status IN (''DRAFT'', ''IN_REVIEW'', ''FINAL_LOCKED'', ''ARCHIVED_WORM'', ''EXPIRED_PURGE'')),
         ADD CONSTRAINT chk_%s_idms_archived CHECK (idms_status NOT IN (''ARCHIVED_WORM'', ''EXPIRED_PURGE'') OR idms_archived_at IS NOT NULL)',
      t, t, t);
    EXECUTE format('CREATE INDEX idx_%s_idms ON %I (tenant_id, idms_status)', t, t);
  END LOOP;
END $$;

-- Starting status for existing records: legally final records are locked, shared documents stay editable (in review).
UPDATE room_documents   SET idms_status = 'IN_REVIEW',    idms_changed_at = NOW() WHERE client_room_id IS NOT NULL;
UPDATE agreements       SET idms_status = 'IN_REVIEW',    idms_changed_at = NOW() WHERE status = 'pending_approval';
UPDATE agreements       SET idms_status = 'FINAL_LOCKED', idms_changed_at = NOW() WHERE status IN ('active', 'expired');
UPDATE financial_models SET idms_status = 'FINAL_LOCKED', idms_changed_at = NOW() WHERE status IN ('approved', 'archived');
UPDATE invoices         SET idms_status = 'FINAL_LOCKED', idms_changed_at = NOW() WHERE status IN ('issued', 'paid', 'cancelled');

CREATE TRIGGER trg_room_documents_idms   BEFORE UPDATE OR DELETE ON room_documents   FOR EACH ROW EXECUTE FUNCTION idms_guard('client_room_id');
CREATE TRIGGER trg_agreements_idms       BEFORE UPDATE OR DELETE ON agreements       FOR EACH ROW EXECUTE FUNCTION idms_guard('status');
CREATE TRIGGER trg_financial_models_idms BEFORE UPDATE OR DELETE ON financial_models FOR EACH ROW EXECUTE FUNCTION idms_guard('status');
CREATE TRIGGER trg_invoices_idms         BEFORE UPDATE OR DELETE ON invoices         FOR EACH ROW EXECUTE FUNCTION idms_guard('status,paid_at');

CREATE TABLE retention_policies (
    id                   UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id            UUID           NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
    document_class       VARCHAR(30)    NOT NULL,
    worm_retention_years INT            NOT NULL DEFAULT 7,
    auto_purge_days      INT,
    erasure_mode         VARCHAR(15)    NOT NULL DEFAULT 'pseudonymize',
    updated_by           UUID           REFERENCES users (id) ON DELETE SET NULL,
    created_at           TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_retention_policies_class UNIQUE (tenant_id, document_class),
    CONSTRAINT chk_retention_policies_class CHECK (document_class IN ('invoice', 'agreement', 'financial_plan', 'office_doc', 'visit_report', 'survey_response')),
    CONSTRAINT chk_retention_policies_years CHECK (worm_retention_years BETWEEN 1 AND 100),
    CONSTRAINT chk_retention_policies_purge CHECK (auto_purge_days IS NULL OR auto_purge_days BETWEEN 1 AND 36500),
    CONSTRAINT chk_retention_policies_mode CHECK (erasure_mode IN ('pseudonymize', 'hard_delete'))
);

CREATE TRIGGER trg_retention_policies_updated_at
    BEFORE UPDATE ON retention_policies
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE retention_policies ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_retention_policies_policy ON retention_policies
    FOR ALL
    USING (tenant_id = app_current_tenant() AND app_is_internal())
    WITH CHECK (tenant_id = app_current_tenant() AND app_is_internal());

COMMIT;
