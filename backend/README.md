# StockCast Python backend

This directory is the independently installable Python 3.12 backend for StockCast. It uses FastAPI,
Pydantic, psycopg, PostgreSQL, and the official Python `xgboost` package. The React frontend remains
separate at the repository root and is not yet connected to this API.

The backend currently provides:

- the existing reversible PostgreSQL migration history;
- cookie sessions, CSRF protection, and owner/staff authorization;
- product, settings, manual-sale, and audited inventory-movement endpoints;
- transactional PostgreSQL stock updates and an executable migration runner;
- chronological moving-average/XGBoost evaluation utilities; and
- an explicit SQLite demonstration API for local-only synthetic workflows.

It is not production-ready and contains no real partner data or verified research results. Historical
imports, sale corrections, idempotent writes, forecast persistence/workers, deployment, and tested
backup/recovery remain incomplete.

## Requirements and installation

- Python 3.12 or 3.13
- PostgreSQL 15 or newer for the primary API

From the repository root, create and activate a virtual environment, then install the backend:

```bash
python -m venv .venv
source .venv/bin/activate  # Windows PowerShell: .venv\\Scripts\\Activate.ps1
python -m pip install -r backend/requirements-dev.txt
```

Copy `backend/.env.example` to `backend/.env`, replace the local database password, and replace all
`OWNER_*` placeholders before bootstrapping an account. Never commit `.env` or real credentials.

## PostgreSQL setup and commands

Create the local role/database using your own password:

```sql
CREATE ROLE stockcast WITH LOGIN PASSWORD 'replace_with_a_local_password';
CREATE DATABASE stockcast OWNER stockcast;
```

Run commands from the repository root:

```bash
python -m backend.app.migrate
python -m backend.app.bootstrap_owner
python -m uvicorn backend.app.main:app --host 127.0.0.1 --port 3001 --reload
```

The migration runner applies sorted `*.up.sql` files under `backend/db/migrations`, records SHA-256
checksums, serializes migration runs with a PostgreSQL advisory lock, and rejects changes to already
applied migrations.

Useful checks:

```bash
python -m pytest backend/tests
python -m backend.app.check_schema
python -m ruff check backend/app backend/tests
```

The root `package.json` exposes convenience commands such as `npm run backend:dev`,
`npm run backend:test`, and `npm run db:migrate`; these invoke Python and do not constitute a Node
backend.

## Optional SQLite demonstration

For a local demonstration without PostgreSQL:

```bash
python -m uvicorn backend.app.sqlite_demo:app --host 127.0.0.1 --port 3001
```

The demo writes `backend/data/stockcast-demo.sqlite3`, creates only an explicitly labelled demo
business, and never imports frontend `localStorage`. Its built-in development credentials are
constants in `backend/app/sqlite_demo.py`. Do not expose it publicly or use it for partner data.

## Authentication and permissions

Sign-in uses business ID, normalized email, and password. Passwords use salted scrypt hashes.
Successful sign-in creates a server-side session plus HTTP-only session and double-submit CSRF
cookies. State-changing authenticated requests require `X-CSRF-Token`.

| Action                                               | Owner | Staff |
| ---------------------------------------------------- | ----- | ----- |
| View products, settings, sales, and movement history | Yes   | Yes   |
| Record a sale                                        | Yes   | Yes   |
| Record a receipt or customer return                  | Yes   | Yes   |
| Create/edit/archive products                         | Yes   | No    |
| Change business settings                             | Yes   | No    |
| Record adjustments or write-offs                     | Yes   | No    |

Production still requires HTTPS, rate limiting, session cleanup, password recovery, security review,
and verified backup/restore. The team must confirm the final API/data contract and partner policies
before storing real business records.
