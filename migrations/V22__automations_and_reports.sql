-- Agera Symphony - V22: automation engine (audit G41) and saved custom reports (G42).
-- Vanguard: max 5 active linear automations (1 trigger -> 1 condition -> 1 action); Symphony: multi-step, branching and delays.

CREATE TABLE automations (
    id           UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID           NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
    name         VARCHAR(200)   NOT NULL,
    trigger      VARCHAR(100)   NOT NULL,
    steps        JSONB          NOT NULL,
    active       BOOLEAN        NOT NULL DEFAULT TRUE,
    run_count    INT            NOT NULL DEFAULT 0,
    last_run_at  TIMESTAMPTZ(3),
    created_by   UUID           REFERENCES users (id) ON DELETE SET NULL,
    created_at   TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_automations_tenant_id_id UNIQUE (tenant_id, id),
    CONSTRAINT chk_automations_name_not_blank CHECK (btrim(name) <> ''),
    CONSTRAINT chk_automations_steps CHECK (jsonb_typeof(steps) = 'array' AND jsonb_array_length(steps) BETWEEN 1 AND 10)
);
CREATE INDEX idx_automations_trigger ON automations (tenant_id, trigger) WHERE active;
CREATE TRIGGER trg_automations_updated_at BEFORE UPDATE ON automations FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE automation_runs (
    id            UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID           NOT NULL,
    automation_id UUID           NOT NULL,
    step_index    INT            NOT NULL,
    status        VARCHAR(20)    NOT NULL,
    run_at        TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
    event         JSONB          NOT NULL,
    detail        TEXT,
    created_at    TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_automation_runs_automation FOREIGN KEY (tenant_id, automation_id) REFERENCES automations (tenant_id, id) ON DELETE CASCADE,
    CONSTRAINT chk_automation_runs_status CHECK (status IN ('scheduled', 'done', 'skipped', 'failed'))
);
CREATE INDEX idx_automation_runs_automation ON automation_runs (automation_id, created_at DESC);
CREATE INDEX idx_automation_runs_due ON automation_runs (run_at) WHERE status = 'scheduled';

CREATE TABLE saved_reports (
    id          UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID           NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
    name        VARCHAR(200)   NOT NULL,
    definition  JSONB          NOT NULL,
    pinned      BOOLEAN        NOT NULL DEFAULT FALSE,
    created_by  UUID           REFERENCES users (id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_saved_reports_name_not_blank CHECK (btrim(name) <> '')
);
CREATE TRIGGER trg_saved_reports_updated_at BEFORE UPDATE ON saved_reports FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DO $$
DECLARE t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY['automations', 'automation_runs', 'saved_reports'] LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format(
            'CREATE POLICY tenant_%s_policy ON %I FOR ALL USING (tenant_id = app_current_tenant() AND app_is_internal()) WITH CHECK (tenant_id = app_current_tenant() AND app_is_internal())',
            t, t);
    END LOOP;
END $$;
