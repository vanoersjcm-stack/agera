-- Local development data only. Not a migration; never run against shared environments.
-- Tenant for the dev.admin@agera.local user in the imported Keycloak realm.
INSERT INTO tenants (name, domain)
VALUES ('Agera Dev', 'agera.local')
ON CONFLICT (domain) DO NOTHING;
