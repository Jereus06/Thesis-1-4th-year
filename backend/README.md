# StockCast Python backend

Python 3.12, FastAPI, psycopg, PostgreSQL, and the official XGBoost package implement the backend.
TypeScript remains in the React frontend. The laptop and hosted application both run
`backend.app.main`; `npm start` manages PostgreSQL, migrations, owner initialization, and the worker.
See the [root README](../README.md) for that single-command startup and hosting configuration.

## Run Python directly for development

Use Python 3.12 or 3.13 and a dedicated PostgreSQL database. From the repository root:

```bash
python -m venv .venv
```

Activate it with `.venv\Scripts\Activate.ps1` on Windows PowerShell or
`source .venv/bin/activate` on Linux/macOS, then:

```bash
python -m pip install -r backend/requirements-lock.txt
python -m pip install --no-deps -e "./backend[forecast,test]"
```

Copy `backend/.env.example` to `backend/.env`, then set `DATABASE_URL` and the initial
`OWNER_*` values for your development database. Both settings and owner initialization read this
file. Existing owner passwords are preserved across initialization.

```bash
python -m backend.app.initialize
python -m uvicorn backend.app.main:app --host 127.0.0.1 --port 3001 --reload
```

In another activated terminal, start the worker:

```bash
python -m backend.app.worker
```

Run `npm run dev` for the frontend. It uses the Vite API proxy, so sign-in and CSRF cookies use
the frontend origin. Docker packages the tested dependencies and uses the CPU-only official
XGBoost distribution to avoid GPU libraries on ordinary laptops.

## Implemented API workflows

Routes are under `/api/v1`. Business routes enforce session membership; catalog changes, imports,
settings, and forecast refresh require the owner role.

- Session sign-in, sign-out, and current user; scrypt passwords, hashed session tokens, CSRF checks.
- Business profile and forecasting/restock settings.
- Product creation and editing, with audited opening balances and stock-count adjustments.
- Atomic sales/stock changes and receipt, adjustment, return, and write-off movements.
- Paginated sales and stock ledgers; idempotency keys for supported write operations.
- Atomic inventory snapshot imports; historical SKU-mapped sales imports with row outcomes.
- Authenticated sales and inventory-movement CSV exports.
- Persisted forecast queue, run details, predictions, metrics, and a read-only dashboard.
- Python restock calculations using current stock and the saved operating forecast or baseline.
- Persisted rule-based recommendation snapshots through the existing generation endpoint.

Historical sales imports preserve current stock. Inventory snapshots update catalog/counts and
record changes in the movement ledger. CSV content hashes prevent an identical historical import
from being submitted again.

The migration runner retains the existing SQL history, serializes migrations with an advisory lock,
stores checksums, and rejects changes to previously applied migration files.

## Forecast evaluation and persistence

A forecast run snapshots active product IDs, aggregated daily quantities, and model settings in
the existing `data_snapshot` JSON field. The worker reads that snapshot, so edits made while a
run waits in the queue do not change its inputs.

Training, validation, and final-test ranges are consecutive and disjoint. Training-only sales
determine product ranking and the calendar-week/nonzero-day gates. For eligible products:

1. Fit official `xgboost.XGBRegressor` candidates on training data.
2. Predict the full validation range recursively from the training cutoff.
3. Choose parameters, inverse-validation-MAE ensemble weights, and operating method on validation.
4. Refit on training plus validation and forecast all final-test dates recursively from that cutoff.
   Moving Average uses the same full observed cutoff history and the same test observations.
5. Save final-test metrics, then refit the operating model on all observed history with the frozen
   configuration for future predictions.
6. Save MA/XGBoost/ensemble future predictions, per-product configuration, and official JSON model files.

Short-history or out-of-scope products use a named Moving Average fallback. The dashboard aggregates
ML comparisons over matching eligible product/date observations. No final-test observation selects
parameters, weights, eligibility, or intervals. Prediction intervals are not fabricated.

Current data interpretation treats missing calendar days as zero sales; the ledger must be complete
and this policy must be confirmed for actual partner data. The implementation uses fixed
chronological validation rather than cross-validation/early stopping. The historical function name
`train_verified_xgboost` refers to the official package integration; it does not certify thesis
accuracy. `xgboost_verified` remains false until the team's research validation supports that claim.

The worker uses session advisory locks to distinguish live jobs from interrupted workers. Failed
runs commit their failed status independently; the worker continues with later jobs. Opening a page
reads predictions, and **Refresh forecasts** explicitly queues another run.

## Tests

```bash
python -m pytest backend/tests
```

PostgreSQL integration tests use temporary schemas and require
`STOCKCAST_TEST_DATABASE_URL` pointing to a dedicated test database. Without it, those tests skip;
unit/model/SQLite checks still run. The Compose CI workflow provides PostgreSQL, executes all tests,
checks a complete HTTP workflow and actual XGBoost output, and verifies database restart/restore.

`python -m backend.app.smoke` is a CI check that creates synthetic records in an empty test
installation. It is not a production initialization step and is not called by `npm start`.

## Optional older demonstration adapter

`backend/app/sqlite_demo.py` is retained for older synthetic demonstrations and their tests. It
uses its own SQLite file and limited API surface. Normal laptop/host startup uses PostgreSQL.
Browser demonstration mode remains separately available as described in the root README.

The groupmate's standalone ISO-date helper remains reserved in
[docs/RESERVED_DATE_HELPER.md](docs/RESERVED_DATE_HELPER.md); API request dates use Pydantic validation.
