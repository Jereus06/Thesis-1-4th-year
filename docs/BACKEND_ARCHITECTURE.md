# StockCast backend architecture and API contract

Status: **migration to Python/FastAPI is in progress. PostgreSQL migrations and the first Python
authenticated operational API slice exist; complete parity, frontend integration, forecasting jobs,
and deployment verification remain open**.

## Python target architecture

The target runtime is `React/Vite → FastAPI → psycopg pool → PostgreSQL`. Python owns forecasting
through the official `xgboost` package. `backend/app/main.py` exposes the API, `repository.py` owns
atomic SQL workflows, and `forecasting.py` enforces chronological train/validation/final-test
boundaries. The backend runtime is Python-only; TypeScript remains only in the React frontend.

This document describes the intended boundary between the existing browser demonstration and the
backend under development. It is not evidence of a deployed service, partner data, verified
XGBoost, or forecast accuracy.

## Technology and component boundaries

Use PostgreSQL as the durable system of record. Its transactions, foreign keys, constraints,
date/time types, and backup tooling fit the linked sales, stock ledger, import, and research-run
records better than browser storage or an unstructured document store.

The proposed deployment has four replaceable parts:

1. The React client calls a versioned JSON REST API.
2. FastAPI validates requests, identifies the business and user, enforces CSRF/permissions, and
   invokes the Python repository layer.
3. Application services own transaction boundaries. Recording a current sale or stock receipt must
   update `products.current_stock` and append an `inventory_movements` row in one transaction.
4. PostgreSQL stores operational and research records. A separate forecast worker may consume a
   queued `forecast_runs` row so model fitting never blocks dashboard requests.

The implemented slice is under `backend/app/`. FastAPI provides handlers for authentication,
products, settings, manual sales, and inventory movements. `psycopg_pool` manages PostgreSQL
connections and the repository owns transaction boundaries.

### Browser-local demonstration

The existing React/localStorage demonstration remains explicitly separate from the Python API. It
does not upload seeded records or represent partner data. The backend itself uses PostgreSQL; an
optional Python SQLite adapter has not been implemented.

### PostgreSQL runtime

`backend/app/main.py` is the FastAPI entry point. It validates environment configuration, opens a
bounded psycopg connection pool, and reports HTTP 503 when PostgreSQL is unavailable.

`backend/app/migrate.py` finds sorted `*.up.sql` files, takes a PostgreSQL advisory lock, records
filenames and SHA-256 checksums in `schema_migrations`, and applies each migration and history row in
one transaction. An applied file whose content changes is rejected; schema changes require a new
migration. `db:bootstrap-owner` is separate from migration and creates an explicitly classified
business plus its initial owner without generating sales or research results.

`products.current_stock` is a cached operational balance; `inventory_movements` is the audit trail.
The API must not expose a generic endpoint that overwrites stock without a corresponding movement.
Historic CSV sales imports do not represent deliveries and do not change current stock.

## Data ownership and provenance

All records are scoped to a business. `businesses.data_origin` and the origin fields on imported,
sales, movement, and forecast records distinguish `demo` from `partner` data. Demo records must not
be copied into a partner business or included in research metrics. Creating the first real partner
business, its retention rules, and its users requires partner permission and team confirmation.

The schema models `owner` and `staff` roles. Migration 002 adds scrypt password hashes, server-side
sessions stored by SHA-256 token hash, and business/user-scoped idempotency keys. The HTTP server
uses HTTP-only SameSite cookies, derives the actor from the session, rejects cross-business access,
and restricts product/settings/adjustment administration to owners. Production use still requires
HTTPS, rate limiting, account recovery, security review, and tested backup/restore.

## Transaction rules

- **Manual current sale:** lock the product row, reject an invalid/insufficient-stock request under
  the agreed partner policy, insert the sale, decrement current stock, append a negative `sale`
  movement with the resulting balance, then commit.
- **Historic sale import:** create an import batch, validate all rows and product mappings, preserve
  source row numbers, insert accepted sales chronologically, update batch counts, and do not alter
  current stock.
- **Receipt/adjustment:** lock the product row, calculate the new nonnegative balance, append a
  movement, update the cached balance, then commit.
- **Forecast run:** freeze configuration and a data-snapshot description before processing. Never
  modify completed predictions or metrics in place; create a new run.
- **Recommendation generation:** save the exact demand, stock, lead time, safety stock, coverage,
  method, formula version, reorder point, target, quantity, and status used at that time.

Idempotency keys and the exact insufficient-stock/concurrency response remain HTTP service design
work. Imports can use a file SHA-256 plus source row number to detect retries, subject to the
partner's confirmed import workflow.

## Relational model

- A `business` has users, products, imports, sales, movements, settings, forecast runs, and reorder
  recommendations.
- A product belongs to one business. `(business_id, sku)` is unique.
- A sale belongs to one product. Imported sales belong to an import batch and retain their source
  row; demo sales are explicitly marked as demo.
- An inventory movement belongs to one product and may reference its source sale or import. A sale
  can have at most one sale movement.
- A business has at most one settings row.
- A forecast run belongs to one business and preserves strictly ordered, non-overlapping training,
  validation, and final-test ranges. `xgboost_verified` defaults to false.
- Predictions are unique per run, product, date, method, and split. Future predictions cannot store
  an actual value. Rule/fallback predictions require a reason.
- Metrics are unique per run, method, split, and optional product and store MAE, RMSE, and the
  observation count. Aggregate metrics use a null product.
- A recommendation belongs to a product and normally a forecast run. Only a named fallback/rule
  recommendation may omit a run.

The initial migration is in [`../backend/db/migrations/001_initial_schema.up.sql`](../backend/db/migrations/001_initial_schema.up.sql).

## Proposed REST API (`/api/v1`)

All collection responses should use cursor pagination. Dates are ISO `YYYY-MM-DD`; timestamps are
RFC 3339 UTC values. Quantities and currency cross the JSON boundary as decimal strings unless the
team adopts and documents a safe integer unit convention.

| Method  | Path                                                         | Purpose                                                           |
| ------- | ------------------------------------------------------------ | ----------------------------------------------------------------- |
| `GET`   | `/businesses/{businessId}`                                   | Read business identity and explicit data origin.                  |
| `PATCH` | `/businesses/{businessId}`                                   | Update confirmed business display fields.                         |
| `GET`   | `/businesses/{businessId}/settings`                          | Read forecast/reorder settings.                                   |
| `PUT`   | `/businesses/{businessId}/settings`                          | Replace validated settings.                                       |
| `GET`   | `/businesses/{businessId}/products`                          | List/filter products.                                             |
| `POST`  | `/businesses/{businessId}/products`                          | Create a product and, when nonzero, an opening-balance movement.  |
| `GET`   | `/businesses/{businessId}/products/{productId}`              | Read a product.                                                   |
| `PATCH` | `/businesses/{businessId}/products/{productId}`              | Update product metadata, never stock directly.                    |
| `GET`   | `/businesses/{businessId}/sales`                             | List sales ordered by date and stable ID.                         |
| `POST`  | `/businesses/{businessId}/sales`                             | Transactionally post a current manual sale and stock movement.    |
| `GET`   | `/businesses/{businessId}/inventory-movements`               | Read the stock audit ledger.                                      |
| `POST`  | `/businesses/{businessId}/inventory-movements`               | Transactionally post a receipt, return, write-off, or adjustment. |
| `GET`   | `/businesses/{businessId}/data-imports`                      | List import batches and validation outcomes.                      |
| `POST`  | `/businesses/{businessId}/data-imports`                      | Validate and import authorized historic sales.                    |
| `GET`   | `/businesses/{businessId}/data-imports/{importId}`           | Read batch counts and row-error summary.                          |
| `GET`   | `/businesses/{businessId}/forecast-runs`                     | List runs without implying their results are research findings.   |
| `POST`  | `/businesses/{businessId}/forecast-runs`                     | Queue a run with frozen date ranges/configuration.                |
| `GET`   | `/businesses/{businessId}/forecast-runs/{runId}`             | Read status, provenance, ranges, and verification state.          |
| `GET`   | `/businesses/{businessId}/forecast-runs/{runId}/predictions` | Read method/product/date predictions.                             |
| `GET`   | `/businesses/{businessId}/forecast-runs/{runId}/metrics`     | Read like-for-like split metrics and observation counts.          |
| `GET`   | `/businesses/{businessId}/reorder-recommendations`           | Read persisted recommendations and their inputs.                  |
| `POST`  | `/businesses/{businessId}/reorder-recommendations/generate`  | Generate a versioned recommendation snapshot.                     |

Authentication endpoints are deliberately absent until the team chooses an identity/session design.
Forecast-worker endpoints should be private service operations rather than public browser endpoints.

## Frontend integration sequence

1. Add API DTOs and a persistence interface without changing forecasting domain types.
2. Keep a clearly labelled local demo implementation of that interface.
3. Add a server implementation only after the HTTP contract, authentication, and decimal encoding
   are confirmed.
4. Migrate product/settings reads first, then audited sales and inventory transactions, imports, and
   finally forecast runs/recommendations.
5. Test export, backup, restore, authorization, concurrency, and provenance before storing partner
   records. Do not automatically upload existing `stockcast-v5` browser data.

## Still to confirm

- Partner identity, consent, retention period, product units, timezone, stockout meaning, and source
  file format.
- Authentication provider, session transport, password responsibility, and the exact owner/staff
  permission matrix.
- API framework, deployment target, database hosting, encryption, backup schedule, and restore test.
- Whether sales may drive stock negative, how returns are represented, and whether outstanding
  purchase orders/backorders will later be modeled.
- The verified XGBoost runtime and the preregistered split dates/eligibility rules after a real-data
  audit. The current browser booster remains unverified.
