#!/bin/sh
# Executed inside the database container; this never drops data or resets user accounts.
set -eu

check_login() {
  PGPASSWORD="$APP_DB_PASSWORD" psql -X -w -h 127.0.0.1 -U stockcast \
    -d stockcast -Atqc 'SELECT 1' >/dev/null 2>&1 &&
  PGPASSWORD="$POSTGRES_PASSWORD" psql -X -w -h 127.0.0.1 -U stockcast_admin \
    -d stockcast -Atqc 'SELECT 1' >/dev/null 2>&1
}

if check_login; then
  exit 0
fi

if [ "${1:-}" != "--repair-local" ]; then
  exit 10
fi

# The launcher permits this only for a local development Docker engine. PostgreSQL's
# container-local admin connection repairs role credentials in one transaction.
# \getenv avoids placing passwords in command arguments; :'var' quotes SQL safely.
psql -X -w -U stockcast_admin -d stockcast --set ON_ERROR_STOP=1 >/dev/null 2>&1 <<'SQL'
\getenv app_password APP_DB_PASSWORD
\getenv admin_password POSTGRES_PASSWORD
BEGIN;
ALTER ROLE stockcast_admin PASSWORD :'admin_password';
ALTER ROLE stockcast PASSWORD :'app_password';
COMMIT;
SQL

check_login
