# StockCast project context

Last checked against this branch: 2026-10-02. Read alongside [AGENTS.md](../AGENTS.md) and source.

## Purpose and confirmed research context

Official thesis title: **Sales Forecasting and Inventory Optimization for Small Retail Businesses
Using XGBoost Algorithm**.

StockCast records products, sales, and stock movements, evaluates product demand forecasts, and
supports owner restocking decisions. The team is still finding a partner business. Do not invent a
partner, collected data, accuracy result, evaluator response, or deployed domain.

Current Chapters 1–3 text mirrors are under `docs/thesis/`. Formal manuscript files are maintained
outside the repository. Downloads under `public/thesis/` can lag current drafts.

## Application in this branch

| Area               | Source and behavior                                                                                                                                         |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Startup            | `npm start` builds/starts Compose: PostgreSQL, one-time initialization, Python API, Python worker, and Caddy/frontend                                       |
| Local and hosting  | Same Python API/PostgreSQL application; private environment values choose local HTTP or domain HTTPS                                                        |
| Frontend           | React/TypeScript; API mode is the default; Vite development proxies API requests                                                                            |
| Storage            | PostgreSQL persistent volume stores business records and forecasts; separate volume stores XGBoost JSON models                                              |
| Sessions           | scrypt passwords, 12-hour default hashed cookie sessions, CSRF/Origin checks, business membership and owner/staff permissions                               |
| Registration       | Email/password signup creates a separate empty owner store with explicit data provenance; email login retains optional legacy Business ID selection         |
| Google access      | Optional server-configured authorization-code/PKCE flow, verified Google identity, first-store setup, and intentional connection from Inventory Settings    |
| Inventory          | Product opening stock, sales, deliveries, and stock-count adjustments are audited and transactional                                                         |
| Imports            | Inventory snapshots are atomic; historical SKU-mapped sales imports preserve current stock                                                                  |
| Exports            | Sales/stock-movement downloads use authenticated Python CSV endpoints                                                                                       |
| Forecasts          | Official Python XGBoost, immutable queued inputs, chronological selection/testing, saved predictions/metrics/models                                         |
| Restock            | Python reads the operating forecast or baseline and current stock; suggested quantity is zero above the reorder trigger                                     |
| Data quality       | Missing/incomplete dates, explicit zeros, closures, and stockouts have reviewed classifications, audit history, and CSV export                              |
| Backups            | `npm run backup` creates a PostgreSQL dump; CI checks a separate restore and container recreation                                                           |
| User guide         | Strategies User guide tab with search, expandable topics, and manual download from docs/USER_GUIDE.md; legacy /guide redirects inside the authenticated app |
| System evaluation  | Strategies Evaluation tab restores five selected quality ratings; API drafts are browser-local per business/user, demo drafts keep their existing storage   |
| Optional prototype | Explicit `VITE_DATA_MODE=browser-demo` retains synthetic browser data and the custom TypeScript prototype                                                   |

`OWNER_DATA_ORIGIN=demo` describes test-record provenance, not a separate application runtime.
Choose `partner` only for authorized real business data. Fresh normal startup seeds an owner and
business/settings but no generated product or sales history.

Older browser and SQLite records are not silently migrated. Explicit imports/restore transfer
authorized records to the shared PostgreSQL application. Normal API mode uses a separate browser
storage key so it does not overwrite the existing `stockcast-v5` demonstration.

## Account and Google access contract

Each public signup creates its own owner store with default settings and an empty catalog.
The existing PostgreSQL UUID default generates the Business ID for both password registration
and first-time Google store setup; Inventory Settings exposes it in Your account. The
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
ten minutes. Existing password users intentionally connect Google from Inventory Settings;
matching email alone never links accounts. Session restoration normally lasts 12 hours, and
Google may require account selection/consent after it expires.

Authentication writes have per-process attempt limits; multiple API replicas need coordinated
gateway limits. Password signup has no email verification. Password change, single-use recovery, and owner-issued staff invitations are implemented; recovery/invitation delivery requires private SMTP configuration. Deployment-specific credentials and live Google OAuth still require actual testing.
See [backend authentication details](../backend/README.md#authentication-contract).

## Forecast contract

- Eight calendar weeks and 100 nonzero sales days are separate _training-only_ gates; top-N ranking
  also uses training data only.
- Validation chooses XGBoost parameters, ensemble weights, and operating method.
- MA and XGBoost recursively predict matching final-test dates from the same fixed cutoff;
  final-test actuals are not fed into those predictions or model selection.
- An operating model is refitted on observed history after test evaluation with the frozen
  configuration, then saves actual XGBoost future predictions.
- Queued jobs snapshot daily sales, effective quality preparation/provenance, settings, and product IDs. Classification audit revisions make completed results stale even after deletion.
- Dashboard ML comparisons use matching eligible products/date observations.
- No calibrated prediction intervals or certified accuracy are claimed. All operational confidence
  labels remain low pending research validation; `xgboost_verified` remains false.
- Absent dates are not zero-filled. Audited `confirmed_zero` dates are eligible observations; closures, incomplete records, and full/partial stockouts are excluded. XGBoost conservatively requires a complete observed-or-confirmed-zero daily training sequence so calendar lag spacing is preserved. Confirm this policy with the partner before research evaluation.
- The Data quality screen records store-wide or product-specific classifications with an immutable audit log and CSV export. Forecast-run snapshots retain the classifications used by the worker.
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
