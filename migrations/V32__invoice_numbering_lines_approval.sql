-- V32 (Test 1a round 3): automatic invoice numbers INV-YYYY-XXXX per organisation, invoice lines generated from
-- approved agreements and completed store visits, and invoices as an approval subject.
BEGIN;

CREATE TABLE invoice_sequences (
    tenant_id  UUID    NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
    year       INTEGER NOT NULL,
    last_value INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (tenant_id, year)
);
INSERT INTO invoice_sequences (tenant_id, year, last_value)
SELECT tenant_id, substring(invoice_number FROM 5 FOR 4)::int, MAX(substring(invoice_number FROM 10)::int)
  FROM invoices WHERE invoice_number ~ '^INV-[0-9]{4}-[0-9]{1,9}$'
 GROUP BY tenant_id, substring(invoice_number FROM 5 FOR 4)::int;
ALTER TABLE invoice_sequences ENABLE ROW LEVEL SECURITY;
CREATE POLICY invoice_sequences_tenant_isolation ON invoice_sequences FOR ALL
    USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());

ALTER TABLE invoices ADD COLUMN vat_rate NUMERIC(5, 2);

CREATE TABLE invoice_lines (
    id          UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID           NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
    invoice_id  UUID           NOT NULL,
    position    INTEGER        NOT NULL,
    source_type VARCHAR(20)    NOT NULL,
    source_id   UUID,
    description VARCHAR(255)   NOT NULL,
    quantity    NUMERIC(10, 2) NOT NULL DEFAULT 1,
    unit_price  NUMERIC(14, 2) NOT NULL,
    line_total  NUMERIC(14, 2) NOT NULL,
    created_at  TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_invoice_lines_invoice FOREIGN KEY (invoice_id) REFERENCES invoices (id) ON DELETE CASCADE,
    CONSTRAINT chk_invoice_lines_source CHECK (source_type IN ('agreement', 'store_visit', 'manual')),
    CONSTRAINT chk_invoice_lines_source_id CHECK ((source_type = 'manual') = (source_id IS NULL)),
    CONSTRAINT chk_invoice_lines_amounts CHECK (quantity > 0 AND unit_price >= 0)
);
CREATE INDEX idx_invoice_lines_invoice ON invoice_lines (tenant_id, invoice_id, position);
-- A store visit can be billed once.
CREATE UNIQUE INDEX uq_invoice_lines_store_visit ON invoice_lines (tenant_id, source_id) WHERE source_type = 'store_visit';
ALTER TABLE invoice_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY invoice_lines_tenant_isolation ON invoice_lines FOR ALL
    USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());

-- Lines follow their invoice: frozen once it leaves DRAFT.
CREATE FUNCTION invoice_lines_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    parent_status TEXT;
BEGIN
    SELECT idms_status INTO parent_status FROM invoices WHERE id = COALESCE(NEW.invoice_id, OLD.invoice_id);
    IF parent_status IS NOT NULL AND parent_status <> 'DRAFT' THEN
        RAISE EXCEPTION 'invoice lines are frozen while the invoice is %', parent_status USING ERRCODE = 'P0001';
    END IF;
    RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER trg_invoice_lines_guard BEFORE INSERT OR UPDATE OR DELETE ON invoice_lines
    FOR EACH ROW EXECUTE FUNCTION invoice_lines_guard();

ALTER TABLE approval_requests DROP CONSTRAINT chk_approval_requests_entity;
ALTER TABLE approval_requests ADD CONSTRAINT chk_approval_requests_entity
    CHECK (entity_type IN ('financial_plan', 'agreement', 'invoice'));

-- A rejected or withdrawn invoice approval sends the invoice back from IN_REVIEW to DRAFT (app.idms_reopen = 'on',
-- set by the workflow service for that one transaction). Everything else is unchanged from V28.
CREATE OR REPLACE FUNCTION idms_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  purge   BOOLEAN := coalesce(current_setting('app.idms_purge', true), '') = 'on';
  reopen  BOOLEAN := coalesce(current_setting('app.idms_reopen', true), '') = 'on';
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
    IF reopen AND OLD.idms_status = 'IN_REVIEW' AND NEW.idms_status = 'DRAFT' THEN
      NULL;
    ELSIF idms_rank(NEW.idms_status) IS DISTINCT FROM idms_rank(OLD.idms_status) + 1 THEN
      RAISE EXCEPTION 'IDMS: % cannot move from % to %', TG_TABLE_NAME, OLD.idms_status, NEW.idms_status USING ERRCODE = 'AG409';
    END IF;
    IF NEW.idms_status = 'EXPIRED_PURGE' AND NOT purge THEN
      RAISE EXCEPTION 'IDMS: only the retention job may expire records' USING ERRCODE = 'AG403';
    END IF;
    NEW.idms_changed_at := NOW();
    IF NEW.idms_status = 'ARCHIVED_WORM' THEN NEW.idms_archived_at := NOW(); END IF;
  END IF;

  IF purge AND NEW.idms_status = 'EXPIRED_PURGE' THEN
    RETURN NEW;
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

COMMIT;
