-- Agera Symphony - V20: multi-step approval chains (B5), manual exceptions (B8) and in-app notifications (B7).

CREATE TABLE approval_requests (
    id           UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID           NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
    entity_type  VARCHAR(20)    NOT NULL,
    entity_id    UUID           NOT NULL,
    entity_label VARCHAR(250)   NOT NULL,
    note         TEXT,
    status       VARCHAR(10)    NOT NULL DEFAULT 'pending',
    requested_by UUID           REFERENCES users (id) ON DELETE SET NULL,
    created_at   TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
    decided_at   TIMESTAMPTZ(3),
    CONSTRAINT uq_approval_requests_tenant_id_id UNIQUE (tenant_id, id),
    CONSTRAINT chk_approval_requests_entity CHECK (entity_type IN ('financial_plan', 'agreement')),
    CONSTRAINT chk_approval_requests_status CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled'))
);
CREATE UNIQUE INDEX uq_approval_requests_pending ON approval_requests (tenant_id, entity_type, entity_id) WHERE status = 'pending';

CREATE TABLE approval_steps (
    id          UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID           NOT NULL,
    request_id  UUID           NOT NULL,
    step_order  INT            NOT NULL,
    approver_id UUID           NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    decision    VARCHAR(10)    NOT NULL DEFAULT 'pending',
    comment     TEXT,
    decided_at  TIMESTAMPTZ(3),
    CONSTRAINT fk_approval_steps_request FOREIGN KEY (tenant_id, request_id) REFERENCES approval_requests (tenant_id, id) ON DELETE CASCADE,
    CONSTRAINT uq_approval_steps_order UNIQUE (request_id, step_order),
    CONSTRAINT chk_approval_steps_decision CHECK (decision IN ('pending', 'approved', 'rejected'))
);

CREATE TABLE exceptions (
    id          UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID           NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
    title       VARCHAR(200)   NOT NULL,
    description TEXT,
    severity    VARCHAR(10)    NOT NULL DEFAULT 'medium',
    status      VARCHAR(15)    NOT NULL DEFAULT 'open',
    owner_id    UUID           REFERENCES users (id) ON DELETE SET NULL,
    store_id    UUID,
    client_id   UUID,
    source      VARCHAR(200),
    resolution  TEXT,
    created_by  UUID           REFERENCES users (id) ON DELETE SET NULL,
    resolved_at TIMESTAMPTZ(3),
    created_at  TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_exceptions_store FOREIGN KEY (tenant_id, store_id) REFERENCES stores (tenant_id, id) ON DELETE SET NULL (store_id),
    CONSTRAINT fk_exceptions_client FOREIGN KEY (tenant_id, client_id) REFERENCES clients (tenant_id, id) ON DELETE SET NULL (client_id),
    CONSTRAINT chk_exceptions_severity CHECK (severity IN ('low', 'medium', 'high')),
    CONSTRAINT chk_exceptions_status CHECK (status IN ('open', 'in_progress', 'resolved')),
    CONSTRAINT chk_exceptions_resolution CHECK (status <> 'resolved' OR (resolution IS NOT NULL AND btrim(resolution) <> '')),
    CONSTRAINT chk_exceptions_title_not_blank CHECK (btrim(title) <> '')
);
CREATE INDEX idx_exceptions_tenant_status ON exceptions (tenant_id, status, severity);
CREATE TRIGGER trg_exceptions_updated_at BEFORE UPDATE ON exceptions FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE notifications (
    id         UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id  UUID           NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
    user_id    UUID           NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    title      VARCHAR(250)   NOT NULL,
    body       TEXT,
    link       VARCHAR(300),
    read_at    TIMESTAMPTZ(3),
    created_at TIMESTAMPTZ(3) NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_notifications_user ON notifications (tenant_id, user_id, created_at DESC);

DO $$
DECLARE t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY['approval_requests', 'approval_steps', 'exceptions', 'notifications'] LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format(
            'CREATE POLICY tenant_%s_policy ON %I FOR ALL USING (tenant_id = app_current_tenant() AND app_is_internal()) WITH CHECK (tenant_id = app_current_tenant() AND app_is_internal())',
            t, t);
    END LOOP;
END $$;
