-- Agera Suite - V33 (Test 1a rounds 4 and 5): store regions, campaign rounds on audit_rounds, rackjobbing checklists,
-- procurement (purchase orders with lines and supplier-invoice matching), plan-line category and 3-party exception owners.

BEGIN;

ALTER TABLE stores ADD COLUMN region VARCHAR(100);

-- A campaign round is an audit round planned for several merchandisers with resource needs (vehicles, POS material, apparel).
ALTER TABLE audit_rounds
    ADD COLUMN round_type       VARCHAR(10) NOT NULL DEFAULT 'audit',
    ADD COLUMN requirements     JSONB       NOT NULL DEFAULT '{}',
    ADD COLUMN merchandiser_ids UUID[]      NOT NULL DEFAULT '{}',
    ADD CONSTRAINT chk_audit_rounds_type CHECK (round_type IN ('audit', 'campaign')),
    ADD CONSTRAINT chk_audit_rounds_requirements CHECK (jsonb_typeof(requirements) = 'object');

ALTER TABLE rma_cases ADD CONSTRAINT uq_rma_cases_tenant_id_id UNIQUE (tenant_id, id);

-- Rackjobbing: per store visit / product instructions (pick-up and drop-off quantities, rotation, price protection) and the result.
CREATE TABLE rackjob_checks (
    id                        UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id                 UUID           NOT NULL REFERENCES tenants (id) ON DELETE RESTRICT,
    store_id                  UUID           NOT NULL,
    product_id                UUID,
    visit_id                  UUID,
    rma_case_id               UUID,
    pickup_qty                INT            NOT NULL DEFAULT 0,
    dropoff_qty               INT            NOT NULL DEFAULT 0,
    rotation_rule             VARCHAR(15)    NOT NULL DEFAULT 'fifo',
    price_protection_eligible BOOLEAN        NOT NULL DEFAULT FALSE,
    instructions              TEXT,
    status                    VARCHAR(10)    NOT NULL DEFAULT 'planned',
    actual_pickup_qty         INT,
    actual_dropoff_qty        INT,
    rotation_done             BOOLEAN,
    result_notes              TEXT,
    completed_by              UUID,
    completed_at              TIMESTAMPTZ(3),
    created_by                UUID           NOT NULL,
    created_at                TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
    updated_at                TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_rackjob_store FOREIGN KEY (tenant_id, store_id) REFERENCES stores (tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_rackjob_product FOREIGN KEY (tenant_id, product_id) REFERENCES products (tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_rackjob_visit FOREIGN KEY (tenant_id, visit_id) REFERENCES merchandising_visits (tenant_id, id) ON DELETE SET NULL (visit_id),
    CONSTRAINT fk_rackjob_rma FOREIGN KEY (tenant_id, rma_case_id) REFERENCES rma_cases (tenant_id, id) ON DELETE SET NULL (rma_case_id),
    CONSTRAINT fk_rackjob_creator FOREIGN KEY (tenant_id, created_by) REFERENCES users (tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_rackjob_completer FOREIGN KEY (tenant_id, completed_by) REFERENCES users (tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT chk_rackjob_qty CHECK (pickup_qty BETWEEN 0 AND 100000 AND dropoff_qty BETWEEN 0 AND 100000),
    CONSTRAINT chk_rackjob_actual_qty CHECK (COALESCE(actual_pickup_qty, 0) BETWEEN 0 AND 100000 AND COALESCE(actual_dropoff_qty, 0) BETWEEN 0 AND 100000),
    CONSTRAINT chk_rackjob_rotation CHECK (rotation_rule IN ('fifo', 'expiry_check', 'none')),
    CONSTRAINT chk_rackjob_status CHECK (status IN ('planned', 'done')),
    CONSTRAINT chk_rackjob_done CHECK ((status = 'done') = (completed_at IS NOT NULL))
);
CREATE INDEX idx_rackjob_checks_status ON rackjob_checks (tenant_id, status, created_at DESC);
CREATE TRIGGER trg_rackjob_checks_updated_at BEFORE UPDATE ON rackjob_checks FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Procurement of operational field costs; a supplier invoice is matched against the order total.
CREATE TABLE purchase_orders (
    id                      UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id               UUID           NOT NULL REFERENCES tenants (id) ON DELETE RESTRICT,
    po_number               VARCHAR(20)    NOT NULL,
    supplier_name           VARCHAR(200)   NOT NULL,
    client_id               UUID,
    audit_round_id          UUID,
    order_date              DATE           NOT NULL DEFAULT CURRENT_DATE,
    status                  VARCHAR(10)    NOT NULL DEFAULT 'open',
    notes                   TEXT,
    supplier_invoice_number VARCHAR(60),
    supplier_invoice_date   DATE,
    supplier_invoice_amount NUMERIC(14,2),
    matched_by              UUID,
    matched_at              TIMESTAMPTZ(3),
    created_by              UUID           NOT NULL,
    created_at              TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_purchase_orders_number UNIQUE (tenant_id, po_number),
    CONSTRAINT uq_purchase_orders_tenant_id_id UNIQUE (tenant_id, id),
    CONSTRAINT fk_purchase_orders_client FOREIGN KEY (tenant_id, client_id) REFERENCES clients (tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_purchase_orders_round FOREIGN KEY (tenant_id, audit_round_id) REFERENCES audit_rounds (tenant_id, id) ON DELETE SET NULL (audit_round_id),
    CONSTRAINT fk_purchase_orders_creator FOREIGN KEY (tenant_id, created_by) REFERENCES users (tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_purchase_orders_matcher FOREIGN KEY (tenant_id, matched_by) REFERENCES users (tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT chk_purchase_orders_status CHECK (status IN ('open', 'matched', 'disputed', 'cancelled')),
    CONSTRAINT chk_purchase_orders_supplier CHECK (btrim(supplier_name) <> ''),
    CONSTRAINT chk_purchase_orders_match CHECK ((status IN ('matched', 'disputed')) = (matched_at IS NOT NULL)),
    CONSTRAINT chk_purchase_orders_invoice_amount CHECK (supplier_invoice_amount IS NULL OR supplier_invoice_amount >= 0)
);
CREATE TRIGGER trg_purchase_orders_updated_at BEFORE UPDATE ON purchase_orders FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE purchase_order_lines (
    id                UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         UUID           NOT NULL REFERENCES tenants (id) ON DELETE RESTRICT,
    purchase_order_id UUID           NOT NULL,
    position          INT            NOT NULL DEFAULT 0,
    category          VARCHAR(15)    NOT NULL,
    description       VARCHAR(200)   NOT NULL,
    quantity          NUMERIC(12,2)  NOT NULL,
    unit_price        NUMERIC(12,2)  NOT NULL,
    line_total        NUMERIC(14,2)  GENERATED ALWAYS AS (round(quantity * unit_price, 2)) STORED,
    billing           VARCHAR(10)    NOT NULL,
    CONSTRAINT fk_po_lines_order FOREIGN KEY (tenant_id, purchase_order_id) REFERENCES purchase_orders (tenant_id, id) ON DELETE CASCADE,
    CONSTRAINT chk_po_lines_category CHECK (category IN ('car_rental', 'apparel', 'pos_material')),
    CONSTRAINT chk_po_lines_billing CHECK (billing IN ('client', 'included')),
    CONSTRAINT chk_po_lines_quantity CHECK (quantity > 0),
    CONSTRAINT chk_po_lines_price CHECK (unit_price >= 0),
    CONSTRAINT chk_po_lines_description CHECK (btrim(description) <> '')
);
CREATE INDEX idx_po_lines_order ON purchase_order_lines (tenant_id, purchase_order_id, position);

DO $$
DECLARE t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY['rackjob_checks', 'purchase_orders', 'purchase_order_lines'] LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format(
            'CREATE POLICY tenant_%s_policy ON %I FOR ALL USING (tenant_id = app_current_tenant() AND app_is_internal()) WITH CHECK (tenant_id = app_current_tenant() AND app_is_internal())',
            t, t);
    END LOOP;
END $$;

-- Recurring baseline revenue versus expansion pipeline.
ALTER TABLE financial_line_items
    ADD COLUMN line_category VARCHAR(20) NOT NULL DEFAULT 'existing_contract',
    ADD CONSTRAINT chk_financial_line_items_line_category CHECK (line_category IN ('existing_contract', 'new_business'));

-- Exceptions: owner_id is the Agera account manager; add the client contact and the responsible Agera executive.
ALTER TABLE exceptions
    ADD COLUMN client_contact_id UUID REFERENCES contacts (id) ON DELETE SET NULL,
    ADD COLUMN executive_id      UUID REFERENCES users (id) ON DELETE SET NULL;

COMMIT;
