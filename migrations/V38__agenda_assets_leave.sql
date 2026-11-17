-- Agera Suite - V38: Agenda bookable rooms/equipment with buffer time (no double booking, enforced by the database)
-- and a leave & vacation register that only shows approved leave on the grid and the team agenda.

BEGIN;

CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE bookable_assets (
    id           UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID           NOT NULL REFERENCES tenants (id) ON DELETE RESTRICT,
    name         VARCHAR(120)   NOT NULL,
    category     VARCHAR(20)    NOT NULL DEFAULT 'meeting_room',
    booking_mode VARCHAR(20)    NOT NULL DEFAULT 'self_service',
    active       BOOLEAN        NOT NULL DEFAULT TRUE,
    notes        VARCHAR(1000),
    created_at   TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_bookable_assets_tenant_id_id UNIQUE (tenant_id, id),
    CONSTRAINT uq_bookable_assets_tenant_name UNIQUE (tenant_id, name),
    CONSTRAINT chk_bookable_assets_name CHECK (btrim(name) <> ''),
    CONSTRAINT chk_bookable_assets_category CHECK (category IN ('meeting_room', 'av_equipment', 'other')),
    CONSTRAINT chk_bookable_assets_mode CHECK (booking_mode IN ('self_service', 'coordinator_only'))
);
CREATE TRIGGER trg_bookable_assets_updated_at BEFORE UPDATE ON bookable_assets FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- One row per asset on an appointment. starts_at/blocked_until copy the appointment period plus the buffer, so the
-- exclusion constraint refuses any overlap for the same asset, buffer included.
CREATE TABLE calendar_event_assets (
    tenant_id      UUID           NOT NULL REFERENCES tenants (id) ON DELETE RESTRICT,
    event_id       UUID           NOT NULL,
    asset_id       UUID           NOT NULL,
    buffer_minutes INTEGER        NOT NULL DEFAULT 0,
    starts_at      TIMESTAMPTZ(3) NOT NULL,
    ends_at        TIMESTAMPTZ(3) NOT NULL,
    blocked_until  TIMESTAMPTZ(3) NOT NULL,
    booked_by      UUID           NOT NULL,
    created_at     TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
    PRIMARY KEY (event_id, asset_id),
    CONSTRAINT fk_calendar_event_assets_event FOREIGN KEY (tenant_id, event_id) REFERENCES calendar_events (tenant_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_calendar_event_assets_asset FOREIGN KEY (tenant_id, asset_id) REFERENCES bookable_assets (tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_calendar_event_assets_user FOREIGN KEY (tenant_id, booked_by) REFERENCES users (tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT chk_calendar_event_assets_buffer CHECK (buffer_minutes IN (0, 15, 30)),
    CONSTRAINT chk_calendar_event_assets_period CHECK (ends_at >= starts_at AND blocked_until >= ends_at),
    CONSTRAINT excl_calendar_event_assets_overlap EXCLUDE USING gist (
        tenant_id WITH =, asset_id WITH =, tstzrange(starts_at, blocked_until, '[)') WITH &&)
);
CREATE INDEX idx_calendar_event_assets_range ON calendar_event_assets (tenant_id, starts_at, blocked_until);

CREATE TABLE leave_requests (
    id          UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID           NOT NULL REFERENCES tenants (id) ON DELETE RESTRICT,
    user_id     UUID           NOT NULL,
    leave_type  VARCHAR(20)    NOT NULL DEFAULT 'vacation',
    start_date  DATE           NOT NULL,
    end_date    DATE           NOT NULL,
    note        VARCHAR(500),
    status      VARCHAR(10)    NOT NULL DEFAULT 'pending',
    decided_by  UUID,
    decided_at  TIMESTAMPTZ(3),
    created_by  UUID           NOT NULL,
    created_at  TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_leave_requests_tenant_id_id UNIQUE (tenant_id, id),
    CONSTRAINT fk_leave_requests_user FOREIGN KEY (tenant_id, user_id) REFERENCES users (tenant_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_leave_requests_decider FOREIGN KEY (tenant_id, decided_by) REFERENCES users (tenant_id, id) ON DELETE SET NULL (decided_by),
    CONSTRAINT fk_leave_requests_creator FOREIGN KEY (tenant_id, created_by) REFERENCES users (tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT chk_leave_requests_type CHECK (leave_type IN ('vacation', 'leave', 'sick', 'other')),
    CONSTRAINT chk_leave_requests_period CHECK (end_date >= start_date AND end_date - start_date <= 366),
    CONSTRAINT chk_leave_requests_status CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled'))
);
CREATE INDEX idx_leave_requests_range ON leave_requests (tenant_id, start_date, end_date);
CREATE TRIGGER trg_leave_requests_updated_at BEFORE UPDATE ON leave_requests FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DO $$
DECLARE t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY['bookable_assets', 'calendar_event_assets', 'leave_requests'] LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format(
            'CREATE POLICY tenant_%s_policy ON %I FOR ALL USING (tenant_id = app_current_tenant() AND app_is_internal()) WITH CHECK (tenant_id = app_current_tenant() AND app_is_internal())',
            t, t);
    END LOOP;
END $$;

-- Standard rooms and equipment for every organisation.
INSERT INTO bookable_assets (tenant_id, name, category, booking_mode)
SELECT t.id, a.name, a.category, a.mode FROM tenants t
CROSS JOIN (VALUES ('Spreekkamer 1', 'meeting_room', 'self_service'), ('Spreekkamer 2', 'meeting_room', 'self_service'),
                   ('Spreekkamer 3', 'meeting_room', 'self_service'), ('50" / 70" TV / Monitor', 'av_equipment', 'coordinator_only')) AS a (name, category, mode)
ON CONFLICT DO NOTHING;

COMMIT;
