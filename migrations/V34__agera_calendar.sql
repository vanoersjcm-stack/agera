-- Agera Suite - V34: Agera Calendar. Appointments live in Agera itself (no external calendar server); the calendar API
-- also shows store visits, campaign/audit rounds and client-room milestones from their own tables.

BEGIN;

CREATE TABLE calendar_events (
    id          UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID           NOT NULL REFERENCES tenants (id) ON DELETE RESTRICT,
    title       VARCHAR(200)   NOT NULL,
    description TEXT,
    location    VARCHAR(200),
    starts_at   TIMESTAMPTZ(3) NOT NULL,
    ends_at     TIMESTAMPTZ(3) NOT NULL,
    all_day     BOOLEAN        NOT NULL DEFAULT FALSE,
    visibility  VARCHAR(10)    NOT NULL DEFAULT 'team',
    status      VARCHAR(10)    NOT NULL DEFAULT 'scheduled',
    client_id   UUID,
    store_id    UUID,
    created_by  UUID           NOT NULL,
    created_at  TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_calendar_events_tenant_id_id UNIQUE (tenant_id, id),
    CONSTRAINT fk_calendar_events_client FOREIGN KEY (tenant_id, client_id) REFERENCES clients (tenant_id, id) ON DELETE SET NULL (client_id),
    CONSTRAINT fk_calendar_events_store FOREIGN KEY (tenant_id, store_id) REFERENCES stores (tenant_id, id) ON DELETE SET NULL (store_id),
    CONSTRAINT fk_calendar_events_creator FOREIGN KEY (tenant_id, created_by) REFERENCES users (tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT chk_calendar_events_title CHECK (btrim(title) <> ''),
    CONSTRAINT chk_calendar_events_order CHECK (ends_at >= starts_at),
    CONSTRAINT chk_calendar_events_visibility CHECK (visibility IN ('team', 'private')),
    CONSTRAINT chk_calendar_events_status CHECK (status IN ('scheduled', 'cancelled'))
);
CREATE INDEX idx_calendar_events_range ON calendar_events (tenant_id, starts_at, ends_at);
CREATE TRIGGER trg_calendar_events_updated_at BEFORE UPDATE ON calendar_events FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE calendar_event_attendees (
    tenant_id  UUID           NOT NULL REFERENCES tenants (id) ON DELETE RESTRICT,
    event_id   UUID           NOT NULL,
    user_id    UUID           NOT NULL,
    response   VARCHAR(10)    NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
    PRIMARY KEY (event_id, user_id),
    CONSTRAINT fk_calendar_attendees_event FOREIGN KEY (tenant_id, event_id) REFERENCES calendar_events (tenant_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_calendar_attendees_user FOREIGN KEY (tenant_id, user_id) REFERENCES users (tenant_id, id) ON DELETE CASCADE,
    CONSTRAINT chk_calendar_attendees_response CHECK (response IN ('pending', 'accepted', 'declined'))
);
CREATE INDEX idx_calendar_attendees_user ON calendar_event_attendees (tenant_id, user_id);

DO $$
DECLARE t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY['calendar_events', 'calendar_event_attendees'] LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format(
            'CREATE POLICY tenant_%s_policy ON %I FOR ALL USING (tenant_id = app_current_tenant() AND app_is_internal()) WITH CHECK (tenant_id = app_current_tenant() AND app_is_internal())',
            t, t);
    END LOOP;
END $$;

COMMIT;
