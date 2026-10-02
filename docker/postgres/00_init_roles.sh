#!/bin/bash
set -euo pipefail
psql -v ON_ERROR_STOP=1 \
    --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
    -v kc_user="$KEYCLOAK_DB_USER" \
    -v kc_password="$KEYCLOAK_DB_PASSWORD" \
    -v kc_db="$KEYCLOAK_DB_NAME" \
    -v app_user="$DB_USER" \
    -v app_password="$DB_PASSWORD" \
    -v app_db="$POSTGRES_DB" \
    -f /opt/agera/init.sql
