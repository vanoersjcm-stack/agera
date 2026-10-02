-- Agera Symphony - Phase 8 (V5): tenant-scoped API keys for portal sync connectors.
-- Only a SHA-256 hash of each key is stored; the plaintext key is shown once at creation.

BEGIN;

CREATE TABLE api_keys (
    id          UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID           NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
    name        VARCHAR(100)   NOT NULL,
    -- Non-secret leading characters of the key, to recognise it in listings.
    key_prefix  VARCHAR(16)    NOT NULL,
    key_hash    VARCHAR(255)   NOT NULL,
    created_at  TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
    expires_at  TIMESTAMPTZ(3),
    CONSTRAINT uq_api_keys_key_hash UNIQUE (key_hash),
    CONSTRAINT chk_api_keys_name_not_blank CHECK (btrim(name) <> '')
);

CREATE INDEX idx_api_keys_tenant ON api_keys (tenant_id, created_at);

COMMIT;
