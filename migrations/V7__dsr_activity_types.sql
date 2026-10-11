-- V7: accept the DSR activity types from the Phase 2 specification alongside the existing ones.

ALTER TABLE dsr_activities DROP CONSTRAINT chk_dsr_activities_activity_type;

ALTER TABLE dsr_activities ADD CONSTRAINT chk_dsr_activities_activity_type
    CHECK (activity_type IN (
        'opened', 'zone_viewed', 'briefing_played',
        'view', 'download', 'comment',
        'terms_accepted', 'terms_rejected'
    ));
