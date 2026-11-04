-- Agera Symphony - V19: product catalogue, planograms, field orders and audit rounds (audit G35/G37/G40/B9).

CREATE TABLE products (
    id          UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID           NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
    sku         VARCHAR(60)    NOT NULL,
    name        VARCHAR(200)   NOT NULL,
    brand       VARCHAR(100),
    category    VARCHAR(100),
    unit_price  NUMERIC(12, 2) NOT NULL DEFAULT 0,
    active      BOOLEAN        NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_products_tenant_id_id UNIQUE (tenant_id, id),
    CONSTRAINT uq_products_tenant_sku UNIQUE (tenant_id, sku),
    CONSTRAINT chk_products_name_not_blank CHECK (btrim(name) <> '' AND btrim(sku) <> ''),
    CONSTRAINT chk_products_price CHECK (unit_price >= 0)
);
CREATE TRIGGER trg_products_updated_at BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE planograms (
    id          UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID           NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
    name        VARCHAR(200)   NOT NULL,
    category    VARCHAR(100),
    store_id    UUID,
    active      BOOLEAN        NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_planograms_tenant_id_id UNIQUE (tenant_id, id),
    CONSTRAINT fk_planograms_store FOREIGN KEY (tenant_id, store_id) REFERENCES stores (tenant_id, id) ON DELETE CASCADE,
    CONSTRAINT chk_planograms_name_not_blank CHECK (btrim(name) <> '')
);
CREATE TRIGGER trg_planograms_updated_at BEFORE UPDATE ON planograms FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE planogram_items (
    id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        UUID         NOT NULL,
    planogram_id     UUID         NOT NULL,
    product_id       UUID         NOT NULL,
    expected_facings INT          NOT NULL DEFAULT 1,
    shelf            VARCHAR(50),
    position         INT          NOT NULL DEFAULT 0,
    CONSTRAINT fk_planogram_items_planogram FOREIGN KEY (tenant_id, planogram_id) REFERENCES planograms (tenant_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_planogram_items_product FOREIGN KEY (tenant_id, product_id) REFERENCES products (tenant_id, id) ON DELETE CASCADE,
    CONSTRAINT uq_planogram_items UNIQUE (planogram_id, product_id),
    CONSTRAINT chk_planogram_items_facings CHECK (expected_facings BETWEEN 1 AND 999)
);

CREATE TABLE field_orders (
    id           UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID           NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
    store_id     UUID           NOT NULL,
    visit_id     UUID,
    status       VARCHAR(20)    NOT NULL DEFAULT 'draft',
    notes        TEXT,
    created_by   UUID           REFERENCES users (id) ON DELETE SET NULL,
    submitted_at TIMESTAMPTZ(3),
    created_at   TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_field_orders_tenant_id_id UNIQUE (tenant_id, id),
    CONSTRAINT fk_field_orders_store FOREIGN KEY (tenant_id, store_id) REFERENCES stores (tenant_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_field_orders_visit FOREIGN KEY (tenant_id, visit_id) REFERENCES merchandising_visits (tenant_id, id) ON DELETE SET NULL (visit_id),
    CONSTRAINT chk_field_orders_status CHECK (status IN ('draft', 'submitted', 'confirmed', 'delivered', 'cancelled'))
);
CREATE INDEX idx_field_orders_tenant_status ON field_orders (tenant_id, status, created_at DESC);
CREATE TRIGGER trg_field_orders_updated_at BEFORE UPDATE ON field_orders FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE field_order_lines (
    id          UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID           NOT NULL,
    order_id    UUID           NOT NULL,
    product_id  UUID           NOT NULL,
    quantity    INT            NOT NULL,
    unit_price  NUMERIC(12, 2) NOT NULL,
    CONSTRAINT fk_field_order_lines_order FOREIGN KEY (tenant_id, order_id) REFERENCES field_orders (tenant_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_field_order_lines_product FOREIGN KEY (tenant_id, product_id) REFERENCES products (tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT uq_field_order_lines UNIQUE (order_id, product_id),
    CONSTRAINT chk_field_order_lines_quantity CHECK (quantity BETWEEN 1 AND 100000),
    CONSTRAINT chk_field_order_lines_price CHECK (unit_price >= 0)
);

CREATE TABLE audit_rounds (
    id          UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID           NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
    name        VARCHAR(200)   NOT NULL,
    checklist   JSONB          NOT NULL DEFAULT '[]',
    due_date    DATE,
    status      VARCHAR(10)    NOT NULL DEFAULT 'open',
    created_by  UUID           REFERENCES users (id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_audit_rounds_tenant_id_id UNIQUE (tenant_id, id),
    CONSTRAINT chk_audit_rounds_status CHECK (status IN ('open', 'closed')),
    CONSTRAINT chk_audit_rounds_checklist CHECK (jsonb_typeof(checklist) = 'array'),
    CONSTRAINT chk_audit_rounds_name_not_blank CHECK (btrim(name) <> '')
);
CREATE TRIGGER trg_audit_rounds_updated_at BEFORE UPDATE ON audit_rounds FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE merchandising_visits ADD COLUMN audit_round_id UUID;
ALTER TABLE merchandising_visits ADD CONSTRAINT fk_merchandising_visits_audit_round
    FOREIGN KEY (tenant_id, audit_round_id) REFERENCES audit_rounds (tenant_id, id) ON DELETE SET NULL (audit_round_id);
CREATE INDEX idx_merchandising_visits_audit_round ON merchandising_visits (tenant_id, audit_round_id) WHERE audit_round_id IS NOT NULL;

DO $$
DECLARE t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY['products', 'planograms', 'planogram_items', 'field_orders', 'field_order_lines', 'audit_rounds'] LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format(
            'CREATE POLICY tenant_%s_policy ON %I FOR ALL USING (tenant_id = app_current_tenant() AND app_is_internal()) WITH CHECK (tenant_id = app_current_tenant() AND app_is_internal())',
            t, t);
    END LOOP;
END $$;
