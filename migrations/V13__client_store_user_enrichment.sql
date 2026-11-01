-- Agera Symphony - V13: client master data, store-to-client link, user title/zone (audit §13 G7, G8, G17, G18).

ALTER TABLE clients
    ADD COLUMN kvk_number         VARCHAR(20),
    ADD COLUMN sector             VARCHAR(100),
    ADD COLUMN address            VARCHAR(255),
    ADD COLUMN payment_terms      VARCHAR(100)   NOT NULL DEFAULT 'Net 30 days',
    ADD COLUMN credit_limit       NUMERIC(14, 2) NOT NULL DEFAULT 0,
    ADD COLUMN credit_status      VARCHAR(20)    NOT NULL DEFAULT 'approved',
    ADD COLUMN erp_id             VARCHAR(50),
    ADD COLUMN account_manager_id UUID REFERENCES users (id) ON DELETE SET NULL;

ALTER TABLE clients ADD CONSTRAINT chk_clients_credit_status CHECK (credit_status IN ('approved', 'review_required', 'locked'));
ALTER TABLE clients ADD CONSTRAINT chk_clients_credit_limit CHECK (credit_limit >= 0);
CREATE UNIQUE INDEX uq_clients_tenant_erp_id ON clients (tenant_id, erp_id) WHERE erp_id IS NOT NULL;
CREATE INDEX idx_clients_account_manager ON clients (account_manager_id) WHERE account_manager_id IS NOT NULL;

ALTER TABLE stores ADD COLUMN client_id UUID REFERENCES clients (id) ON DELETE SET NULL;
CREATE INDEX idx_stores_tenant_client ON stores (tenant_id, client_id) WHERE client_id IS NOT NULL;

ALTER TABLE users
    ADD COLUMN title VARCHAR(150),
    ADD COLUMN zone  VARCHAR(100);
