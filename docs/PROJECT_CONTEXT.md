# StockCast project context

Last checked against this branch: 2026-10-01. Read alongside [AGENTS.md](../AGENTS.md) and source.

## Purpose and confirmed research context

Official thesis title: **Sales Forecasting and Inventory Optimization for Small Retail Businesses
Using XGBoost Algorithm**.

StockCast records products, sales, and stock movements, evaluates product demand forecasts, and
supports owner restocking decisions. The team is still finding a partner business. Do not invent a
partner, collected data, accuracy result, evaluator response, or deployed domain.

Current Chapters 1–3 text mirrors are under `docs/thesis/`. Formal manuscript files are maintained
outside the repository. Downloads under `public/thesis/` can lag current drafts.

## Application in this branch

| Area               | Source and behavior                                                                                                     |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| Startup            | `npm start` builds/starts Compose: PostgreSQL, one-time initialization, Python API, Python worker, and Caddy/frontend   |
| Local and hosting  | Same Python API/PostgreSQL application; private environment values choose local HTTP or domain HTTPS                    |
| Frontend           | React/TypeScript; API mode is the default; Vite development proxies API requests                                        |
| Storage            | PostgreSQL persistent volume stores business records and forecasts; separate volume stores XGBoost JSON models          |
| Sessions           | scrypt passwords, hashed cookie sessions, CSRF verification, business membership and owner/staff permissions            |
| Inventory          | Product opening stock, sales, deliveries, and stock-count adjustments are audited and transactional                     |
| Imports            | Inventory snapshots are atomic; historical SKU-mapped sales imports preserve current stock                              |
| Exports            | Sales/stock-movement downloads use authenticated Python CSV endpoints                                                   |
| Forecasts          | Official Python XGBoost, immutable queued inputs, chronological selection/testing, saved predictions/metrics/models     |
| Restock            | Python reads the operating forecast or baseline and current stock; suggested quantity is zero above the reorder trigger |
| Backups            | `npm run backup` creates a PostgreSQL dump; CI checks a separate restore and container recreation                       |
| Optional prototype | Explicit `VITE_DATA_MODE=browser-demo` retains synthetic browser data and the custom TypeScript prototype               |

`OWNER_DATA_ORIGIN=demo` describes test-record provenance, not a separate application runtime.
Choose `partner` only for authorized real business data. Fresh normal startup seeds an owner and
business/settings but no generated product or sales history.

Older browser and SQLite records are not silently migrated. Explicit imports/restore transfer
authorized records to the shared PostgreSQL application. Normal API mode uses a separate browser
storage key so it does not overwrite the existing `stockcast-v5` demonstration.

## Forecast contract

- Eight calendar weeks and 100 nonzero sales days are separate _training-only_ gates; top-N ranking
  also uses training data only.
- Validation chooses XGBoost parameters, ensemble weights, and operating method.
- MA and XGBoost recursively predict matching final-test dates from the same fixed cutoff;
  final-test actuals are not fed into those predictions or model selection.
- An operating model is refitted on observed history after test evaluation with the frozen
  configuration, then saves actual XGBoost future predictions.
- Queued jobs snapshot daily sales, settings, and product IDs in the existing schema.
- Dashboard ML comparisons use matching eligible products/date observations.
- No calibrated prediction intervals or certified accuracy are claimed. All operational confidence
  labels remain low pending research validation; `xgboost_verified` remains false.
- Missing days currently mean zero sales. Confirm ledger completeness, stockout interpretation,
  and that policy with the partner before research evaluation.
- Refresh is explicit from the frontend; the worker continuously polls queued jobs. Failed and
  interrupted jobs are recorded and can be refreshed.

The custom browser boosted-tree code is not the official XGBoost package and is isolated to
demonstration mode. The normal frontend displays Python outputs and does not trigger that prototype.

## Boundaries and delivery checks

Existing SQL migrations are preserved. The owner retains database-design authority; no replacement
schema or second TypeScript backend is introduced. The reserved `is_valid_iso_date` helper and its
dedicated tests remain the groupmate's task.

The GitHub workflow runs clean frontend installation/typecheck/lint/build, Python tests with
PostgreSQL, full web/API/worker smoke checks, backup restoration, and restart persistence. Local
unit checks and an added workflow are not by themselves evidence of an actual hosted deployment;
read the workflow outcome and record the target hosting verification separately.

Deployment account/DNS/storage settings and real-partner policies (corrections/voids, units,
import mapping, retention, collection permission, and independent research cutoffs) use confirmed
team/business requirements. They are not filled in with fictional research results.

## File map

- `compose.yaml`, `Dockerfile`, `backend/Dockerfile`, `deploy/`, `scripts/`: startup/hosting/backup.
- `backend/app/`: FastAPI, PostgreSQL repositories, worker, official model training, dashboard.
- `backend/db/`: existing SQL migration history and package data.
- `src/lib/api.ts`, `store.ts`, `use-api-forecast.ts`: normal frontend integration.
- `src/lib/forecast/`: optional browser demonstration prototype.
- `backend/tests/`, `.github/workflows/system.yml`: verification.
- [README](../README.md), [backend README](../backend/README.md): run commands and contracts.
