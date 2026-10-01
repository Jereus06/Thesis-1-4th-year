#!/bin/sh
# The official Postgres image sources this script only when creating a new data volume.
set -eu
psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set ON_ERROR_STOP=1 \
    --set app_password="$APP_DB_PASSWORD" <<'SQL'
CREATE ROLE stockcast LOGIN PASSWORD :'app_password' NOSUPERUSER NOCREATEDB NOCREATEROLE;
GRANT CONNECT, CREATE, TEMPORARY ON DATABASE stockcast TO stockcast;
GRANT USAGE, CREATE ON SCHEMA public TO stockcast;
SQL
