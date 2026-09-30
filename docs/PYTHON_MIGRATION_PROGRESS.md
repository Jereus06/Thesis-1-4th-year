# Python backend migration checkpoint

Updated: 2026-09-30. Branch: `python-backend-migration`.

## Implemented in this checkpoint

- Python package metadata for FastAPI, psycopg, PostgreSQL pooling, pytest, and official XGBoost.
- FastAPI configuration, PostgreSQL lifecycle, live health check, CORS, sessions, and CSRF checks.
- Existing API paths for sign-in/out/me, products, settings, sales, and inventory movements.
- Atomic PostgreSQL product opening balances, sales, receipts, returns, adjustments, and write-offs.
- Python migration runner and owner bootstrap using the existing SQL history.
- Migration 003 for CSRF-token hashing on sessions.
- Chronological XGBoost/Moving Average evaluation core using the official Python package.
- Credentialed TypeScript API client with decimal/date field conversion; UI store wiring remains.
- Business, historical import, forecast-run, prediction, metric, and recommendation API routes.
- A private Python forecast worker and optional idempotency keys for critical stock writes.
- Reserved date-helper contract documented without implementing the groupmate’s task.

## Not yet complete

- Historical file preview and inventory snapshot policy.
- Sale void/correction workflow and exports.
- Model artifact retention and production worker scheduling.
- Full React import, forecast, and recommendation screens backed by the API.
- PostgreSQL integration, concurrency, restart persistence, backup/restore, and recovery tests.
- Live PostgreSQL integration and clean-environment runtime verification.

## Resume order

1. Run migrations and integration tests against an isolated PostgreSQL test database.
2. Complete import/idempotency/void/export endpoints.
3. Complete forecast worker persistence and recommendations.
4. Integrate the frontend in explicit `local-demo` and `api` modes.
5. Verify backup/restore and deployment readiness.
