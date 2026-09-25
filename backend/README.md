# StockCast backend

This directory is the independently installable backend for StockCast. Its intended canonical
repository is [Jereus06/backend](https://github.com/Jereus06/backend).

The current implementation contains:

- a reversible PostgreSQL schema for operational and research records;
- a framework-independent `/api/v1` request handler;
- validation and service layers for products, settings, manual sales, and inventory movements;
- a PostgreSQL repository abstraction with transactional stock and audit-ledger operations; and
- unit tests and structural migration checks.

It does **not** yet contain a production server entry point, PostgreSQL driver wiring,
authentication, a deployed database, real partner data, or verified XGBoost results.

## Local checks

```bash
npm ci
npm run check
```

## Exporting from the frontend repository

Until the initial destination push succeeds, the backend remains in the frontend repository to
avoid losing its history. From the frontend repository root, create a backend-only history with:

```bash
git subtree split --prefix=backend -b backend-export
git push backend backend-export:main
```

After verifying the destination repository, future backend development should be committed there.
Do not copy generated frontend demo records into the backend or relabel them as partner data.
