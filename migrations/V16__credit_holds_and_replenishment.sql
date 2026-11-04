-- Agera Symphony - V16: emergency credit locks and store-visit → replenishment client rooms (audit §13 G9, G37, G38).

CREATE TABLE credit_holds (
    id          UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID           NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
    client_id   UUID,
    reason      TEXT           NOT NULL,
    set_by      UUID           REFERENCES users (id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
    released_at TIMESTAMPTZ(3),
    released_by UUID           REFERENCES users (id) ON DELETE SET NULL,
    CONSTRAINT fk_credit_holds_client FOREIGN KEY (tenant_id, client_id) REFERENCES clients (tenant_id, id) ON DELETE CASCADE,
    CONSTRAINT chk_credit_holds_reason_not_blank CHECK (btrim(reason) <> '')
);

-- At most one active lock per client, and one organisation-wide lock (client_id IS NULL).
CREATE UNIQUE INDEX uq_credit_holds_active_client ON credit_holds (tenant_id, client_id) WHERE released_at IS NULL AND client_id IS NOT NULL;
CREATE UNIQUE INDEX uq_credit_holds_active_global ON credit_holds (tenant_id) WHERE released_at IS NULL AND client_id IS NULL;

ALTER TABLE credit_holds ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_credit_holds_policy ON credit_holds
    FOR ALL
    USING (tenant_id = app_current_tenant() AND app_is_internal())
    WITH CHECK (tenant_id = app_current_tenant() AND app_is_internal());

-- A client room opened automatically from a store visit report with out-of-stock items (one per visit).
ALTER TABLE digital_sales_rooms ADD COLUMN source_visit_id UUID REFERENCES merchandising_visits (id) ON DELETE SET NULL;
CREATE UNIQUE INDEX uq_digital_sales_rooms_source_visit ON digital_sales_rooms (tenant_id, source_visit_id) WHERE source_visit_id IS NOT NULL;
