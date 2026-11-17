-- Agera Suite - V40: calendar_busy() also returns the id of other people's private items (never their title), so a
-- mandatory meeting can mark them as overridden. The id alone reveals nothing: the app role still cannot read the row.

BEGIN;

CREATE OR REPLACE FUNCTION calendar_busy(p_users UUID[], p_from TIMESTAMPTZ, p_to TIMESTAMPTZ)
RETURNS TABLE (user_id UUID, starts_at TIMESTAMPTZ, ends_at TIMESTAMPTZ, source TEXT, ref_id UUID, title TEXT, mandatory BOOLEAN)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE t UUID := app_current_tenant(); me UUID := app_current_user();
BEGIN
  IF t IS NULL THEN RAISE EXCEPTION 'app.current_tenant is not set'; END IF;
  IF NOT app_is_internal() THEN RETURN; END IF;
  IF p_to - p_from > INTERVAL '93 days' THEN RAISE EXCEPTION 'range too large'; END IF;
  RETURN QUERY
    WITH people AS (
      SELECT e.created_by AS uid, e.id AS eid FROM calendar_events e WHERE e.tenant_id = t AND e.created_by = ANY(p_users)
      UNION
      SELECT a.user_id, a.event_id FROM calendar_event_attendees a
       WHERE a.tenant_id = t AND a.user_id = ANY(p_users) AND a.response NOT IN ('declined', 'unable')
    )
    SELECT p.uid, e.starts_at::timestamptz, e.ends_at::timestamptz, 'event'::text,
           e.id, CASE WHEN v.visible THEN e.title::text END, e.planning_mode = 'mandatory'
      FROM people p JOIN calendar_events e ON e.tenant_id = t AND e.id = p.eid
      CROSS JOIN LATERAL (SELECT (e.visibility <> 'private' OR e.created_by = me OR EXISTS (
             SELECT 1 FROM calendar_event_attendees x WHERE x.tenant_id = t AND x.event_id = e.id AND x.user_id = me)) AS visible) v
     WHERE e.status = 'scheduled' AND e.starts_at < p_to AND e.ends_at > p_from
    UNION ALL
    SELECT l.user_id, (l.start_date::timestamp AT TIME ZONE 'Europe/Amsterdam'), ((l.end_date + 1)::timestamp AT TIME ZONE 'Europe/Amsterdam'),
           'leave'::text, l.id, l.leave_type::text, FALSE
      FROM leave_requests l
     WHERE l.tenant_id = t AND l.user_id = ANY(p_users) AND l.status = 'approved'
       AND (l.start_date::timestamp AT TIME ZONE 'Europe/Amsterdam') < p_to AND ((l.end_date + 1)::timestamp AT TIME ZONE 'Europe/Amsterdam') > p_from
    UNION ALL
    SELECT mv.field_rep_id, mv.visit_date::timestamptz, (mv.visit_date + INTERVAL '1 hour')::timestamptz, 'visit'::text, mv.id, s.name::text, FALSE
      FROM merchandising_visits mv JOIN stores s ON s.tenant_id = t AND s.id = mv.store_id
     WHERE mv.tenant_id = t AND mv.field_rep_id = ANY(p_users) AND mv.status IN ('PLANNED', 'IN_PROGRESS')
       AND mv.visit_date < p_to AND mv.visit_date + INTERVAL '1 hour' > p_from;
END $$;

COMMIT;
