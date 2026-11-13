-- Agera Calendar: documents linked to appointments (shared meeting materials and one set of meeting notes per appointment).

CREATE TABLE calendar_event_documents (
    tenant_id   UUID           NOT NULL REFERENCES tenants (id) ON DELETE RESTRICT,
    event_id    UUID           NOT NULL,
    document_id UUID           NOT NULL,
    kind        VARCHAR(12)    NOT NULL DEFAULT 'attachment',
    added_by    UUID           NOT NULL,
    created_at  TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
    PRIMARY KEY (event_id, document_id),
    CONSTRAINT fk_calendar_documents_event FOREIGN KEY (tenant_id, event_id) REFERENCES calendar_events (tenant_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_calendar_documents_document FOREIGN KEY (tenant_id, document_id) REFERENCES room_documents (tenant_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_calendar_documents_user FOREIGN KEY (tenant_id, added_by) REFERENCES users (tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT chk_calendar_documents_kind CHECK (kind IN ('attachment', 'notes'))
);

CREATE UNIQUE INDEX uq_calendar_documents_notes ON calendar_event_documents (event_id) WHERE kind = 'notes';
CREATE INDEX idx_calendar_documents_document ON calendar_event_documents (tenant_id, document_id);

ALTER TABLE calendar_event_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_calendar_event_documents_policy ON calendar_event_documents FOR ALL
    USING (tenant_id = app_current_tenant() AND app_is_internal())
    WITH CHECK (tenant_id = app_current_tenant() AND app_is_internal());

-- A personal document (no client) stays with its creator, unless it is linked to an appointment:
-- then everyone who may see that appointment (team: all colleagues; private: organiser and invitees) may open and edit it.
DROP POLICY personal_room_documents_owner_policy ON room_documents;
CREATE POLICY personal_room_documents_owner_policy ON room_documents AS RESTRICTIVE
    FOR ALL
    USING (client_id IS NOT NULL OR created_by = app_current_user() OR EXISTS (
        SELECT 1 FROM calendar_event_documents ed
          JOIN calendar_events e ON e.tenant_id = ed.tenant_id AND e.id = ed.event_id
         WHERE ed.tenant_id = room_documents.tenant_id AND ed.document_id = room_documents.id
           AND (e.visibility = 'team' OR e.created_by = app_current_user()
                OR EXISTS (SELECT 1 FROM calendar_event_attendees a WHERE a.event_id = e.id AND a.user_id = app_current_user()))))
    WITH CHECK (client_id IS NOT NULL OR created_by = app_current_user() OR EXISTS (
        SELECT 1 FROM calendar_event_documents ed
          JOIN calendar_events e ON e.tenant_id = ed.tenant_id AND e.id = ed.event_id
         WHERE ed.tenant_id = room_documents.tenant_id AND ed.document_id = room_documents.id
           AND (e.visibility = 'team' OR e.created_by = app_current_user()
                OR EXISTS (SELECT 1 FROM calendar_event_attendees a WHERE a.event_id = e.id AND a.user_id = app_current_user()))));
