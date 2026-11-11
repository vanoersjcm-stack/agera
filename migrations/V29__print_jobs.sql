-- Agera Suite - V29: sovereign pull printing. A print job holds one office document (room_documents) until its owner
-- releases it at the printer with the 6-digit release code (typed or via QR); the backend then sends it to the local
-- CUPS / IPP-over-TLS printer (CUPS_IPP_URL). Unreleased jobs expire.

BEGIN;

CREATE TABLE print_jobs (
    id           UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID           NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
    document_id  UUID           NOT NULL,
    version      INT            NOT NULL,
    user_id      UUID           NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    status       VARCHAR(10)    NOT NULL DEFAULT 'queued',
    pin_or_token CHAR(6)        NOT NULL,
    copies       INT            NOT NULL DEFAULT 1,
    expires_at   TIMESTAMPTZ(3) NOT NULL,
    released_at  TIMESTAMPTZ(3),
    created_at   TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_print_jobs_document FOREIGN KEY (tenant_id, document_id)
        REFERENCES room_documents (tenant_id, id) ON DELETE CASCADE,
    CONSTRAINT chk_print_jobs_status CHECK (status IN ('queued', 'released', 'expired')),
    CONSTRAINT chk_print_jobs_pin CHECK (pin_or_token ~ '^[0-9]{6}$'),
    CONSTRAINT chk_print_jobs_copies CHECK (copies BETWEEN 1 AND 20),
    CONSTRAINT chk_print_jobs_released CHECK ((status = 'released') = (released_at IS NOT NULL))
);

CREATE INDEX idx_print_jobs_user ON print_jobs (tenant_id, user_id, created_at DESC);

ALTER TABLE print_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY print_jobs_tenant_isolation ON print_jobs FOR ALL
    USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());

COMMIT;
