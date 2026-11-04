-- Agera Symphony - V14: commercial deal pipeline (Vanguard) and mutual action plans in client rooms (audit §13 G26, G31).

CREATE TABLE deals (
    id             UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      UUID           NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
    client_id      UUID           NOT NULL,
    title          VARCHAR(200)   NOT NULL,
    value          NUMERIC(14, 2) NOT NULL DEFAULT 0,
    stage          VARCHAR(30)    NOT NULL DEFAULT 'lead_ingest',
    owner_id       UUID           REFERENCES users (id) ON DELETE SET NULL,
    priority       VARCHAR(10)    NOT NULL DEFAULT 'medium',
    client_room_id UUID           REFERENCES digital_sales_rooms (id) ON DELETE SET NULL,
    due_date       DATE,
    notes          TEXT,
    created_at     TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_deals_tenant_id_id UNIQUE (tenant_id, id),
    CONSTRAINT fk_deals_client FOREIGN KEY (tenant_id, client_id) REFERENCES clients (tenant_id, id) ON DELETE CASCADE,
    CONSTRAINT chk_deals_stage CHECK (stage IN ('lead_ingest', 'proposal_sent', 'contract_negotiation', 'ops_handoff')),
    CONSTRAINT chk_deals_priority CHECK (priority IN ('low', 'medium', 'high')),
    CONSTRAINT chk_deals_value CHECK (value >= 0),
    CONSTRAINT chk_deals_title_not_blank CHECK (btrim(title) <> '')
);

CREATE INDEX idx_deals_tenant_stage ON deals (tenant_id, stage, due_date);
CREATE INDEX idx_deals_tenant_client ON deals (tenant_id, client_id);

CREATE TRIGGER trg_deals_updated_at
    BEFORE UPDATE ON deals
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE deal_stage_changes (
    id          UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID           NOT NULL,
    deal_id     UUID           NOT NULL,
    from_stage  VARCHAR(30),
    to_stage    VARCHAR(30)    NOT NULL,
    changed_by  UUID           REFERENCES users (id) ON DELETE SET NULL,
    changed_at  TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_deal_stage_changes_deal FOREIGN KEY (tenant_id, deal_id) REFERENCES deals (tenant_id, id) ON DELETE CASCADE
);

CREATE INDEX idx_deal_stage_changes_deal ON deal_stage_changes (tenant_id, deal_id, changed_at);

CREATE TABLE client_room_milestones (
    id             UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      UUID           NOT NULL,
    client_room_id UUID           NOT NULL,
    title          VARCHAR(200)   NOT NULL,
    owner_side     VARCHAR(10)    NOT NULL DEFAULT 'internal',
    due_date       DATE,
    completed      BOOLEAN        NOT NULL DEFAULT FALSE,
    completed_at   TIMESTAMPTZ(3),
    completed_by   UUID           REFERENCES users (id) ON DELETE SET NULL,
    created_at     TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_client_room_milestones_room FOREIGN KEY (tenant_id, client_room_id)
        REFERENCES digital_sales_rooms (tenant_id, id) ON DELETE CASCADE,
    CONSTRAINT chk_client_room_milestones_owner_side CHECK (owner_side IN ('internal', 'client')),
    CONSTRAINT chk_client_room_milestones_title_not_blank CHECK (btrim(title) <> ''),
    CONSTRAINT chk_client_room_milestones_completion CHECK (completed = (completed_at IS NOT NULL))
);

CREATE INDEX idx_client_room_milestones_room ON client_room_milestones (tenant_id, client_room_id, due_date);

CREATE TRIGGER trg_client_room_milestones_updated_at
    BEFORE UPDATE ON client_room_milestones
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE deals                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE deal_stage_changes     ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_room_milestones ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_deals_policy ON deals
    FOR ALL
    USING (tenant_id = app_current_tenant() AND app_is_internal())
    WITH CHECK (tenant_id = app_current_tenant() AND app_is_internal());

CREATE POLICY tenant_deal_stage_changes_policy ON deal_stage_changes
    FOR ALL
    USING (tenant_id = app_current_tenant() AND app_is_internal())
    WITH CHECK (tenant_id = app_current_tenant() AND app_is_internal());

CREATE POLICY tenant_client_room_milestones_policy ON client_room_milestones
    FOR ALL
    USING (tenant_id = app_current_tenant() AND app_is_internal())
    WITH CHECK (tenant_id = app_current_tenant() AND app_is_internal());

-- Client contacts see the action plan of their own active rooms and may tick off client-side milestones.
CREATE POLICY client_client_room_milestones_read_policy ON client_room_milestones
    FOR SELECT
    USING (
        tenant_id = app_current_tenant()
        AND EXISTS (
            SELECT 1 FROM digital_sales_rooms d
             WHERE d.tenant_id = client_room_milestones.tenant_id AND d.id = client_room_milestones.client_room_id
               AND d.status = 'active' AND app_is_external_client(d.client_id)
        )
    );

CREATE POLICY client_client_room_milestones_update_policy ON client_room_milestones
    FOR UPDATE
    USING (
        tenant_id = app_current_tenant() AND owner_side = 'client'
        AND EXISTS (
            SELECT 1 FROM digital_sales_rooms d
             WHERE d.tenant_id = client_room_milestones.tenant_id AND d.id = client_room_milestones.client_room_id
               AND d.status = 'active' AND app_is_external_client(d.client_id)
        )
    )
    WITH CHECK (tenant_id = app_current_tenant() AND owner_side = 'client');
