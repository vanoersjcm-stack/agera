-- Agera Symphony - V2 work orders (PostgreSQL 16)
-- Timestamps use millisecond precision so values round-trip exactly through JSON
-- and can be passed back as `updated_since` for delta sync.

BEGIN;

-- Targets for composite foreign keys that pin references to the same tenant.
ALTER TABLE users ADD CONSTRAINT uq_users_tenant_id_id UNIQUE (tenant_id, id);

CREATE TABLE work_orders (
    id                UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         UUID           NOT NULL REFERENCES tenants (id) ON DELETE RESTRICT,
    title             VARCHAR(255)   NOT NULL,
    description       TEXT,
    status            VARCHAR(50)    NOT NULL DEFAULT 'PENDING',
    assigned_user_id  UUID,
    created_at        TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
    completed_at      TIMESTAMPTZ(3),
    CONSTRAINT uq_work_orders_tenant_id_id UNIQUE (tenant_id, id),
    CONSTRAINT chk_work_orders_status
        CHECK (status IN ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED')),
    CONSTRAINT chk_work_orders_completed_at
        CHECK ((status = 'COMPLETED') = (completed_at IS NOT NULL)),
    CONSTRAINT fk_work_orders_assigned_user
        FOREIGN KEY (tenant_id, assigned_user_id) REFERENCES users (tenant_id, id)
        ON DELETE SET NULL (assigned_user_id)
);

CREATE INDEX idx_work_orders_tenant_updated ON work_orders (tenant_id, updated_at, id);
CREATE INDEX idx_work_orders_tenant_status ON work_orders (tenant_id, status);
CREATE INDEX idx_work_orders_assigned_user_id ON work_orders (assigned_user_id);

CREATE OR REPLACE FUNCTION set_work_order_timestamps()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    IF NEW.status = 'COMPLETED' AND OLD.status IS DISTINCT FROM 'COMPLETED' THEN
        NEW.completed_at = NOW();
    ELSIF NEW.status <> 'COMPLETED' THEN
        NEW.completed_at = NULL;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_work_orders_timestamps
    BEFORE UPDATE ON work_orders
    FOR EACH ROW EXECUTE FUNCTION set_work_order_timestamps();

CREATE TABLE work_order_logs (
    id                  UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID           NOT NULL REFERENCES tenants (id) ON DELETE RESTRICT,
    work_order_id       UUID           NOT NULL,
    previous_status     VARCHAR(50),
    new_status          VARCHAR(50)    NOT NULL,
    changed_by_user_id  UUID           NOT NULL,
    created_at          TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_work_order_logs_work_order
        FOREIGN KEY (tenant_id, work_order_id) REFERENCES work_orders (tenant_id, id)
        ON DELETE CASCADE,
    CONSTRAINT fk_work_order_logs_changed_by
        FOREIGN KEY (tenant_id, changed_by_user_id) REFERENCES users (tenant_id, id)
        ON DELETE RESTRICT
);

CREATE INDEX idx_work_order_logs_work_order ON work_order_logs (work_order_id, created_at);
CREATE INDEX idx_work_order_logs_tenant_created ON work_order_logs (tenant_id, created_at);
CREATE INDEX idx_work_order_logs_changed_by ON work_order_logs (changed_by_user_id);

COMMIT;
