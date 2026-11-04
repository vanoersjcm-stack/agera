-- Agera Symphony - V21: price lists per client (audit G22) and document templates for client rooms (G15).

CREATE TABLE price_lists (
    id          UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID           NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
    name        VARCHAR(200)   NOT NULL,
    client_id   UUID,
    valid_from  DATE,
    valid_to    DATE,
    active      BOOLEAN        NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_price_lists_tenant_id_id UNIQUE (tenant_id, id),
    CONSTRAINT fk_price_lists_client FOREIGN KEY (tenant_id, client_id) REFERENCES clients (tenant_id, id) ON DELETE CASCADE,
    CONSTRAINT chk_price_lists_name_not_blank CHECK (btrim(name) <> ''),
    CONSTRAINT chk_price_lists_validity CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from)
);
CREATE TRIGGER trg_price_lists_updated_at BEFORE UPDATE ON price_lists FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE price_list_items (
    id            UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID           NOT NULL,
    price_list_id UUID           NOT NULL,
    product_id    UUID           NOT NULL,
    unit_price    NUMERIC(12, 2) NOT NULL,
    min_quantity  INT            NOT NULL DEFAULT 1,
    CONSTRAINT fk_price_list_items_list FOREIGN KEY (tenant_id, price_list_id) REFERENCES price_lists (tenant_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_price_list_items_product FOREIGN KEY (tenant_id, product_id) REFERENCES products (tenant_id, id) ON DELETE CASCADE,
    CONSTRAINT uq_price_list_items UNIQUE (price_list_id, product_id, min_quantity),
    CONSTRAINT chk_price_list_items_price CHECK (unit_price >= 0),
    CONSTRAINT chk_price_list_items_qty CHECK (min_quantity >= 1)
);

CREATE TABLE document_templates (
    id          UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID           NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
    name        VARCHAR(200)   NOT NULL,
    kind        VARCHAR(20)    NOT NULL DEFAULT 'letter',
    body        TEXT           NOT NULL,
    active      BOOLEAN        NOT NULL DEFAULT TRUE,
    created_by  UUID           REFERENCES users (id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_document_templates_kind CHECK (kind IN ('proposal', 'agreement', 'letter', 'mail')),
    CONSTRAINT chk_document_templates_name_not_blank CHECK (btrim(name) <> '' AND btrim(body) <> '')
);
CREATE TRIGGER trg_document_templates_updated_at BEFORE UPDATE ON document_templates FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DO $$
DECLARE t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY['price_lists', 'price_list_items', 'document_templates'] LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format(
            'CREATE POLICY tenant_%s_policy ON %I FOR ALL USING (tenant_id = app_current_tenant() AND app_is_internal()) WITH CHECK (tenant_id = app_current_tenant() AND app_is_internal())',
            t, t);
    END LOOP;
END $$;
