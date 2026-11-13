-- Agera Suite - V36: closes the last RLS gaps found by ./deploy.sh audit-compliance.
--   * roles_permissions (V1) is tenant-scoped but had no row-level security.
--   * Private appointments (V34) were hidden by the API only; the database now limits them to the organiser and
--     invitees too, like private third parties and client-less documents (V30).

BEGIN;

ALTER TABLE roles_permissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_roles_permissions_policy ON roles_permissions FOR ALL
    USING (tenant_id = app_current_tenant())
    WITH CHECK (tenant_id = app_current_tenant());

CREATE POLICY private_calendar_events_owner_policy ON calendar_events AS RESTRICTIVE
    FOR ALL
    USING (visibility <> 'private' OR created_by = app_current_user() OR EXISTS (
        SELECT 1 FROM calendar_event_attendees a WHERE a.event_id = calendar_events.id AND a.user_id = app_current_user()))
    WITH CHECK (visibility <> 'private' OR created_by = app_current_user() OR EXISTS (
        SELECT 1 FROM calendar_event_attendees a WHERE a.event_id = calendar_events.id AND a.user_id = app_current_user()));

COMMIT;
