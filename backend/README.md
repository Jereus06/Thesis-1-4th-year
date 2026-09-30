# StockCast backend

This directory contains the independently installable backend package for StockCast. The frontend,
backend, database migrations, and project documentation are maintained together in the
[StockCast thesis repository](https://github.com/Jereus06/Thesis-1-4th-year).

The current implementation contains:

- a reversible PostgreSQL schema for operational and research records;
- a framework-independent `/api/v1` request handler;
- validation and service layers for products, settings, manual sales, and inventory movements;
- a PostgreSQL connection pool, migration runner, and repository with transactional stock and
  audit-ledger operations;
- a runnable PostgreSQL HTTP server; and
- unit tests and structural migration checks.

For local demonstrations, the runnable server uses a file-backed SQLite adapter from Node's
standard library. This makes the API workflow executable without pretending that SQLite is the
planned production database. The PostgreSQL schema and repository remain the production target.

It now contains a local-development authentication foundation, but not production security review,
deployment/recovery configuration, real partner data, or verified XGBoost results.

## Local checks

```bash
npm install
npm run check
```

## Requirements

- Node.js 24 or newer and npm.
- PostgreSQL 15 or newer. On Windows, install PostgreSQL from the official installer and include
  PostgreSQL Server, Command Line Tools, and optionally pgAdmin.

## Configure PostgreSQL

Open `psql` or the pgAdmin query tool as a PostgreSQL administrator and create a local role and
database. Replace the example password before running these commands:

```sql
CREATE ROLE stockcast WITH LOGIN PASSWORD 'replace_with_a_local_password';
CREATE DATABASE stockcast OWNER stockcast;
```

Copy `.env.example` to `.env`, then set the same password in `DATABASE_URL`:

```dotenv
DATABASE_URL=postgresql://stockcast:replace_with_a_local_password@localhost:5432/stockcast
PORT=3001
NODE_ENV=development
HOST=127.0.0.1
CORS_ORIGIN=http://localhost:5173
DATABASE_SSL=false
```

Never commit `.env` or a real password.

## Install, migrate, and run

```bash
npm install
npm run db:migrate
npm run db:bootstrap-owner
npm start
```

Before running the owner bootstrap, replace every `OWNER_*` placeholder in `.env`. Use
`OWNER_DATA_ORIGIN=demo` for functional testing. The command creates the business, default settings,
and its first owner account; it does not create products, sales, forecasts, or research results.
`db:bootstrap-demo` remains available when an account is not needed by older API-only tests.

Configuration:

- `PORT` — API port, default `3001`.
- `HOST` — bind address, default `127.0.0.1`.
- `CORS_ORIGIN` — allowed frontend origin, default `http://localhost:5173`.
- `DATABASE_URL` — required PostgreSQL connection URL.
- `DATABASE_SSL` — `true` only when the database host requires TLS; default `false`.

`npm run dev` watches and restarts the PostgreSQL server during backend development. `npm start`
runs it without watch mode. `npm run db:migrate` applies each new `*.up.sql` migration once and
rejects an already-applied migration if its checksum changes.

## Authentication and permissions

Sign-in uses the business ID, normalized email, and password. Passwords are stored as salted scrypt
hashes. Successful sign-in creates a random server-side session and returns an HTTP-only,
SameSite=Strict cookie. Sign-out deletes that session. The PostgreSQL server derives the actor and
business membership from the session; it does not trust a client-supplied actor ID.

| Action                                               | Owner | Staff |
| ---------------------------------------------------- | ----- | ----- |
| View products, settings, sales, and movement history | Yes   | Yes   |
| Record a sale                                        | Yes   | Yes   |
| Record a receipt or customer return                  | Yes   | Yes   |
| Create/edit/archive products                         | Yes   | No    |
| Change business settings                             | Yes   | No    |
| Record adjustments or write-offs                     | Yes   | No    |

Authentication is suitable for local development verification, but production deployment still
requires HTTPS, session cleanup, rate limiting, password reset/recovery, security review, and tested
backup/restore.

## Test with curl or Postman

Health check:

```bash
curl http://127.0.0.1:3001/api/v1/health
```

Sign in and save the HTTP-only session cookie (replace the placeholders with the values used by the
owner bootstrap):

```bash
curl -c cookies.txt -X POST http://127.0.0.1:3001/api/v1/auth/sign-in \
  -H "Content-Type: application/json" \
  -d '{"businessId":"00000000-0000-4000-8000-000000000001","email":"owner@example.test","password":"REPLACE_WITH_OWNER_PASSWORD"}'
```

Create a demonstration product:

```bash
curl -X POST http://127.0.0.1:3001/api/v1/businesses/00000000-0000-4000-8000-000000000001/products \
  -b cookies.txt \
  -H "Content-Type: application/json" \
  -d '{"sku":"DEMO-001","name":"Demo Product","category":"Demo","unit":"piece","currentStock":"10","leadTimeDays":2,"safetyStock":"3","unitCost":"25.50"}'
```

Copy the returned product `id`, then record a sale:

```bash
curl -X POST http://127.0.0.1:3001/api/v1/businesses/00000000-0000-4000-8000-000000000001/sales \
  -b cookies.txt \
  -H "Content-Type: application/json" \
  -d '{"productId":"REPLACE_WITH_PRODUCT_ID","saleDate":"2026-09-25","quantity":"3"}'
```

Verify stock and the audit ledger:

```bash
curl -b cookies.txt http://127.0.0.1:3001/api/v1/businesses/00000000-0000-4000-8000-000000000001/products
curl -b cookies.txt http://127.0.0.1:3001/api/v1/businesses/00000000-0000-4000-8000-000000000001/inventory-movements
```

In Postman, use the same URLs, choose Body → raw → JSON for POST requests, and set
`Content-Type: application/json`. Stop and restart `npm start`, then repeat the GET requests to
confirm PostgreSQL retained the records.

## Optional SQLite demonstration

The earlier SQLite adapter remains available only for dependency-free interface demonstrations:

```bash
npm run demo
```

It writes `data/stockcast-demo.sqlite`. SQLite is not the production database decision.

The PostgreSQL server enforces sessions and roles; the optional SQLite demonstration server does
not. Neither server is approved for public exposure or real partner records. HTTPS, rate limiting,
account recovery, backup/restore, authorization review, and deployment checks are required first.

## Repository location

Backend development stays in this repository under `backend/`. Keeping its package metadata here
allows backend checks to run independently without splitting its Git history from the frontend and
shared research documentation. Do not copy generated frontend demo records into backend partner
storage or relabel them as partner data.
