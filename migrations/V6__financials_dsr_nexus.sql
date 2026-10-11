-- Agera Symphony - Phase 10 (V6): financial projections & P&L, DSR activity tracking,
-- and Nexus voice events, protected by PostgreSQL row-level security (RLS).
--
-- RLS: every statement against these tables only sees rows whose tenant_id equals the
-- transaction-local setting `app.current_tenant`. The backend sets it per request with
-- `SELECT set_config('app.current_tenant', '<tenant uuid>', true)` inside a transaction,
-- so the value can never leak to another request on a pooled connection. When the setting
-- is absent or empty, the policies match no rows (fail closed).
-- The migration owner bypasses RLS (table owner); the application role does not.

BEGIN;

CREATE OR REPLACE FUNCTION app_current_tenant()
RETURNS UUID
LANGUAGE sql STABLE
AS $$ SELECT NULLIF(current_setting('app.current_tenant', true), '')::UUID $$;

-- Financial models -----------------------------------------------------------------------

CREATE TABLE financial_models (
    id          UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID           NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
    model_name  VARCHAR(100)   NOT NULL,
    fiscal_year INT            NOT NULL,
    status      VARCHAR(30)    NOT NULL DEFAULT 'draft',
    metadata    JSONB          NOT NULL DEFAULT '{}',
    created_at  TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_financial_models_tenant_id_id UNIQUE (tenant_id, id),
    CONSTRAINT chk_financial_models_status CHECK (status IN ('draft', 'approved', 'archived')),
    CONSTRAINT chk_financial_models_fiscal_year CHECK (fiscal_year BETWEEN 2000 AND 2100),
    CONSTRAINT chk_financial_models_name_not_blank CHECK (btrim(model_name) <> ''),
    CONSTRAINT chk_financial_models_metadata_object CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE INDEX idx_financial_models_tenant_year ON financial_models (tenant_id, fiscal_year);

CREATE TRIGGER trg_financial_models_updated_at
    BEFORE UPDATE ON financial_models
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Financial line items ---------------------------------------------------------------------
-- actual_amount stays NULL until actuals are recorded, so variance is NULL (not -projected)
-- for periods without actuals.

CREATE TABLE financial_line_items (
    id               UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        UUID           NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
    model_id         UUID           NOT NULL,
    category         VARCHAR(50)    NOT NULL,
    subcategory      VARCHAR(100),
    period_code      VARCHAR(10)    NOT NULL,
    projected_amount NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
    actual_amount    NUMERIC(15, 2),
    variance         NUMERIC(15, 2) GENERATED ALWAYS AS (actual_amount - projected_amount) STORED,
    currency         VARCHAR(3)     NOT NULL DEFAULT 'EUR',
    created_at       TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_financial_line_items_model FOREIGN KEY (tenant_id, model_id)
        REFERENCES financial_models (tenant_id, id) ON DELETE CASCADE,
    CONSTRAINT chk_financial_line_items_category
        CHECK (category IN ('revenue', 'cogs', 'opex', 'license_fee')),
    CONSTRAINT chk_financial_line_items_period_code
        CHECK (period_code ~ '^[0-9]{4}-(Q[1-4]|0[1-9]|1[0-2])$'),
    CONSTRAINT chk_financial_line_items_currency CHECK (currency ~ '^[A-Z]{3}$')
);

CREATE INDEX idx_financial_line_items_tenant_model_period
    ON financial_line_items (tenant_id, model_id, period_code);

CREATE TRIGGER trg_financial_line_items_updated_at
    BEFORE UPDATE ON financial_line_items
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- DSR activities -----------------------------------------------------------------------------
-- dsr_id identifies a Digital Sales Room; there is no DSR table yet, so it is not a foreign key.

CREATE TABLE dsr_activities (
    id                UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         UUID           NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
    dsr_id            UUID           NOT NULL,
    stakeholder_email VARCHAR(255)   NOT NULL,
    activity_type     VARCHAR(50)    NOT NULL,
    details           JSONB          NOT NULL DEFAULT '{}',
    created_at        TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_dsr_activities_activity_type
        CHECK (activity_type IN ('view', 'download', 'comment', 'terms_accepted', 'terms_rejected')),
    CONSTRAINT chk_dsr_activities_email CHECK (stakeholder_email ~ '^[^@[:space:]]+@[^@[:space:]]+$'),
    CONSTRAINT chk_dsr_activities_details_object CHECK (jsonb_typeof(details) = 'object')
);

CREATE INDEX idx_dsr_activities_tenant_dsr ON dsr_activities (tenant_id, dsr_id, created_at);
CREATE INDEX idx_dsr_activities_tenant_created ON dsr_activities (tenant_id, created_at);

-- Nexus voice events ---------------------------------------------------------------------------
-- audio_payload_url holds the storage key of the clip (e.g. `<tenantId>/voice/<id>.webm`),
-- never a public URL. Clips wait in status 'pending' for the local Whisper worker.

CREATE TABLE nexus_voice_events (
    id                    UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id             UUID           NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
    user_id               UUID           NOT NULL,
    context_route         VARCHAR(255)   NOT NULL,
    audio_payload_url     VARCHAR(500)   NOT NULL,
    audio_mime_type       VARCHAR(100)   NOT NULL,
    audio_size_bytes      BIGINT         NOT NULL,
    status                VARCHAR(30)    NOT NULL DEFAULT 'pending',
    transcript_text       TEXT,
    extracted_action_json JSONB          NOT NULL DEFAULT '{}',
    created_at            TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_nexus_voice_events_user FOREIGN KEY (tenant_id, user_id)
        REFERENCES users (tenant_id, id) ON DELETE CASCADE,
    CONSTRAINT chk_nexus_voice_events_status
        CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    CONSTRAINT chk_nexus_voice_events_size CHECK (audio_size_bytes > 0)
);

CREATE INDEX idx_nexus_voice_events_tenant_created ON nexus_voice_events (tenant_id, created_at);
CREATE INDEX idx_nexus_voice_events_pending ON nexus_voice_events (created_at) WHERE status = 'pending';

CREATE TRIGGER trg_nexus_voice_events_updated_at
    BEFORE UPDATE ON nexus_voice_events
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Row-level security -----------------------------------------------------------------------------

ALTER TABLE financial_models     ENABLE ROW LEVEL SECURITY;
ALTER TABLE financial_line_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE dsr_activities       ENABLE ROW LEVEL SECURITY;
ALTER TABLE nexus_voice_events   ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_financial_models_policy ON financial_models
    FOR ALL USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());

CREATE POLICY tenant_financial_line_items_policy ON financial_line_items
    FOR ALL USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());

CREATE POLICY tenant_dsr_activities_policy ON dsr_activities
    FOR ALL USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());

CREATE POLICY tenant_nexus_voice_events_policy ON nexus_voice_events
    FOR ALL USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());

COMMIT;
