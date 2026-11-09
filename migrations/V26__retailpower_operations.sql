-- V26: RetailPower back-office operations: crew profiles, validated shift hours, fleet with a
-- mandatory four-photo pre-trip check, apparel, RMA cases and stock-protection claims.
-- Every table is tenant-scoped and protected by row-level security for internal staff only.

-- Store coordinates let clock-ins be checked against a geofence around the store.
ALTER TABLE stores
    ADD COLUMN latitude  NUMERIC(9, 6),
    ADD COLUMN longitude NUMERIC(9, 6),
    ADD CONSTRAINT chk_stores_latitude CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
    ADD CONSTRAINT chk_stores_longitude CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180);

CREATE TABLE merchandisers (
    id                    UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id             UUID         NOT NULL REFERENCES tenants (id) ON DELETE RESTRICT,
    user_id               UUID         NOT NULL,
    contract_type         VARCHAR(10)  NOT NULL DEFAULT 'fixed',
    languages             TEXT[]       NOT NULL DEFAULT '{}',
    brand_certifications  TEXT[]       NOT NULL DEFAULT '{}',
    -- ISO weekdays (1 = Monday .. 7 = Sunday) the merchandiser normally works.
    available_days        SMALLINT[]   NOT NULL DEFAULT '{1,2,3,4,5}',
    availability          VARCHAR(12)  NOT NULL DEFAULT 'available',
    home_region           VARCHAR(100),
    phone                 VARCHAR(40),
    notes                 TEXT,
    created_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_merchandisers_tenant_id_id UNIQUE (tenant_id, id),
    CONSTRAINT uq_merchandisers_user UNIQUE (tenant_id, user_id),
    CONSTRAINT fk_merchandisers_user FOREIGN KEY (tenant_id, user_id) REFERENCES users (tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT chk_merchandisers_contract CHECK (contract_type IN ('fixed', 'flex')),
    CONSTRAINT chk_merchandisers_availability CHECK (availability IN ('available', 'busy', 'on_leave', 'inactive')),
    CONSTRAINT chk_merchandisers_days CHECK (available_days <@ ARRAY[1,2,3,4,5,6,7]::SMALLINT[])
);
CREATE TRIGGER trg_merchandisers_updated_at BEFORE UPDATE ON merchandisers FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE shift_logs (
    id                 UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id          UUID           NOT NULL REFERENCES tenants (id) ON DELETE RESTRICT,
    user_id            UUID           NOT NULL,
    store_id           UUID,
    visit_id           UUID,
    clock_in_at        TIMESTAMPTZ    NOT NULL,
    clock_out_at       TIMESTAMPTZ,
    clock_in_lat       NUMERIC(9, 6),
    clock_in_lng       NUMERIC(9, 6),
    clock_out_lat      NUMERIC(9, 6),
    clock_out_lng      NUMERIC(9, 6),
    -- Distance in metres between the clock-in position and the store; NULL when unknown.
    geofence_distance_m INTEGER,
    validation_status  VARCHAR(10)    NOT NULL DEFAULT 'pending',
    validated_by       UUID,
    validated_at       TIMESTAMPTZ,
    rejection_reason   TEXT,
    notes              TEXT,
    created_at         TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_shift_logs_tenant_id_id UNIQUE (tenant_id, id),
    CONSTRAINT fk_shift_logs_user FOREIGN KEY (tenant_id, user_id) REFERENCES users (tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_shift_logs_store FOREIGN KEY (tenant_id, store_id) REFERENCES stores (tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_shift_logs_visit FOREIGN KEY (tenant_id, visit_id) REFERENCES merchandising_visits (tenant_id, id) ON DELETE SET NULL (visit_id),
    CONSTRAINT fk_shift_logs_validator FOREIGN KEY (tenant_id, validated_by) REFERENCES users (tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT chk_shift_logs_status CHECK (validation_status IN ('pending', 'approved', 'rejected')),
    CONSTRAINT chk_shift_logs_order CHECK (clock_out_at IS NULL OR clock_out_at > clock_in_at),
    CONSTRAINT chk_shift_logs_signoff CHECK ((validation_status = 'pending') = (validated_at IS NULL)),
    CONSTRAINT chk_shift_logs_reject_reason CHECK (validation_status <> 'rejected' OR btrim(COALESCE(rejection_reason, '')) <> ''),
    CONSTRAINT chk_shift_logs_lat CHECK (clock_in_lat IS NULL OR clock_in_lat BETWEEN -90 AND 90),
    CONSTRAINT chk_shift_logs_lng CHECK (clock_in_lng IS NULL OR clock_in_lng BETWEEN -180 AND 180)
);
CREATE INDEX idx_shift_logs_user ON shift_logs (tenant_id, user_id, clock_in_at DESC);
CREATE INDEX idx_shift_logs_pending ON shift_logs (tenant_id, clock_in_at) WHERE validation_status = 'pending';
CREATE UNIQUE INDEX uq_shift_logs_open ON shift_logs (tenant_id, user_id) WHERE clock_out_at IS NULL;
CREATE TRIGGER trg_shift_logs_updated_at BEFORE UPDATE ON shift_logs FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- A vehicle allocation becomes active only after all four pre-trip photos (front, back, left, right) are stored.
CREATE TABLE vehicle_allocations (
    id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID         NOT NULL REFERENCES tenants (id) ON DELETE RESTRICT,
    user_id             UUID         NOT NULL,
    vehicle_id          VARCHAR(30)  NOT NULL,
    vehicle_description VARCHAR(150),
    allocated_from      DATE         NOT NULL DEFAULT CURRENT_DATE,
    allocated_until     DATE,
    status              VARCHAR(15)  NOT NULL DEFAULT 'pending_check',
    photo_front_path    VARCHAR(500),
    photo_back_path     VARCHAR(500),
    photo_left_path     VARCHAR(500),
    photo_right_path    VARCHAR(500),
    check_completed_at  TIMESTAMPTZ,
    odometer_km         INTEGER,
    damage_notes        TEXT,
    returned_at         TIMESTAMPTZ,
    created_by          UUID,
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_vehicle_allocations_tenant_id_id UNIQUE (tenant_id, id),
    CONSTRAINT fk_vehicle_allocations_user FOREIGN KEY (tenant_id, user_id) REFERENCES users (tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_vehicle_allocations_creator FOREIGN KEY (tenant_id, created_by) REFERENCES users (tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT chk_vehicle_allocations_status CHECK (status IN ('pending_check', 'active', 'returned')),
    CONSTRAINT chk_vehicle_allocations_vehicle CHECK (btrim(vehicle_id) <> ''),
    CONSTRAINT chk_vehicle_allocations_dates CHECK (allocated_until IS NULL OR allocated_until >= allocated_from),
    CONSTRAINT chk_vehicle_allocations_check CHECK (
        status = 'pending_check' OR (
            photo_front_path IS NOT NULL AND photo_back_path IS NOT NULL AND photo_left_path IS NOT NULL
            AND photo_right_path IS NOT NULL AND check_completed_at IS NOT NULL)),
    CONSTRAINT chk_vehicle_allocations_odometer CHECK (odometer_km IS NULL OR odometer_km >= 0)
);
CREATE UNIQUE INDEX uq_vehicle_allocations_open ON vehicle_allocations (tenant_id, upper(vehicle_id)) WHERE status <> 'returned';
CREATE INDEX idx_vehicle_allocations_user ON vehicle_allocations (tenant_id, user_id);
CREATE TRIGGER trg_vehicle_allocations_updated_at BEFORE UPDATE ON vehicle_allocations FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE apparel_assignments (
    id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID         NOT NULL REFERENCES tenants (id) ON DELETE RESTRICT,
    user_id      UUID         NOT NULL,
    item         VARCHAR(20)  NOT NULL,
    size         VARCHAR(10),
    quantity     INTEGER      NOT NULL DEFAULT 1,
    issued_on    DATE         NOT NULL DEFAULT CURRENT_DATE,
    returned_on  DATE,
    notes        TEXT,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_apparel_assignments_user FOREIGN KEY (tenant_id, user_id) REFERENCES users (tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT chk_apparel_assignments_item CHECK (item IN ('polo', 'jacket', 'trousers', 'cap', 'shoes', 'badge', 'other')),
    CONSTRAINT chk_apparel_assignments_quantity CHECK (quantity BETWEEN 1 AND 100),
    CONSTRAINT chk_apparel_assignments_dates CHECK (returned_on IS NULL OR returned_on >= issued_on)
);
CREATE INDEX idx_apparel_assignments_user ON apparel_assignments (tenant_id, user_id);
CREATE TRIGGER trg_apparel_assignments_updated_at BEFORE UPDATE ON apparel_assignments FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE rma_cases (
    id           UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID          NOT NULL REFERENCES tenants (id) ON DELETE RESTRICT,
    case_number  VARCHAR(20)   NOT NULL,
    store_id     UUID          NOT NULL,
    product_id   UUID,
    client_id    UUID,
    quantity     INTEGER       NOT NULL DEFAULT 1,
    reason       VARCHAR(20)   NOT NULL,
    status       VARCHAR(10)   NOT NULL DEFAULT 'open',
    description  TEXT,
    opened_by    UUID          NOT NULL,
    closed_at    TIMESTAMPTZ,
    created_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_rma_cases_number UNIQUE (tenant_id, case_number),
    CONSTRAINT fk_rma_cases_store FOREIGN KEY (tenant_id, store_id) REFERENCES stores (tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_rma_cases_product FOREIGN KEY (tenant_id, product_id) REFERENCES products (tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_rma_cases_client FOREIGN KEY (tenant_id, client_id) REFERENCES clients (tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_rma_cases_opener FOREIGN KEY (tenant_id, opened_by) REFERENCES users (tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT chk_rma_cases_quantity CHECK (quantity BETWEEN 1 AND 100000),
    CONSTRAINT chk_rma_cases_reason CHECK (reason IN ('damaged', 'defective', 'wrong_delivery', 'expired', 'recall', 'other')),
    CONSTRAINT chk_rma_cases_status CHECK (status IN ('open', 'approved', 'shipped', 'credited', 'rejected')),
    CONSTRAINT chk_rma_cases_closed CHECK ((status IN ('credited', 'rejected')) = (closed_at IS NOT NULL))
);
CREATE INDEX idx_rma_cases_status ON rma_cases (tenant_id, status, created_at DESC);
CREATE TRIGGER trg_rma_cases_updated_at BEFORE UPDATE ON rma_cases FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE stock_protection_claims (
    id            UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID           NOT NULL REFERENCES tenants (id) ON DELETE RESTRICT,
    store_id      UUID           NOT NULL,
    product_id    UUID,
    client_id     UUID,
    claim_type    VARCHAR(20)    NOT NULL,
    quantity      INTEGER        NOT NULL DEFAULT 1,
    amount        NUMERIC(12, 2) NOT NULL DEFAULT 0,
    status        VARCHAR(10)    NOT NULL DEFAULT 'submitted',
    description   TEXT,
    submitted_by  UUID           NOT NULL,
    decided_by    UUID,
    decided_at    TIMESTAMPTZ,
    created_at    TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_stock_claims_store FOREIGN KEY (tenant_id, store_id) REFERENCES stores (tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_stock_claims_product FOREIGN KEY (tenant_id, product_id) REFERENCES products (tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_stock_claims_client FOREIGN KEY (tenant_id, client_id) REFERENCES clients (tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_stock_claims_submitter FOREIGN KEY (tenant_id, submitted_by) REFERENCES users (tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_stock_claims_decider FOREIGN KEY (tenant_id, decided_by) REFERENCES users (tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT chk_stock_claims_type CHECK (claim_type IN ('price_protection', 'damaged', 'expired', 'shrinkage', 'other')),
    CONSTRAINT chk_stock_claims_quantity CHECK (quantity BETWEEN 1 AND 100000),
    CONSTRAINT chk_stock_claims_amount CHECK (amount >= 0),
    CONSTRAINT chk_stock_claims_status CHECK (status IN ('submitted', 'approved', 'rejected', 'paid')),
    CONSTRAINT chk_stock_claims_decision CHECK ((status = 'submitted') = (decided_at IS NULL))
);
CREATE INDEX idx_stock_claims_status ON stock_protection_claims (tenant_id, status, created_at DESC);
CREATE TRIGGER trg_stock_claims_updated_at BEFORE UPDATE ON stock_protection_claims FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DO $$
DECLARE t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY['merchandisers', 'shift_logs', 'vehicle_allocations', 'apparel_assignments', 'rma_cases', 'stock_protection_claims'] LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format(
            'CREATE POLICY tenant_%s_policy ON %I FOR ALL USING (tenant_id = app_current_tenant() AND app_is_internal()) WITH CHECK (tenant_id = app_current_tenant() AND app_is_internal())',
            t, t);
    END LOOP;
END $$;
