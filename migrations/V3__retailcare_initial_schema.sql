-- Agera Symphony - V3 RetailCare base schema (PostgreSQL 16)
-- Same conventions as V2: millisecond timestamps for delta sync, composite (tenant_id, ...)
-- foreign keys so no row can reference another tenant's store, user or work order.

BEGIN;

CREATE TABLE stores (
    id           UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID           NOT NULL REFERENCES tenants (id) ON DELETE RESTRICT,
    store_code   VARCHAR(50)    NOT NULL,
    name         VARCHAR(200)   NOT NULL,
    address      VARCHAR(255),
    city         VARCHAR(100),
    postal_code  VARCHAR(20),
    country      VARCHAR(100)   DEFAULT 'ES',
    created_at   TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_stores_tenant_store_code UNIQUE (tenant_id, store_code),
    CONSTRAINT uq_stores_tenant_id_id UNIQUE (tenant_id, id)
);

CREATE INDEX idx_stores_tenant_updated ON stores (tenant_id, updated_at, id);

CREATE TRIGGER trg_stores_updated_at
    BEFORE UPDATE ON stores
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE merchandising_visits (
    id             UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      UUID           NOT NULL REFERENCES tenants (id) ON DELETE RESTRICT,
    store_id       UUID           NOT NULL,
    field_rep_id   UUID           NOT NULL,
    work_order_id  UUID,
    visit_date     TIMESTAMPTZ(3) NOT NULL,
    notes          TEXT,
    status         VARCHAR(50)    NOT NULL DEFAULT 'PLANNED',
    created_at     TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_merchandising_visits_status
        CHECK (status IN ('PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED')),
    CONSTRAINT fk_merchandising_visits_store
        FOREIGN KEY (tenant_id, store_id) REFERENCES stores (tenant_id, id)
        ON DELETE RESTRICT,
    CONSTRAINT fk_merchandising_visits_field_rep
        FOREIGN KEY (tenant_id, field_rep_id) REFERENCES users (tenant_id, id)
        ON DELETE RESTRICT,
    CONSTRAINT fk_merchandising_visits_work_order
        FOREIGN KEY (tenant_id, work_order_id) REFERENCES work_orders (tenant_id, id)
        ON DELETE SET NULL (work_order_id)
);

CREATE INDEX idx_merchandising_visits_tenant_updated ON merchandising_visits (tenant_id, updated_at, id);
CREATE INDEX idx_merchandising_visits_store_date ON merchandising_visits (tenant_id, store_id, visit_date);
CREATE INDEX idx_merchandising_visits_field_rep ON merchandising_visits (field_rep_id, visit_date);
CREATE INDEX idx_merchandising_visits_work_order ON merchandising_visits (work_order_id);

CREATE TRIGGER trg_merchandising_visits_updated_at
    BEFORE UPDATE ON merchandising_visits
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
