-- rp-5: returns and stock-protection items can go back via the merchandiser/rackjobber (default) or be shipped
-- directly by the store to the vendor/distributor, with an optional tracking or reference number as proof of shipment.
ALTER TABLE rma_cases
    ADD COLUMN return_channel     VARCHAR(15)  NOT NULL DEFAULT 'merchandiser',
    ADD COLUMN tracking_reference VARCHAR(100),
    ADD CONSTRAINT chk_rma_cases_channel CHECK (return_channel IN ('merchandiser', 'store')),
    ADD CONSTRAINT chk_rma_cases_tracking CHECK (return_channel = 'store' OR tracking_reference IS NULL);

ALTER TABLE stock_protection_claims
    ADD COLUMN return_channel     VARCHAR(15)  NOT NULL DEFAULT 'merchandiser',
    ADD COLUMN tracking_reference VARCHAR(100),
    ADD CONSTRAINT chk_stock_claims_channel CHECK (return_channel IN ('merchandiser', 'store')),
    ADD CONSTRAINT chk_stock_claims_tracking CHECK (return_channel = 'store' OR tracking_reference IS NULL);
