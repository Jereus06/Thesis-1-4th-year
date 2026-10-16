# Sales CSV limit and automatic daily forecasts

Implementation and verification follow-up on 6 October 2026. All test records are synthetic;
they are not partner data or thesis/client results. The earlier
[CSV freeze verification](CSV_UPLOAD_VERIFICATION.md) retains its original measurements and
50,000-row import evidence; those trials are not relabelled as 100,000-row tests.

## Implemented contract

Sales imports accept at most 100,000 data rows in one request. Inventory retains its 5,000-row
limit. The shared importer prepares complete source and validated rows in its Vite module worker,
shows a bounded read-only uploaded preview, and sends accepted rows without automatic splitting.
The existing transaction, product/SKU matching, source key, duplicate, tenant, and permission
rules remain in effect. A 100,001-row sales source is reviewable but receives a limit error before
submission. Manual paste uses the same preparation and limit checks.

The Python worker now schedules the most recent due daily local slot. Defaults are enabled,
00:15 in each business's saved timezone, and a 60-second check cadence between jobs. A running
job can delay the next check. PostgreSQL's clock selects the slot; automatic history ends on the
day preceding that slot. Before today's scheduled time, yesterday is the latest due slot. Startup
catches up one latest slot rather than replaying all missed days. Owners retain manual refresh
with its current-business-day history policy.

Only active businesses are candidates, and active status is checked again after acquiring the
business lock. The existing business lock and settings row lock protect slot checks and input preparation. Any
queued/running run prevents another for the same business. A completed automatic slot remains
satisfied across polls and restarts. A failed slot permits at most three attempts, with at least
30 database-clock minutes after the latest failure before retry. Invalid, empty, or short history
does not stop another business. Existing chronological splits, reviewed-zero and missing-date
policies, immutable snapshots, worker execution, and completed-result publication are shared
with manual runs. No migration is added, and automatic runs have NULL `requested_by` rather
than impersonating an owner.

The authenticated API publishes `forecastSchedule: { enabled, localTime, timezone }`. Staff and
owners already poll persisted dashboards every five seconds; completed automatic results update
that view without staff Refresh or a write request. Staff retain their existing permissions.
Daily schedule text appears only for enabled, valid API metadata; disabled/missing metadata and
browser-demo behavior retain the existing manual advice. API queue/run status has no invented
percentage progress.

## Verification record

The scheduler's clock/guard tests cover exact local time boundaries, prior-slot catch-up, UTC
versus business dates, fractional timezone offsets, DST dates, any-source pending runs, completed
slot deduplication, exact 30-minute backoff, latest failure timestamps, conservative timestamp
fallbacks, and durable attempt caps. Strict fake-connection checks verify per-business
transactions, lock-before-read ordering, tenant-specific query parameters, active-business
rechecking after candidate selection, automatic NULL user,
invalid-business rollback/isolation, the worker database clock, disabled scheduling without a
database connection, and cadence while queued work stays busy. These are contract/unit checks,
not evidence that PostgreSQL locks were exercised.

Five isolated PostgreSQL integration tests are provided using the existing temporary-schema
fixture: completed-day frozen classifications followed by real worker publication, preservation
of a manual pending run, two concurrent scheduler connections producing one slot, inactive
business exclusion, and durable retry/backoff across repository instances. They also check the
authenticated dashboard's schedule metadata. They require `STOCKCAST_TEST_DATABASE_URL` pointing
to a dedicated test database. They never target the existing StockCast database by default.

The full local backend suite passed 290 tests and skipped 70 dedicated-PostgreSQL cases in
323.84 seconds before the final active-business guard. The final focused suite covering that
guard, scheduling, import limits/import behavior, dashboards, and classification snapshots passed
85 tests and skipped the five dedicated-PostgreSQL scheduler cases in 18.53 seconds. All 38
scheduler unit/contract cases passed. Real local Python XGBoost model tests ran successfully.
The environment used Python 3.13.2, supported by this project's `>=3.12,<3.14` package range;
the Docker Python 3.12 runtime was not exercised. Recorded warnings concern existing FastAPI/
TestClient deprecations and restricted pytest-cache writes, not failed assertions.

The final sequential frontend regression run passed all 115 tests across ten target files.
Typecheck passed. Final lint had no errors and three existing React Refresh warnings; its Python
cache ignore was made recursive in `eslint.config.mjs` after restricted nested-cache traversal
blocked an earlier run. The production build completed in
6.33 seconds and emitted `csv-import.worker-xIMMw9Z5.js` (8.31 kB). An earlier parallel Node
regression attempt exhausted the JavaScript heap; the complete sequential run is the final
result. Workspace-only logs are retained as `benchmarks/followup-pytest.log`,
`benchmarks/followup-pytest-focused-final.log`, and the other `benchmarks/followup*.log` files.

### Actual production-browser interaction

Both final browser reports passed in actual headless Edge 154.0.4258.53 at 1440×1100, with GPU
disabled, Node 24.13.1, Windows kernel 10.0.26200, an Intel i7-8550U with eight logical CPUs,
and 8 GB RAM. The built application was served at `http://127.0.0.1:4177`. Its HTTP responses
were explicitly intercepted synthetic API fixtures, not PostgreSQL responses. These CSV fixtures
started with no catalog or sales; the tiny inventory import created two products, and tiny/pasted
sales added four records before the large import. This differs from the original comparison's
200-product/73,100-history fixture, so these observations are not a direct performance comparison.
Each timing is one engineering observation, including browser/controller readiness overhead.

The CSV report, `benchmarks/csv/after-4177/report.json`, passed all 11 named checks with no browser
errors. File selections retained bounded previews and had no main-thread file read, decode,
full-text textarea write, or existing-history sort recorded.

| File selection | Data rows | Selection to ready/error (ms) | Largest frame gap (ms) | Longest observed long task (ms) | Result |
| --- | ---: | ---: | ---: | ---: | --- |
| Tiny inventory | 2 | 582.5 | 100.0 | 108 | Ready/imported |
| Inventory above its limit | 73,100 | 2,060.6 | 116.7 | 176 | 5,000-row limit; no submission |
| Tiny sales | 2 | 282.0 | 16.8 | 0 | Ready/imported |
| Large sales | 73,100 | 2,474.9 | 83.3 | 110 | Ready within the new cap |
| Accepted sales maximum | 100,000 | 2,534.7 | 66.7 | 97 | Ready/imported; retry verified |
| Sales above its limit | 100,001 | 2,957.3 | 66.6 | 90 | 100,000-row limit; no submission |

A zero in the long-task column means no task lasting at least 50 ms was observed; it does not mean zero main-thread work.

| Data rows / kind | Worker read (ms) | Decode (ms) | Parse (ms) | Validate (ms) | Worker total (ms) | Main preview commit (ms) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 2 inventory | 3.5 | 0.8 | 1.2 | 1.2 | 7.4 | 6.0 |
| 73,100 inventory | 31.0 | 15.8 | 836.9 | 759.4 | 1,653.9 | 12.4 |
| 2 sales | 5.6 | 0.4 | 2.0 | 13.8 | 23.1 | 3.1 |
| 73,100 sales | 25.7 | 13.8 | 1,097.1 | 862.9 | 2,001.2 | 12.0 |
| 100,000 sales | 80.7 | 12.5 | 1,150.1 | 946.4 | 2,191.1 | 7.9 |
| 100,001 sales | 46.8 | 11.4 | 1,273.8 | 1,299.1 | 2,632.5 | 7.3 |

The 100,000-row file contained 3,788,925 bytes and displayed 50 logical preview records including
its header. Worker phases describe background preparation; asynchronous read time is not main
CPU time. Preview commit is measured on the main thread and overlaps the selection window, so
these durations must not be added to obtain end-to-end latency. For that maximum file, native
main-thread layout measured 20.0 ms, style recalculation 20.6 ms, script 30.7 ms, and total tasks
276.9 ms across the selection window; its preview-to-next-frame measurement was 40.6 ms.

Actual button interaction sent one 100,000-row request and one complete 100,000-row retry, with
source keys `large-0` through `large-99999`. The mock accepted all first-import records and
reported zero new records on retry. The request log contains inventory 2 rows, tiny sales 2,
pasted sales 2, then 100,000 and 100,000. This verifies full payload forwarding and UI/store
behavior against the intercepted contract. The unchanged real API can reject an identical fully
accepted batch with HTTP 409; actual PostgreSQL commit/retry was not executed here.

Cancellation, rapid replacement, manual paste, navigation/unmount, malformed/oversized headers,
invalid dates, invalid UTF-8, BOM-marked UTF-16LE/BE, and quoted commas/newlines passed actual
interaction checks. At six-times CPU throttling during preparation, a 450-pixel scroll took
390.1 ms; typing in product search took 326.4 ms with a 100.0 ms largest frame gap. Navigation
also completed. The production worker URL was observed in 16 preparation runs, confirming that
the emitted `csv-import.worker-xIMMw9Z5.js` loaded and executed.

The staff report, `benchmarks/scheduled-forecast/4177/report.json`, passed six checks for queued,
running, completed, failed, expired, and disabled schedule states with no browser errors. Six
dashboard GETs and no POSTs updated the same staff page without Refresh or reload. Observed
state-change waits were 4,614.7 ms (running), 5,134.5 ms (completed), 4,698.6 ms (failed), and
4,924.6 ms (expired). These are polling waits, not Python model-training times. Disabled metadata
removed the automatic-daily promise. The completed staff screenshot was visually reviewed.

Docker Compose configuration validation and Python compilation of changed source/tests passed.
Docker Desktop remained paused, so actual PostgreSQL imports, scheduled worker execution against
PostgreSQL, Docker Python 3.12, and container/Caddy delivery were not verified. Existing database
records, migrations, private environment files, and the reserved groupmate date helper were
preserved. An initial browser launch failed before Edge started because disk space was exhausted;
after clearing only task-owned caches and closed isolated profiles, the final solo browser runs
completed. Original measurement reports and baseline sources remain intact.

### Changed areas

- Backend sales row cap, daily slot/retry helpers, repository scheduling, worker cadence, deployment
  settings, and dashboard metadata: `backend/app/schemas.py`, `backend/app/scheduling.py`,
  `backend/app/repository.py`, `backend/app/worker.py`, `backend/app/config.py`,
  `backend/app/dashboard.py`, `backend/app/main.py`, `compose.yaml`, `.env.example`, and
  `backend/.env.example` (public templates).
- Frontend sales cap, forecast metadata/advice, staff status, and existing polling:
  `src/lib/csv-preparation.ts`, `src/routes/inventory.tsx`, `src/lib/api.ts`, `src/lib/use-api-forecast.ts`,
  `src/lib/use-forecast.ts`, `src/lib/forecast-schedule.ts`, `src/components/training-banner.tsx`,
  `src/components/interval-evidence.tsx`, `src/routes/forecasts.tsx`, `src/routes/index.tsx`,
  `src/routes/restock.tsx`, `src/routes/methodology.tsx`, and `src/lib/thesis/two-strategies.ts`.
- Regression coverage and actual Edge harnesses: `backend/tests/test_forecast_schedule.py`,
  `backend/tests/test_sales_import_limit.py`, `scripts/test-csv-preparation.mjs`,
  `scripts/test-sales-import.mjs`, `scripts/test-forecast-schedule.mjs`,
  `scripts/test-demand-evidence.mjs`, `scripts/test-interval-evidence.mjs`,
  `scripts/verify-csv-browser.mjs`, and `scripts/verify-scheduled-forecast-browser.mjs`.
  `eslint.config.mjs` excludes nested Python test caches. Documentation records current behavior
  and retains the original CSV measurements separately.

## Rebuild and run while retaining records

Start Docker Desktop with its Linux engine running and unpaused. Use the existing project folder
and private `.env`; normal rebuild/startup retains the named PostgreSQL and model volumes.

```powershell
Set-Location -LiteralPath 'C:\Users\User\Documents\4th year thesis\SFAIOUXGBOOSTA'
npm.cmd ci
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run build
node --test --test-concurrency=1 scripts/test-import-csv.mjs scripts/test-csv-preparation.mjs scripts/test-sales-import.mjs
npm.cmd start
```

The local Python development environment can additionally run backend checks with:

```powershell
.\.venv\Scripts\python.exe -m pytest backend/tests --basetemp=benchmarks/pytest-local
```

The explicit workspace pytest temp path avoids this session's restricted default Temp directory.
PostgreSQL integration cases skip unless a dedicated test URL is configured. Ordinary Docker
startup installs its own Python dependencies; it does not require this local virtual environment.
