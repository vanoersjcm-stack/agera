-- Agera Symphony - V11: client companies and their contacts (audit gap B1).
-- Until now a client was only a client_id UUID on agreements/rooms, with its name kept in
-- financial_models.metadata (companyName). Existing ids and names are backfilled here so that
-- client_id on agreements, rooms and plans keeps pointing at the same client.
-- Internal users manage all clients of their tenant; client users (External_Client) may read
-- only their own client record and its contacts.

CREATE TABLE clients (
    id          UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID           NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
    name        VARCHAR(200)   NOT NULL,
    legal_name  VARCHAR(200),
    vat_number  VARCHAR(50),
    city        VARCHAR(100),
    country     VARCHAR(100),
    status      VARCHAR(20)    NOT NULL DEFAULT 'active',
    created_at  TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_clients_tenant_id_id UNIQUE (tenant_id, id),
    CONSTRAINT chk_clients_status CHECK (status IN ('active', 'archived')),
    CONSTRAINT chk_clients_name_not_blank CHECK (btrim(name) <> '')
);

CREATE INDEX idx_clients_tenant_name ON clients (tenant_id, lower(name));

CREATE TRIGGER trg_clients_updated_at
    BEFORE UPDATE ON clients
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE contacts (
    id          UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID           NOT NULL,
    client_id   UUID           NOT NULL,
    first_name  VARCHAR(100)   NOT NULL,
    last_name   VARCHAR(100),
    email       VARCHAR(255),
    phone       VARCHAR(50),
    role_title  VARCHAR(150),
    is_primary  BOOLEAN        NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_contacts_client FOREIGN KEY (tenant_id, client_id)
        REFERENCES clients (tenant_id, id) ON DELETE CASCADE,
    CONSTRAINT chk_contacts_first_name_not_blank CHECK (btrim(first_name) <> '')
);

CREATE INDEX idx_contacts_tenant_client ON contacts (tenant_id, client_id);
CREATE UNIQUE INDEX uq_contacts_primary_per_client ON contacts (tenant_id, client_id) WHERE is_primary;

CREATE TRIGGER trg_contacts_updated_at
    BEFORE UPDATE ON contacts
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Backfill: named clients from financial plan metadata first, then any remaining client ids.
INSERT INTO clients (id, tenant_id, name, vat_number, city, country)
SELECT DISTINCT ON (m.tenant_id, (m.metadata->>'clientId')::uuid)
       (m.metadata->>'clientId')::uuid,
       m.tenant_id,
       COALESCE(NULLIF(btrim(m.metadata->>'companyName'), ''), m.model_name),
       NULLIF(m.metadata->>'vatNumber', ''),
       NULLIF(m.metadata->'address'->>'city', ''),
       NULLIF(m.metadata->'address'->>'country', '')
  FROM financial_models m
 WHERE m.metadata->>'clientId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
 ORDER BY m.tenant_id, (m.metadata->>'clientId')::uuid, m.created_at
ON CONFLICT (id) DO NOTHING;

INSERT INTO clients (id, tenant_id, name)
SELECT DISTINCT ON (x.tenant_id, x.client_id) x.client_id, x.tenant_id, 'Client ' || left(x.client_id::text, 8)
  FROM (SELECT tenant_id, client_id FROM agreements
        UNION SELECT tenant_id, client_id FROM digital_sales_rooms) x
ON CONFLICT (id) DO NOTHING;

-- Contacts from the seed's financial plan metadata (contact object), as primary contact.
INSERT INTO contacts (tenant_id, client_id, first_name, last_name, email, phone, role_title, is_primary)
SELECT DISTINCT ON (m.tenant_id, (m.metadata->>'clientId')::uuid)
       m.tenant_id, (m.metadata->>'clientId')::uuid,
       COALESCE(NULLIF(split_part(btrim(m.metadata->'contact'->>'name'), ' ', 1), ''), split_part(m.metadata->'contact'->>'email', '@', 1)),
       NULLIF(btrim(substr(btrim(m.metadata->'contact'->>'name'), length(split_part(btrim(m.metadata->'contact'->>'name'), ' ', 1)) + 1)), ''),
       NULLIF(lower(m.metadata->'contact'->>'email'), ''),
       COALESCE(NULLIF(m.metadata->'contact'->>'phoneMobile', ''), NULLIF(m.metadata->'contact'->>'phoneOffice', '')),
       NULLIF(m.metadata->'contact'->>'title', ''),
       TRUE
  FROM financial_models m
 WHERE m.metadata ? 'contact'
   AND m.metadata->>'clientId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   AND COALESCE(m.metadata->'contact'->>'name', m.metadata->'contact'->>'email') IS NOT NULL
 ORDER BY m.tenant_id, (m.metadata->>'clientId')::uuid, m.created_at;

ALTER TABLE clients  ENABLE ROW LEVEL SECURITY;
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_clients_policy ON clients
    FOR ALL
    USING (tenant_id = app_current_tenant() AND app_is_internal())
    WITH CHECK (tenant_id = app_current_tenant() AND app_is_internal());

CREATE POLICY client_clients_read_policy ON clients
    FOR SELECT
    USING (tenant_id = app_current_tenant() AND app_is_external_client(id));

CREATE POLICY tenant_contacts_policy ON contacts
    FOR ALL
    USING (tenant_id = app_current_tenant() AND app_is_internal())
    WITH CHECK (tenant_id = app_current_tenant() AND app_is_internal());

CREATE POLICY client_contacts_read_policy ON contacts
    FOR SELECT
    USING (tenant_id = app_current_tenant() AND app_is_external_client(client_id));
