-- Local development data only. Not a migration; never run against shared environments.
-- Fixed IDs so Keycloak dev users can reference them via the tenant_id attribute/claim.
INSERT INTO tenants (id, name, domain) VALUES
    ('a9e1a000-0000-4000-8000-000000000001', 'Agera Dev', 'agera.local'),
    ('a9e1a000-0000-4000-8000-000000000002', 'Acme Test', 'acme.test')
ON CONFLICT (domain) DO NOTHING;
