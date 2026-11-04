-- Agera Symphony - V15: invoices and agreement run-rate fields for the financial waterfall (audit §13 G19, G23, G24).

CREATE TABLE invoices (
    id              UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID           NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
    client_id       UUID           NOT NULL,
    invoice_number  VARCHAR(50)    NOT NULL,
    description     VARCHAR(255),
    issue_date      DATE           NOT NULL,
    due_date        DATE,
    amount_excl_vat NUMERIC(14, 2) NOT NULL,
    vat_amount      NUMERIC(14, 2) NOT NULL DEFAULT 0,
    status          VARCHAR(20)    NOT NULL DEFAULT 'draft',
    paid_at         TIMESTAMPTZ(3),
    created_at      TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_invoices_tenant_number UNIQUE (tenant_id, invoice_number),
    CONSTRAINT fk_invoices_client FOREIGN KEY (tenant_id, client_id) REFERENCES clients (tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT chk_invoices_status CHECK (status IN ('draft', 'issued', 'paid', 'cancelled')),
    CONSTRAINT chk_invoices_amounts CHECK (amount_excl_vat >= 0 AND vat_amount >= 0),
    CONSTRAINT chk_invoices_paid CHECK ((status = 'paid') = (paid_at IS NOT NULL)),
    CONSTRAINT chk_invoices_number_not_blank CHECK (btrim(invoice_number) <> ''),
    CONSTRAINT chk_invoices_due_after_issue CHECK (due_date IS NULL OR due_date >= issue_date)
);

CREATE INDEX idx_invoices_tenant_client ON invoices (tenant_id, client_id, issue_date);
CREATE INDEX idx_invoices_tenant_paid ON invoices (tenant_id, paid_at) WHERE status = 'paid';

CREATE TRIGGER trg_invoices_updated_at
    BEFORE UPDATE ON invoices
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_invoices_policy ON invoices
    FOR ALL
    USING (tenant_id = app_current_tenant() AND app_is_internal())
    WITH CHECK (tenant_id = app_current_tenant() AND app_is_internal());

-- Run-rate inputs: signed annual value, the amount at risk of not renewing, and the contract end date.
ALTER TABLE agreements
    ADD COLUMN annual_value NUMERIC(14, 2) NOT NULL DEFAULT 0,
    ADD COLUMN churn_risk   NUMERIC(14, 2) NOT NULL DEFAULT 0,
    ADD COLUMN end_date     DATE;
ALTER TABLE agreements ADD CONSTRAINT chk_agreements_run_rate CHECK (annual_value >= 0 AND churn_risk >= 0 AND churn_risk <= annual_value);
CREATE INDEX idx_agreements_tenant_end_date ON agreements (tenant_id, end_date) WHERE status = 'active';
