# StockCast backend architecture and API contract

Status: **the React client, Python/FastAPI API and worker, PostgreSQL persistence, cookie sessions,
public registration, and optional Google access are implemented**. Normal startup uses Docker
Compose. A real hosted deployment and live Google configuration still require verification.

This document describes the current application boundary and contract. Implementation is not
evidence of partner data, validated thesis accuracy, or a completed hosted deployment.

## Technology and component boundaries

Use PostgreSQL as the durable system of record. Its transactions, foreign keys, constraints,
date/time types, and backup tooling fit the linked sales, stock ledger, import, and research-run
records better than browser storage or an unstructured document store.

The backend is Python 3.12 under `backend/app/`: FastAPI owns the versioned JSON REST boundary,
Pydantic validates requests, application/repository operations enforce transaction rules, psycopg
connects to PostgreSQL, and the official Python `xgboost` package supports model evaluation. The
React/TypeScript frontend is a separate client; there is no TypeScript backend runtime.

`backend/app/main.py` is the PostgreSQL API entry point. `backend/app/db.py` owns the bounded
connection pool and live connectivity check. `backend/app/repository.py` implements authenticated,
business-scoped products, settings, manual sales, and audited stock movements. Recording stock
changes locks the product and updates its cached balance together with the audit record.

`backend/app/migrate.py` applies the preserved SQL migration history in filename order, takes a
PostgreSQL advisory lock, records SHA-256 checksums in `schema_migrations`, and rejects edits to an
already-applied migration. `backend/app/bootstrap_owner.py` creates a configured business, settings
row, and initial owner; it does not create sales, products, forecasts, or research results.

### Runnable local demonstration

`backend/app/sqlite_demo.py` provides an older loopback-only, file-backed demonstration with a
limited API surface. It creates an explicitly labelled demo business and must not be exposed publicly or used
for partner data. SQLite is not the production database decision.

## Data ownership and provenance

All records are scoped to a business. `businesses.data_origin` and the origin fields on imported,
sales, movement, and forecast records distinguish `demo` from `partner` data. Demo records must not
be copied into a partner business or included in research metrics. Creating the first real partner
business, its retention rules, and its users requires partner permission and team confirmation.

Public registration records an explicit provenance choice and creates an empty separate owner
store. An authorized-business choice does not invent a research partner or override collection
permission, retention, deployment review, or the team's data policies.

## Authentication and public registration

`backend/app/auth_routes.py` implements email registration/login and optional Google OAuth;
`auth_repository.py` extends the existing repository for account/session/identity operations.
The existing business-scoped permissions and session-user response remain the API boundary.

Public signup creates a separate business, default settings, owner, and session atomically.
Its catalog and history start empty. It requires explicit `demo` or `partner` record provenance
and a previously unregistered email; this does not establish a thesis partner. Passwords are
12 to 128 characters, trimmed names 1 to 160, and optional location at most 240. Existing users
and their business-scoped email uniqueness remain; legacy ambiguous credentials can still use
an optional Business ID during login.

Google uses authorization-code exchange, PKCE, one-time browser-bound state, verified ID tokens,
and a nonce. First-use setup is held server-side for ten minutes. Google subjects connect to
users deliberately; matching email never links a password account automatically. Authenticated
owners and staff can connect Google from Inventory Settings. Provider tokens stay on the server.

Additive migration `004_public_auth` stores one-to-one `google_identities`, temporary
`oauth_flows`, and `google_pending` setup. Migrations 001-003 and existing tenant rows are preserved.
The user retains database-design authority; this feature does not replace the relational model.

Sessions use opaque hashed tokens, HTTP-only cookies, the existing CSRF cookie/header, and
business membership checks. Default cookie/session expiry is 12 hours. Authentication POSTs
validate the browser Origin. Optional server-only `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
and `GOOGLE_REDIRECT_URI` enable Google only when the callback matches `CORS_ORIGIN` and
`/api/v1/auth/google/callback`. Production uses HTTPS.

Per-process attempt limits cover five registrations/hour/IP, ten password logins/minute/IP/email,
ten Google starts/minute/IP, and a shared 120 throttled auth writes/minute/IP. Multiple API
processes require coordinated gateway limits and configured client-address proxy handling.
Email verification for password signup, password recovery/change, and staff invitations remain
unimplemented. See [the backend authentication contract](../backend/README.md#authentication-contract)
and [the user guide's Google setup](USER_GUIDE.md#18-configuration-and-hosting).
Live Google OAuth still requires verification using the deployment's registered credentials.

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

Supported API writes accept idempotency keys; stock changes reject insufficient stock and commit
balances with their audit records. Historical imports retain source row numbers and use
order-independent batch SHA-256 fingerprints. Existing optional source-record keys identify
individual sale lines across batches; business row locking serializes duplicate checks and
inserts. Identical-looking sales with distinct keys remain separate, while changed content for
a reused key is rejected. Without source IDs, overlapping records cannot be identified safely.
Real source-ID namespaces and correction/import policy still need partner confirmation.

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

## REST API (`/api/v1`)

Paginated ledgers use `limit` and `offset`. Dates are ISO `YYYY-MM-DD`; timestamps are RFC 3339
UTC values. Quantities and currency cross the JSON boundary as decimal strings.

| Method  | Path                                                         | Purpose                                                           |
| ------- | ------------------------------------------------------------ | ----------------------------------------------------------------- |
| `GET`   | `/auth/options`                                              | Read public registration and configured Google availability.      |
| `POST`  | `/auth/sign-up`                                              | Create a separate empty owner store with explicit provenance.     |
| `POST`  | `/auth/sign-in`                                              | Email/password login with optional legacy Business ID.            |
| `POST`  | `/auth/sign-out`                                             | End the current cookie session with CSRF verification.            |
| `GET`   | `/auth/me`                                                   | Read the authenticated session user.                              |
| `POST`  | `/auth/google/start`                                         | Start sign-in or authenticated Google connection.                 |
| `GET`   | `/auth/google/callback`                                      | Consume Google response and return to the website.                |
| `GET`   | `/auth/google/pending`                                       | Read verified pending first-store setup, or null.                 |
| `POST`  | `/auth/google/complete`                                      | Complete verified first-store setup and issue a session.          |
| `GET`   | `/businesses/{businessId}`                                   | Read business identity and explicit data origin.                  |
| `PATCH` | `/businesses/{businessId}`                                   | Update confirmed business display fields.                         |
| `GET`   | `/businesses/{businessId}/settings`                          | Read forecast/reorder settings.                                   |
| `PUT`   | `/businesses/{businessId}/settings`                          | Replace validated settings.                                       |
| `GET`   | `/businesses/{businessId}/products`                          | List/filter products.                                             |
| `POST`  | `/businesses/{businessId}/products`                          | Create a product and, when nonzero, an opening-balance movement.  |
| `GET`   | `/businesses/{businessId}/products/{productId}`              | Read a product.                                                   |
| `PATCH` | `/businesses/{businessId}/products/{productId}`              | Update metadata; stock-count changes record audited adjustments.  |
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
| `GET`   | `/businesses/{businessId}/exports/sales.csv`                 | Export authorized sales as CSV.                                   |
| `GET`   | `/businesses/{businessId}/exports/inventory-movements.csv`   | Export the authorized inventory audit ledger as CSV.              |

Authentication uses server-side sessions, HTTP-only session cookies, a readable double-submit CSRF
cookie, and owner/staff authorization. The forecast worker is a separate private process invoked with
`python -m backend.app.worker`; it is intentionally not exposed as a browser endpoint.

## Frontend integration

The default frontend restores `/auth/me` from its cookie, then loads only that user's business,
products, sales, and settings. Signup and Google completion use the same session-user contract.
Forecast pages read saved Python outputs; the worker queues daily jobs using each business's
timezone and completed-day history, and owners can explicitly refresh earlier. The existing
five-second dashboard poll updates staff outputs without a manual write. Daily deduplication and
bounded retries use existing run configuration under the business lock; no migration is added. Decimal API
quantities become frontend numbers at the existing client boundary.

The optional browser demonstration uses separate storage and synthetic data. Existing
`stockcast-v5` records are never automatically uploaded to the PostgreSQL application.
Authorization, transactions, export, backup, restore, and provenance require deployment checks
before collecting real partner records.

## Still to confirm

- Partner identity, consent, retention period, product units, timezone, stockout meaning, and source
  file format.
- Real deployment credentials and Google rollout, staff provisioning, account recovery/verification
  policy, and any partner-specific changes to the existing owner/staff permissions.
- Deployment target, database hosting, encryption, backup schedule, and restore verification.
- Real correction/return procedures and whether outstanding purchase orders/backorders will later
  be modeled. Current stock transactions enforce nonnegative balances.
- Preregistered research split dates/eligibility rules after a real-data audit and independent
  evaluation of the official Python XGBoost integration. The optional browser booster remains
  a custom unverified prototype.
