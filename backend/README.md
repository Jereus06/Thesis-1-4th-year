# StockCast Python backend

The backend is FastAPI with PostgreSQL and the official Python `xgboost` package. All backend
application and test code is Python under `backend/app/` and `backend/tests/`. The React frontend
remains TypeScript.

## Windows laptop setup

Install:

1. Git.
2. Node.js 24 for the React frontend.
3. Python 3.12 (enable **Add Python to PATH**).
4. PostgreSQL 15+ including Command Line Tools; pgAdmin is optional.

From the repository root in PowerShell:

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r backend\requirements-lock.txt
npm install
Copy-Item backend\.env.example backend\.env
```

Create the database as a PostgreSQL administrator:

```sql
CREATE ROLE stockcast WITH LOGIN PASSWORD 'replace_this_password';
CREATE DATABASE stockcast OWNER stockcast;
```

Put the encoded password in `backend/.env`:

```dotenv
DATABASE_URL=postgresql://stockcast:replace_this_password@localhost:5432/stockcast
NODE_ENV=development
CORS_ORIGIN=http://127.0.0.1:5173
OWNER_BUSINESS_ID=00000000-0000-4000-8000-000000000001
OWNER_BUSINESS_NAME=StockCast Demo Store
OWNER_DATA_ORIGIN=demo
OWNER_EMAIL=owner@example.test
OWNER_DISPLAY_NAME=Demo Owner
OWNER_PASSWORD=replace_with_at_least_12_characters
```

Never commit `.env`, passwords, session cookies, partner files, or database dumps.

## Initialize and run

From the repository root with the virtual environment active:

```powershell
npm run db:migrate
npm run db:bootstrap-owner
npm run backend:dev
```

In a second terminal:

```powershell
npm run dev
```

The API is at `http://127.0.0.1:3001`; Swagger UI is at
`http://127.0.0.1:3001/docs`. The browser client must send credentials. Mutating requests require
the `stockcast_csrf` cookie value in `X-CSRF-Token`.

## Implemented Python API slice

- live database health;
- sign-in, sign-out, session lookup, business isolation, and CSRF checking;
- owner/staff checks;
- product create/edit/archive and listing;
- business settings;
- atomic sales that reject insufficient stock;
- audited receipts, customer returns, write-offs, and adjustments;
- paginated sales and movement histories;
- Python migration and initial-owner commands;
- chronological official-XGBoost/Moving-Average evaluation core.

## Permission matrix

| Action                                   | Owner | Staff |
| ---------------------------------------- | ----- | ----- |
| View products/settings/sales/movements   | Yes   | Yes   |
| Record sales, receipts, customer returns | Yes   | Yes   |
| Create/edit/archive products             | Yes   | No    |
| Change settings                          | Yes   | No    |
| Adjust stock or record write-offs        | Yes   | No    |

## Tests

```powershell
python -m pytest backend\tests
npm run typecheck
npm run lint
npm run build
```

Live PostgreSQL tests and the complete frontend workflow remain required. Current progress and blockers are recorded in
[`../docs/PYTHON_MIGRATION_PROGRESS.md`](../docs/PYTHON_MIGRATION_PROGRESS.md).

## Backup and restore

Create an encrypted/controlled backup outside the repository:

```powershell
pg_dump --format=custom --file=stockcast.backup --dbname=$env:DATABASE_URL
```

Restore only into an empty verification database, then run health and workflow tests:

```powershell
createdb -U postgres stockcast_restore_test
pg_restore --clean --if-exists --no-owner --dbname=stockcast_restore_test stockcast.backup
```

Set a temporary `DATABASE_URL` for `stockcast_restore_test`, start the API, and verify counts and the
login → product → sale → movement workflow. Backup/recovery is not “verified” until this succeeds on
the selected deployment device.

## Reserved date helper

The groupmate-reserved `is_valid_iso_date(value: str) -> bool` is intentionally not implemented.
See [`docs/RESERVED_DATE_HELPER.md`](docs/RESERVED_DATE_HELPER.md). API request dates continue to use
normal Pydantic/Python calendar-date validation.

## Explicit SQLite demonstration mode

Run `npm run backend:demo` when PostgreSQL is unavailable. This launches the Python SQLite API,
persists to `backend/data/stockcast-demo.sqlite3`, and reports `mode: sqlite_demo` and
`dataOrigin: demo` from health. Its deliberately non-secret demo login is business ID
`00000000-0000-4000-8000-000000000001`, email `owner@example.test`, password
`stockcast-demo-password`.

Set `VITE_DATA_MODE=api` for the frontend sign-in screen. Leave it unset for the existing
browser-local demo. Neither demo automatically uploads browser records to PostgreSQL.

## Editable install and wheel

From `backend/`:

```powershell
python -m pip install -e ".[forecast,test]"
python -m pip install build
python -m build
```

The wheel includes `app` and the `db/migrations/*.sql` resources. Installed console commands are
`stockcast-migrate`, `stockcast-bootstrap-owner`, and `stockcast-check-schema`.
