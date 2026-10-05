# StockCast project context

Last checked against this branch: 2026-10-04. Read alongside [AGENTS.md](../AGENTS.md) and source.

## Purpose and confirmed research context

Official thesis title: **Sales Forecasting and Inventory Optimization for Small Retail Businesses
Using XGBoost Algorithm**.

StockCast records products, sales, and stock movements, evaluates product demand forecasts, and
supports owner restocking decisions. The team is still finding a partner business. Do not invent a
partner, collected data, accuracy result, evaluator response, or deployed domain.

Current Chapters 1–3 text mirrors are under `docs/thesis/`. Formal manuscript files are maintained
outside the repository. Downloads under `public/thesis/` can lag current drafts.

## Application in this branch

| Area               | Source and behavior                                                                                                                                                         |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Startup            | `npm start` builds/starts Compose: PostgreSQL, one-time initialization, Python API, Python worker, and Caddy/frontend                                                       |
| Local and hosting  | Same Python API/PostgreSQL application; private environment values choose local HTTP or domain HTTPS                                                                        |
| Frontend           | React/TypeScript; API mode is the default; Vite development proxies API requests                                                                                            |
| Storage            | PostgreSQL persistent volume stores business records and forecasts; separate volume stores XGBoost JSON models                                                              |
| Sessions           | scrypt passwords, 12-hour default hashed cookie sessions, CSRF/Origin checks, business membership and owner/staff permissions                                               |
| Registration       | Email/password signup creates a separate empty owner store with explicit data provenance; email login retains optional legacy Business ID selection                         |
| Google access      | Optional server-configured authorization-code/PKCE flow, verified Google identity, first-store setup, and intentional connection from Inventory account controls            |
| Inventory          | Product opening stock, sales, deliveries, returns, write-offs, and stock-count adjustments use the existing transactional audit records                                     |
| Imports            | Inventory snapshots are atomic; historical SKU-mapped sales imports preserve current stock                                                                                  |
| Exports            | Sales/stock-movement downloads use authenticated Python CSV endpoints                                                                                                       |
| Forecasts          | Official Python XGBoost, immutable queued inputs, chronological selection/testing, saved predictions/metrics/models                                                         |
| Restock            | Python reads the operating forecast or baseline and current stock; zero suggestions or unavailable demand still allow recording actual deliveries from Restock or Inventory |
| Data quality       | Missing/incomplete dates, explicit zeros, closures, and stockouts have reviewed classifications, audit history, and CSV export                                              |
| Backups            | `npm run backup` creates a PostgreSQL dump; CI checks a separate restore and container recreation                                                                           |
| User guide         | Strategies User guide tab with search, expandable topics, and manual download from docs/USER_GUIDE.md; legacy /guide redirects inside the authenticated app                 |
| System evaluation  | Strategies Evaluation tab restores five selected quality ratings; API drafts are browser-local per business/user, demo drafts keep their existing storage                   |
| Optional prototype | Explicit `VITE_DATA_MODE=browser-demo` retains synthetic browser data and the custom TypeScript prototype                                                                   |

`OWNER_DATA_ORIGIN=demo` describes test-record provenance, not a separate application runtime.
Choose `partner` only for authorized real business data. Fresh normal startup seeds an owner and
business/settings but no generated product or sales history.

Older browser and SQLite records are not silently migrated. Explicit imports/restore transfer
authorized records to the shared PostgreSQL application. Normal API mode uses a separate browser
storage key so it does not overwrite the existing `stockcast-v5` demonstration.

## Product maintenance, stock movements, and frontend roles

Inventory has Products, Sales ledger, Stock movements, and Account & settings tabs (Account for
staff). Owners can maintain SKU, name, category, unit, lead time, safety stock, and unit cost;
verified stock-count corrections are a separate action using the existing audited product PATCH.
Owners can activate/deactivate products without deleting their stock balance or historical
records. Active/Inactive/All filters keep the complete catalog accessible. New sales, deliveries,
returns, write-offs, and operational forecast/restock displays use active products. Changing a unit
label does not convert existing quantities. Inventory snapshots retain the backend's existing
reactivation behavior, including in the browser demonstration.

Stock movements offers returns for owners/staff and owner-only write-offs. Returns increase usable
stock; write-offs decrease it and the form requires a reason. Both use the existing movement POST,
CSRF, and idempotency contract, with movement date, decimal quantity, and note validation. A saved
movement's server balance updates the catalog immediately; its audit entry includes the existing
note, provenance, and recorded user ID. The searchable/filterable ledger loads all movement pages
on opening or Refresh and supports the existing authenticated CSV export.
Refresh reads again when a stock/catalog write happens during loading, so an older read cannot
replace the newly saved balance, audit entry, or product status. The existing response
does not include a creation timestamp or other users' display names; the UI does not invent them.
Backdated movements change current stock without recomputing earlier saved balances.

Shared frontend capabilities mirror the Python permissions: owners manage products, imports,
business/model settings, staff access, and forecast refresh; owners/staff record sales, deliveries,
returns, and reviewed data-quality classifications and access records/exports. Personal account
and password controls remain available to staff. Backend authorization remains authoritative.

Browser-demo keeps the existing storage key and records new movement audits separately from its
synthetic sales; previous history is not assigned invented audits. Explicit Reset demo clears these
new audits along with the existing demonstration reset. No database schema, migration, endpoint,
or backend permission changes were required.

## CSV and historical-import contract

Inventory and sales CSV parsing supports quoted fields, embedded delimiters, doubled quotes,
multiline fields, comma/semicolon/tab exports, optional spreadsheet separator directives, and
UTF-8 or BOM-marked UTF-16 file uploads. Named supported headers can reorder columns;
headerless inventory keeps its eight-column order and headerless sales uses Date, Product,
Quantity, with an optional fourth Source Record Key. Dates remain ISO YYYY-MM-DD and numbers
use a decimal point; locale-specific date/number formats are not guessed.

Product matching prefers exact IDs/SKUs and rejects ambiguous case-insensitive matches.
The browser forwards the existing API sourceRecordKey field. It is a trimmed, case-sensitive,
business-wide identifier of one source sale line (up to 200 characters), not just a receipt
number. Reused keys are checked across batches and source formats; matching transactions are
skipped and altered content is rejected as a key conflict. Distinct keys and rows without keys
are never collapsed merely for equal product/date/quantity. Browser-demo imports retain supplied
keys with the same filtering and preserve existing browser data.

PostgreSQL imports acquire the existing business row lock before duplicate reads and inserts,
without changing the schema or migration history. New batch fingerprints ignore row order
and equivalent quantity formatting while preserving exact trimmed SKU case and row multiplicity. Exact legacy
fingerprints are still checked. Fully keyed partially rejected batches can be retried without
reimporting accepted keys. Unkeyed overlapping records and reordered legacy unkeyed batches
cannot be identified reliably; earlier records are not assigned invented transaction IDs.
The web form reports accepted/skipped/conflicting outcomes and retains partially rejected text.

## Account and Google access contract

Each public signup creates its own owner store with default settings and an empty catalog.
The existing PostgreSQL UUID default generates the Business ID for both password registration
and first-time Google store setup; Inventory account controls exposes it in Your account. The
**Records you plan to use** field chooses test/demo or authorized-real-business provenance.
Both choices retain the same application features and empty-store behavior; neither generates
records or establishes a partner or research result. Signup passwords are 12 to 128 characters.
New emails are reserved across businesses; existing tenant users remain intact and can use
optional Business ID login when credentials are ambiguous.

Password sign-in/registration offer an unchecked **Ask this browser to save my email and
password** option. After successful authentication, StockCast requests the native password
manager through a feature-detected Credential Management API in a secure top-level context.
Standard field names and username/current-password/new-password autocomplete preserve normal
browser password-manager support. Constructor/store failures never fail or delay a successful
sign-in. The browser controls saving, prompts, and autofill and can offer its normal prompt
even when StockCast's explicit request is unchecked. StockCast does not persist these
credentials in application browser storage; browser-owned saving is separate from the
12-hour default cookie session. Google-only registration has no StockCast password to save.

Google is optional and configured only on the server. Browser-bound state, PKCE, nonce, and
verified provider identity precede a real cookie session. First-use store setup expires after
ten minutes. Existing password users intentionally connect Google from Inventory account controls;
matching email alone never links accounts. Session restoration normally lasts 12 hours, and
Google may require account selection/consent after it expires.

Authentication writes have per-process attempt limits; multiple API replicas need coordinated
gateway limits. Password signup has no email verification. Password change, single-use recovery, and owner-issued staff invitations are implemented; recovery/invitation delivery requires private SMTP configuration. Compose passes `SMTP_*` and `PUBLIC_APP_URL` from the root environment to the API only; an unset public URL defaults to `CORS_ORIGIN`. Deployment-specific credentials and live Google OAuth still require actual testing.
Recovery returns the same HTTP 200 accepted response for matched and unmatched accounts,
including when SMTP is unconfigured or delivery fails. SMTP and network failures become a
generic mail-unavailable error; recovery logs a warning without the recipient, token, or
transport details. Owner-issued invitations report HTTP 503 when mail delivery is unavailable.
In API mode, reset and invitation links show their token password form even when the browser
already has an authenticated session.
See [backend authentication details](../backend/README.md#authentication-contract).

## Forecast contract

- Eight calendar weeks and 100 nonzero sales days are separate default _training-only_ gates. The worker
  checks history and calendar completeness first, then selects the top N eligible products by
  training-period sales volume, with product ID breaking ties. Ineligible products do not consume
  ML slots.
- Frontend saves preserve backend nonzero-day thresholds, timezone, and CV-fold settings.
  Python parameter selection uses the configured number of expanding training-only chronological
  folds (default three), each with a 14-day validation window and at least 45 initial training
  days. If all requested folds are not feasible, conservative parameters are used and zero
  effective folds are recorded alongside the requested count. Later validation chooses early
  stopping, ensemble weights, and operating method.
- MA and XGBoost recursively predict matching final-test dates from the same fixed cutoff;
  final-test actuals are not fed into those predictions or model selection.
- An operating model is refitted on observed history after test evaluation with the frozen
  configuration, then saves actual XGBoost future predictions.
- Queued jobs snapshot daily sales, effective quality preparation/provenance, settings, and product IDs. Classification audit revisions make completed results stale even after deletion. Snapshot timestamps use the database clock shared with audit timestamps, so API/database clock differences do not mask later reviewed-day changes.
- The worker consumes saved `preparedProducts` targets and their policy version. Older queued
  snapshots are prepared using only their frozen sales/classifications, with the applied policy
  and legacy preparation source recorded in the completed run configuration.
- Before refresh, dashboard baselines use the contiguous usable history ending at the latest
  sale date; absent or excluded dates are not filled with zeros. Products with no usable history
  retain unavailable demand, including after an empty-history worker run. The older recommendation
  generator applies this same reviewed-day policy within the requested window, ending on the
  requested recommendation date; it omits unavailable products and records `rule-v2-reviewed-days`.
- Current advice uses only prediction dates on or after the configured business day. A saved run
  expires after its last forecast date; expired future points are excluded from the dashboard,
  while archived run predictions and evaluation metrics remain available. Old baselines are not
  shifted to today. The frontend displays Expired and withholds cached advice across business
  midnight until the API recalculates it, including when polling fails.
- Dashboard ML comparisons use matching eligible products/date observations.
- Python intervals are available only when validation contains at least 20 usable observations:
  the later segment reserves at least 10 residual observations after method selection. Fixed
  10th/90th residual quantiles give a nominal 80% band for the operating method, clipped at zero.
  Saved evidence includes selection/calibration counts and calibration dates, residual offsets,
  and untouched final-test coverage. The UI displays this evidence and the final-test denominator;
  small time-ordered samples and later model refits do not guarantee future coverage. Missing
  legacy metadata is reported as unknown, and expired runs retain archived calibration evidence.
  Browser-demo bands are illustrative. No certified accuracy is claimed; operational confidence
  labels remain low pending research validation; `xgboost_verified` remains false.
- Absent dates are not zero-filled. Audited `confirmed_zero` dates are eligible observations; closures, incomplete records, and full/partial stockouts are excluded. XGBoost conservatively requires a complete observed-or-confirmed-zero daily training sequence so calendar lag spacing is preserved. Confirm this policy with the partner before research evaluation.
- The Data quality screen records store-wide or product-specific classifications with an immutable
  audit log and CSV export. Classification upserts and deletes acquire the existing business row
  lock before reading prior state, so concurrent first writes preserve created/updated/deleted
  actions and the actual previous classification/note. Each revision uses one database clock
  timestamp captured after the lock for the classification and audit entry; forecast snapshots
  capture their database timestamp after the same lock. Migration history and API fields are unchanged.
- Overview, Restock, and Forecasts distinguish unavailable history/current advice from usable
  zero demand. They show saved fallback reasons, unknown/excluded-day counts, and quality warnings;
  absent legacy counts are shown as not saved rather than zero. Delivery recording stays available.
  Forecast-run snapshots retain the classifications used by the worker.
- Refresh is explicit from the frontend; the worker continuously polls queued jobs. Failed and
  interrupted jobs are recorded and can be refreshed.

The custom browser boosted-tree code is not the official XGBoost package and is isolated to
demonstration mode. The normal frontend displays Python outputs and does not trigger that prototype.

## Boundaries and delivery checks

Existing SQL migrations 001-003 are preserved; additive `004_public_auth` adds Google identity,
OAuth flow, and pending-setup tables without replacing existing users or business-scoped emails.
The owner retains database-design authority; no replacement schema or second TypeScript backend
is introduced. The reserved `is_valid_iso_date` helper and its
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
- src/lib/import-csv.ts and src/lib/sales-import.ts: spreadsheet parsing and browser source-identity checks.
- [User guide](USER_GUIDE.md), `src/components/user-guide.tsx`, `src/lib/user-guide.ts`: the Strategies guide reader; `src/routes/guide.tsx` keeps old links working.
- `src/components/system-evaluation.tsx`, `src/lib/iso-eval.ts`: shared Strategies evaluation and browser-local rating drafts.
- `backend/app/`: FastAPI, PostgreSQL repositories, worker, official model training, dashboard.
- `backend/app/auth_routes.py`, `auth_repository.py`, `google_auth.py`: public signup, optional Google access, and existing cookie sessions.
- `src/components/api-gate.tsx`, `account-access-card.tsx`: sign-in/store onboarding and intentional Google connection.
- `backend/db/`: existing SQL migration history and package data.
- `src/lib/api.ts`, `store.ts`, `use-api-forecast.ts`: normal frontend integration.
- `src/lib/forecast/`: optional browser demonstration prototype.
- `backend/tests/`, `.github/workflows/system.yml`: verification.
- [README](../README.md), [backend README](../backend/README.md): run commands and contracts.
