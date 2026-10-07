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

- Public owner-store registration, email/password sign-in, optional Google access and intentional connection.
- Session sign-out and current user; scrypt passwords, hashed session tokens, CSRF/Origin checks.
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
record changes in the movement ledger. Historical imports use order-independent batch SHA-256
fingerprints and the existing optional sourceRecordKey per sale line. Keys are trimmed,
case-sensitive, and unique within a business across source formats; use receipt-plus-line IDs
and prefix source/register names where their ID ranges overlap. Matching saved keys are skipped;
reusing a key with a different product/date/quantity reports a conflict without altering sales.
Distinct keys and unkeyed equal-looking rows stay separate. Fully keyed partially rejected
batches can be retried after corrections without importing previously accepted rows again.
Business row locking serializes duplicate checks and writes; no database migration is added.
Earlier exact batch fingerprints are still checked, but unkeyed overlaps and reordered legacy
batches cannot be safely distinguished from separate transactions.

The frontend supports quoted/multiline CSV, comma/semicolon/tab delimiters, separator directives,
named supported headers, and UTF-8 or BOM-marked UTF-16 uploads. It forwards source keys and
reports accepted, skipped, and conflicted rows. Locale-specific dates/numbers are not guessed.

The migration runner retains the existing SQL history, serializes migrations with an advisory lock,
stores checksums, and rejects changes to previously applied migration files.

## Authentication contract

`GET /api/v1/auth/members` authenticates the session cookie and lists only the owner's business.
It does not require a CSRF header, matching the browser's authenticated read requests. Staff are
denied owner management. Account mutations, including staff activation/deactivation, password
changes, and invitations, retain cookie/header/session-hash CSRF validation and Origin checks.

The frontend uses the same authenticated `SessionUser` response and cookie session for password
and Google access. The server checks active business membership on login and protected requests.
Email-only login selects an unambiguous valid account; optional `businessId` still selects a
legacy account when matching credentials belong to multiple businesses.

| Method | Path under `/api/v1`    | Request / response                                                                            |
| ------ | ----------------------- | --------------------------------------------------------------------------------------------- |
| `GET`  | `/auth/options`         | `{data:{signUpEnabled:true,googleEnabled:boolean}}`                                           |
| `POST` | `/auth/sign-in`         | `{email,password,businessId?}` -> session user and cookies                                    |
| `POST` | `/auth/sign-up`         | `{displayName,email,password,businessName,businessLocation?,dataOrigin}` -> new owner/session |
| `POST` | `/auth/sign-out`        | End the current session; CSRF required                                                        |
| `GET`  | `/auth/me`              | Current session user                                                                          |
| `POST` | `/auth/google/start`    | `{intent:"sign-in"\|"link"}` -> `{data:{url}}`; link requires a session and CSRF              |
| `GET`  | `/auth/google/callback` | Registered provider callback; redirects to the website root                                   |
| `GET`  | `/auth/google/pending`  | `{data:null}` or verified `{data:{email,displayName}}`                                        |
| `POST` | `/auth/google/complete` | `{businessName,businessLocation?,dataOrigin}` plus pending cookie -> new owner/session        |

Signup validates passwords at 12 to 128 characters, trimmed names at 1 to 160, and optional
location at up to 240. `dataOrigin` must be `demo` or `partner`. It creates a business, its
default settings, an owner, and a session atomically. No products, sales, stock, or forecasts are
seeded. Public registration reserves an email across stores using an advisory transaction lock;
existing business-scoped email uniqueness and historical accounts remain unchanged.

Google uses an authorization-code flow with browser-bound state, PKCE, and nonce checks.
The backend verifies Google's ID token, audience/issuer, nonce, and verified email, and uses
the stable Google subject to identify the connected account. Provider tokens are handled only
on the server. A first verified Google identity receives a ten-minute pending setup before
store creation. An existing password account must explicitly connect Google while authenticated;
matching email alone never links it. The website exposes connection in Inventory's Account & settings (owner) or Account (staff) tab for
owners and staff.

Migration `004_public_auth` adds `google_identities`, `oauth_flows`, and `google_pending` without
rewriting migrations 001-003 or merging existing users/businesses. One Google identity maps to
one user, and each user has at most one connected Google identity.

Sessions use hashed opaque tokens and an HTTP-only cookie, with the existing readable CSRF cookie
and token header for authenticated writes. Default expiry is 12 hours; valid cookies restore the
frontend session. Browser auth POSTs validate their Origin against `CORS_ORIGIN`. Production
cookies require HTTPS. Password signup does not verify email. Password changes, single-use
recovery, and owner-issued staff invitations are implemented; email delivery requires the
private SMTP configuration described below.

### Optional Google configuration

Configure `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REDIRECT_URI` only in the
server's private environment; never in browser `VITE_` variables. `CORS_ORIGIN` is the exact
public website origin. The callback must share that origin and be
`/api/v1/auth/google/callback`, with no query, fragment, or trailing slash. Local HTTP is accepted
only for development loopback origins; hosting requires HTTPS.

| Mode             | Website / `CORS_ORIGIN`             | Registered `GOOGLE_REDIRECT_URI`                                |
| ---------------- | ----------------------------------- | --------------------------------------------------------------- |
| Compose default  | `http://localhost:8080`             | `http://localhost:8080/api/v1/auth/google/callback`             |
| Vite development | `http://localhost:5173`             | `http://localhost:5173/api/v1/auth/google/callback`             |
| Hosted example   | `https://stockcast.your-domain.com` | `https://stockcast.your-domain.com/api/v1/auth/google/callback` |

Use Google Cloud's Web application OAuth client and register the matching callback. Configure
Branding/Audience and review test users, publishing, and applicable verification before rollout.
See [the setup reference](../docs/SETUP_AND_OPERATIONS.md#configuration-and-hosting) and
[Google's web-server OAuth documentation](https://developers.google.com/identity/protocols/oauth2/web-server).
The implementation requests `openid email profile` and does not provide silent automatic consent.
Actual live OAuth must be checked using the installation's credentials; provider mocks do not
prove that setup.

### Attempt limits

Each API process holds bounded in-memory counters: five registration attempts per hour per client
IP, ten password-login attempts per minute per IP/email, ten Google starts per minute per IP, and
a shared 120 throttled auth writes per minute per IP. HTTP 429 includes `Retry-After`.
Counters are not shared between replicas and reset with the process. Use coordinated gateway
limits for multiple API processes/replicas and configure trusted proxy handling for the actual
client address. These limits do not add email verification.

## Forecast evaluation and persistence

A forecast run snapshots active product IDs, aggregated daily quantities, and model settings in
the existing `data_snapshot` JSON field. The worker reads that snapshot, so edits made while a
run waits in the queue do not change its inputs.

Training, validation, and final-test ranges are consecutive and disjoint. Training-only sales
determine product ranking and the calendar-week/nonzero-day gates.

Fallbacks use each product's contiguous usable tail and own latest usable observation as the
future origin, never another product's newer cutoff. Test forecasts require a usable tail at the
validation cutoff and retain elapsed calendar steps while scoring only usable test targets.
Missing cutoff history leaves metrics unavailable. Saved `fallbackPolicy` is
`contiguous_tail_product_origin_v1`; older baseline rows remain archived, while dashboard serving
uses a conservative preview and marks them stale until Refresh. No existing migrations change.

Normal Refresh keeps up to 14 final-test calendar days and expands validation to 20–28 days when
enough history remains for the configured training gates and training-only CV folds. With default
settings, 134 complete daily observations allow a 100/20/14 split; 142 allow 100/28/14. Shorter
histories retain the compact split and can have unavailable intervals. Calendar allocations are
saved as `configuration.refreshSplit`; actual per-product usable counts and eligibility remain
authoritative. Manual run requests retain their explicit chronological boundaries.

For eligible products:

1. Select official `xgboost.XGBRegressor` parameters with the saved `cvFolds` count (default three,
   minimum two) on expanding training-only folds. Each check window is 14 days; the initial fit
   requires at least 45 days. If all folds cannot fit inside training, use conservative parameters
   and record `requestedFolds`, zero `effectiveFolds`, and `selectionFallback`.
2. Use later validation for early stopping and recursive method comparison from the training cutoff.
   When sufficient validation data exists, reserve its final segment for interval calibration.
3. Choose inverse-validation-MAE ensemble weights and operating method on the method-selection
   validation observations. Final testing remains separate from all selection and calibration.
4. Refit on training plus validation and forecast all final-test dates recursively from that cutoff.
   Moving Average uses the same full observed cutoff history and the same test observations.
5. Save final-test metrics, then refit the operating model on all observed history with the frozen
   configuration for future predictions.
6. Save MA/XGBoost/ensemble future predictions, per-product configuration, and official JSON model files.

Short-history or out-of-scope products use a named Moving Average fallback. The dashboard aggregates
ML comparisons over matching eligible product/date observations. No final-test observation selects
parameters, weights, eligibility, or intervals. Prediction intervals are not fabricated.

Completed runs save `timingVersion: disjoint_phases_v1` in the existing timing JSON. Preparation
measures frozen input preparation and result assembly; training sums every model fit, including CV,
selection, calibration, evaluation, and operational refits. Validation measures CV/selection
predictions and metrics plus calibration residuals; evaluation measures final-test metrics/coverage
and future predictions. `validationEvaluationMs` sums those two scopes. Persistence measures model
artifact writes and result SQL through its transaction commit. Total processing runs from
`process_run` entry through that commit; queue wait and final timing/status publication are separate.
Runs stay running until measured evidence is published; failure/interruption discards their result
rows and artifacts. An unexecuted phase is null, while an actually measured zero remains zero.
Legacy runs have unknown phase scopes. See the [API benchmark](../docs/PERFORMANCE_BENCHMARK.md)
and [browser procedure](../docs/BROWSER_BENCHMARK.md) for separate measurements.

Intervals require at least 20 validation observations. The final validation segment reserves
at least 10 calibration observations after early stopping, weights, and operating-method selection.
The operating method's recursive predictions over that segment produce fixed 10th/90th residual
offsets (nominal 80%), clipped to nonnegative bounds. Saved product summaries retain selection and
calibration counts, calibration dates/split, offsets, and untouched final-test coverage. The frontend
uses the selected method's final-test metric observation count as its denominator. No count,
protocol, or coverage is invented for older runs lacking that evidence. These empirical bands have
no guaranteed future coverage, especially with a small time-ordered sample or after later model refits.

Classification upserts and deletes lock the existing business row before reading prior state and
writing the audit revision. One database clock timestamp captured after lock acquisition is used
for each revision, including the classification's update time. Forecast snapshot timestamps are
also captured after the business lock. This preserves audit order and stale detection when a
transaction began before waiting; API fields and SQL migration history remain unchanged.

Missing calendar days are unknown unless explicitly classified as confirmed zero. Recorded
sales on closures, full/partial stockouts, and incomplete days are excluded by the shared reviewed-day
policy; product-specific classifications override store-wide ones. XGBoost requires a complete
observed-or-confirmed-zero calendar sequence. Refresh uses the first and last usable observations
across active products through the current business date; effective confirmed-zero reviews can
extend that range after the last transaction. Pre-refresh baselines use each product's contiguous
usable tail ending at its own last usable observation. Unknown or excluded trailing dates do not
extend it. Queued snapshots freeze these inputs and their usable bounds; old forecasts keep their
original dates. Confirm the classification policy with the future partner.

The older `reorder-recommendations/generate` endpoint uses this policy in its requested lookback
window, ending at the requested recommendation date. Products without a usable contiguous tail
are omitted; regenerating removes their obsolete same-date rule snapshots. New snapshots retain
the existing schema and record `rule-v2-reviewed-days`.

The dashboard computes expiration using the configured business timezone. Only future prediction
dates on or after that business day contribute to demand and reorder advice. The final forecast
day is usable; after it passes, the dashboard returns `expired`, `forecastThrough`, `businessDay`,
and `businessTimezone`, removes passed future points, and marks affected recommendations
`forecastExpired` with unavailable demand and zero suggestion. Baseline dates remain anchored
to observed history. Per-run prediction endpoints and historical metrics retain their saved data.
The frontend also withholds cached advice across business midnight while waiting for an API response.

The implementation uses chronological validation and training-only model selection. The historical function name
`train_verified_xgboost` refers to the official package integration; it does not certify thesis
accuracy. `xgboost_verified` remains false until the team's research validation supports that claim.

The worker uses session advisory locks to distinguish live jobs from interrupted workers. Failed
runs commit their failed status independently; the worker continues with later jobs. Opening a page
reads predictions, and owners can still explicitly queue **Refresh forecasts**.

### Automatic daily forecast scheduling

With the worker running, daily scheduling is enabled by default at 00:15 in each business's saved
IANA timezone. `FORECAST_DAILY_ENABLED`, `FORECAST_DAILY_TIME` (HH:MM), and
`FORECAST_SCHEDULE_POLL_SECONDS` configure it; the schedule check defaults to 60 seconds and is
bounded to 1–60 seconds. These are deployment settings, not new business database columns.
PostgreSQL's clock determines the most recent due local slot. Before today's scheduled time, that
slot is yesterday's; after downtime, only the latest due slot is caught up. Automatic runs use
history through the day preceding that slot, so an unfinished current business day is excluded.
Manual owner refresh retains its existing current-business-day history policy.

Only active businesses are candidates, with active status rechecked under the lock. Each business
is checked in its own transaction under the existing business row lock and a shared
settings row lock. Any queued/running job blocks another; successful scheduled slots are durable
and are not queued again. A failed slot permits at most three attempts, separated by at least
30 database-clock minutes. Empty, short, or invalid history skips that business without stopping
other businesses. Automatic and manual jobs share chronological split, classification, immutable
snapshot, worker, and publication rules. No migration is added. Existing `configuration` JSON
records `requestedFrom: "daily_schedule"`, `scheduledFor`, `scheduledTime`, `scheduledTimezone`,
`historyThrough`, and `scheduleAttempt`; automatic `requested_by` is NULL.

The authenticated dashboard includes `forecastSchedule` with `enabled`, `localTime`, and the
business `timezone`. The frontend polls about every five seconds for owners and staff. Staff
receive saved results without a Refresh control or write request; owners keep the existing manual
permission. Queue/running states do not claim measured product-by-product progress.

Sales CSV requests accept at most 100,000 data rows; inventory requests remain limited to 5,000.
Oversized files remain reviewable but cannot be submitted, and batches are not split automatically.

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

## Account-maintenance mail

Password recovery and staff invitation links are random, stored only as hashes, expire, and are
consumed once. For Docker Compose, configure the private root `.env` from
[../.env.example](../.env.example): `SMTP_HOST`, `SMTP_PORT` (default 587), `SMTP_USERNAME`,
`SMTP_PASSWORD`, `SMTP_FROM`, and `SMTP_STARTTLS` (default `true`). These variables and
`PUBLIC_APP_URL` are passed only to the API container. Compose defaults an unset or empty
`PUBLIC_APP_URL` to `CORS_ORIGIN`; email links must point to the website recipients can open,
using the public HTTPS URL when hosted. Recreate the API with `npm start` after changes.
Direct Python development uses `backend/.env` from [.env.example](.env.example).

Password recovery returns the same HTTP 200 accepted response for existing and nonexistent
accounts, even when SMTP is unconfigured or an SMTP/network failure prevents delivery. These
failures produce a generic server warning without the recipient, reset token, or transport
details. Invitation creation reports HTTP 503 when mail is unavailable. Reset and invitation
links open their token password form even if the browser already has an authenticated session.

An owner may invite staff; staff cannot administer membership. Password changes and recovery
invalidate existing sessions. The test suite uses a mock SMTP transport and is not evidence of
real email delivery.

## Client survey

Authenticated client feedback uses a versioned four-characteristic questionnaire, durable final
submissions, role-aware summaries, and owner-only CSV export. Browser drafts remain separate.
See [the survey contract](docs/CLIENT_SURVEY.md) and [the verification record](../docs/REVIEW_VERIFICATION.md).
