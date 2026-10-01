-- Agera Symphony - V1 initial schema (PostgreSQL 16, UTF-8)
-- gen_random_uuid() is built into PostgreSQL 13+.

BEGIN;

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE tenants (
    id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    name        VARCHAR(100) NOT NULL,
    domain      VARCHAR(150) NOT NULL UNIQUE,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_tenants_updated_at
    BEFORE UPDATE ON tenants
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE users (
    id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID         NOT NULL REFERENCES tenants (id) ON DELETE RESTRICT,
    keycloak_id  VARCHAR(255) NOT NULL UNIQUE,
    email        VARCHAR(255) NOT NULL UNIQUE,
    first_name   VARCHAR(100),
    last_name    VARCHAR(100),
    is_active    BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_tenant_id ON users (tenant_id);

CREATE TABLE roles_permissions (
    id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    role_name   VARCHAR(50)  NOT NULL,
    permission  VARCHAR(100) NOT NULL,
    tenant_id   UUID         NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
    CONSTRAINT uq_roles_permissions UNIQUE (tenant_id, role_name, permission)
);

CREATE TABLE audit_logs (
    id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID         NOT NULL REFERENCES tenants (id) ON DELETE RESTRICT,
    user_id     UUID         REFERENCES users (id) ON DELETE SET NULL,
    action      VARCHAR(100) NOT NULL,
    details     JSONB,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_logs_tenant_created ON audit_logs (tenant_id, created_at DESC);
CREATE INDEX idx_audit_logs_user_id ON audit_logs (user_id);
CREATE INDEX idx_audit_logs_action ON audit_logs (action);

COMMIT;
