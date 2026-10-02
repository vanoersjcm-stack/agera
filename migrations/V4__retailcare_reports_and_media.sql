-- Agera Symphony / RetailCare - Phase 5 (V4): visit reports and media attachments.
-- Media binaries live on local (EU, self-hosted) storage under UPLOAD_DIR; only metadata is stored here.

BEGIN;

-- Target for tenant-safe composite foreign keys (tenant_id, visit_id).
ALTER TABLE merchandising_visits
    ADD CONSTRAINT uq_merchandising_visits_tenant_id_id UNIQUE (tenant_id, id);

CREATE TABLE visit_reports (
    id          UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID           NOT NULL REFERENCES tenants (id) ON DELETE RESTRICT,
    visit_id    UUID           NOT NULL,
    summary     TEXT,
    audit_data  JSONB          NOT NULL DEFAULT '{}',
    created_at  TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_visit_reports_visit UNIQUE (visit_id),
    CONSTRAINT chk_visit_reports_audit_data_object CHECK (jsonb_typeof(audit_data) = 'object'),
    CONSTRAINT fk_visit_reports_visit
        FOREIGN KEY (tenant_id, visit_id) REFERENCES merchandising_visits (tenant_id, id)
        ON DELETE CASCADE
);

CREATE INDEX idx_visit_reports_tenant_updated ON visit_reports (tenant_id, updated_at, id);

CREATE TRIGGER trg_visit_reports_updated_at
    BEFORE UPDATE ON visit_reports
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE visit_media (
    id               UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        UUID           NOT NULL REFERENCES tenants (id) ON DELETE RESTRICT,
    visit_id         UUID           NOT NULL,
    file_path        VARCHAR(500)   NOT NULL,
    mime_type        VARCHAR(100)   NOT NULL,
    file_size_bytes  BIGINT         NOT NULL,
    created_at       TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_visit_media_file_path UNIQUE (file_path),
    CONSTRAINT chk_visit_media_mime_type CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp')),
    CONSTRAINT chk_visit_media_file_size CHECK (file_size_bytes > 0 AND file_size_bytes <= 10485760),
    -- Files on disk are not removed by the database, so a visit with media cannot be deleted.
    CONSTRAINT fk_visit_media_visit
        FOREIGN KEY (tenant_id, visit_id) REFERENCES merchandising_visits (tenant_id, id)
        ON DELETE RESTRICT
);

CREATE INDEX idx_visit_media_visit ON visit_media (tenant_id, visit_id, created_at);

COMMIT;
