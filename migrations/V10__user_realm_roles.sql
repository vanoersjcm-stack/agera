-- V10: remember each user's Keycloak realm roles (refreshed on every authenticated call that
-- resolves the user) so internal pickers can show a plain-language role without querying Keycloak.
ALTER TABLE users ADD COLUMN realm_roles TEXT[] NOT NULL DEFAULT '{}';
