-- Runs once on first container start (empty data volume), before the V1 migration.
-- Creates a separate database/role for Keycloak so IAM data never mixes with app data.
-- Credentials come from psql variables set in 00_keycloak_db.sh.

CREATE ROLE :"kc_user" WITH LOGIN PASSWORD :'kc_password';
CREATE DATABASE :"kc_db" OWNER :"kc_user" ENCODING 'UTF8';
