-- Agera Suite - V37: third-party e-mail and operational categories; invoice lines per product with their own VAT rate.

BEGIN;

ALTER TABLE clients ADD COLUMN email VARCHAR(255);
ALTER TABLE clients DROP CONSTRAINT chk_clients_entity_category;
ALTER TABLE clients ADD CONSTRAINT chk_clients_entity_category CHECK (entity_category IN (
    'client', 'vendor_client', 'vendor_non_client', 'vendor_prospect', 'accountant', 'notary', 'lawyer', 'consultant',
    'shareholder', 'bank', 'insurer', 'agent', 'distributor', 'landlord', 'tenant', 'office_outfitter', 'sister_company',
    'subsidiary', 'office_supplier', 'apparel_supplier', 'apparel_printer', 'taxi_company', 'telecom_domain_provider', 'private',
    'doctor', 'hospital', 'fire_department', 'emergency_112_191', 'police', 'cleaning_supplier', 'packaging_supplier',
    'car_rental', 'apparel_merchandiser', 'catering'));

ALTER TABLE invoice_lines
    ADD COLUMN vat_rate   NUMERIC(5, 2),
    ADD COLUMN product_id UUID,
    ADD CONSTRAINT chk_invoice_lines_vat_rate CHECK (vat_rate IS NULL OR (vat_rate >= 0 AND vat_rate <= 100)),
    ADD CONSTRAINT fk_invoice_lines_product FOREIGN KEY (tenant_id, product_id)
        REFERENCES products (tenant_id, id) ON DELETE SET NULL (product_id);
-- Existing lines keep vat_rate NULL (locked invoices freeze their lines): NULL means the invoice's own vat_rate.

COMMIT;
