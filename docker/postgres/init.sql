-- Runs once on first container start (empty data volume), before the V1 migration.
-- Credentials come from psql variables set in 00_init_roles.sh.

-- Separate database/role for Keycloak so IAM data never mixes with app data.
CREATE ROLE :"kc_user" WITH LOGIN PASSWORD :'kc_password';
CREATE DATABASE :"kc_db" OWNER :"kc_user" ENCODING 'UTF8';

-- Least-privilege role used by the NestJS backend: DML only, no DDL.
-- Default privileges cover the tables created afterwards by the V1 migration.
CREATE ROLE :"app_user" WITH LOGIN PASSWORD :'app_password';
GRANT CONNECT ON DATABASE :"app_db" TO :"app_user";
GRANT USAGE ON SCHEMA public TO :"app_user";
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO :"app_user";
