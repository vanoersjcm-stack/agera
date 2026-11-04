-- Agera Symphony - V17: licence tier per organisation. Vanguard = mid-market edition (seat-capped), Symphony = enterprise.
ALTER TABLE tenants
    ADD COLUMN license_tier VARCHAR(20) NOT NULL DEFAULT 'symphony',
    ADD COLUMN max_seats    INTEGER;
ALTER TABLE tenants ADD CONSTRAINT chk_tenants_license_tier CHECK (license_tier IN ('vanguard', 'symphony'));
ALTER TABLE tenants ADD CONSTRAINT chk_tenants_max_seats CHECK (max_seats IS NULL OR max_seats > 0);
