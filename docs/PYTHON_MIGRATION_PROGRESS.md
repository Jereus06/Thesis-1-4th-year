# Python backend migration checkpoint

Updated: 2026-09-30. Branch: `complete-python-backend`.

## Implemented in this checkpoint

- Python package metadata for FastAPI, psycopg, PostgreSQL pooling, pytest, and official XGBoost.
- FastAPI configuration, PostgreSQL lifecycle, live health check, CORS, sessions, and CSRF checks.
- Existing API paths for sign-in/out/me, products, settings, sales, and inventory movements.
- Atomic PostgreSQL product opening balances, sales, receipts, returns, adjustments, and write-offs.
- Python migration runner and owner bootstrap using the existing SQL history.
- Migration 003 for CSRF-token hashing on sessions.
- Chronological XGBoost/Moving Average evaluation core using the official Python package.
- Persistent Python SQLite demonstration API with the same authentication, products, settings,
  sales, receipt, stock transaction, and movement-history contracts. It is always labelled demo.
- Credentialed frontend API mode with sign-in/session handling, decimal/date conversion,
  server-confirmed products, settings, sales, and stock receipts. Browser-local demo remains the
  default and is never uploaded.
- Explicit Python package discovery, packaged SQL resources, console commands, and VS Code tasks.
  No backend Node manifest, TypeScript configuration, JavaScript checker, or `backend/src/`
  runtime remains in the current tree.
- Reserved date-helper contract documented without implementing the groupmate’s task.

## Not yet complete

- A transitive hashed dependency lock still needs generation on a networked Python 3.12 machine;
  the checked-in requirements file pins the direct/runtime tools used by this project.
- Historical import preview/commit and inventory snapshot policy.
- Idempotency execution, sale void/correction workflow, and exports.
- Forecast run persistence, model artifacts, queue/worker/scheduler, and recommendation endpoints.
- PostgreSQL integration, concurrency, restart persistence, backup/restore, and recovery tests.
- Deployment and real-partner workflow verification.

## Resume order

1. Install Python 3.12 dependencies and generate a hashed lock (`pip-compile --generate-hashes`).
2. Run migrations against an isolated PostgreSQL test database and execute API tests.
3. Complete import/idempotency/void/export endpoints.
4. Complete forecast worker persistence and recommendations.
5. Verify backup/restore and deployment readiness.
