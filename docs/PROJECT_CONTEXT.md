# StockCast project context

CSV importer, account access, and sales deletion source reviewed against this workspace: 2026-10-09. Read alongside [AGENTS.md](../AGENTS.md) and source.

## Purpose and confirmed research context

Official thesis title: **Sales Forecasting and Inventory Optimization for Small Retail Businesses
Using XGBoost Algorithm**.

StockCast records products, sales, and stock movements, evaluates product demand forecasts, and
supports owner restocking decisions. The team is still finding a partner business. Do not invent a
partner, collected data, accuracy result, evaluator response, or deployed domain.

Current Chapters 1–3 text companions under `docs/thesis/` match the supplied formal manuscript
revised on 9 October 2026, including its questionnaire and final references. The panel's retail
scope excludes sari-sari-store research. Authorized client records or a documented permitted
public retail dataset may support forecast evaluation; the client survey remains owner/manager
and staff only. The final Word manuscript is maintained outside the repository. The strategy
Markdown under `public/thesis/` mirrors the current section; the earlier Word insert is an archive.
Table 3.14 attributes the recorded 5 October 2026 synthetic software verification and does not
claim a new runtime execution or completed client findings.

## Application in this branch

| Area               | Source and behavior                                                                                                                                                                                                                                                        |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Startup            | `npm start` builds/starts Compose: PostgreSQL, one-time initialization, Python API, Python worker, and Caddy/frontend                                                                                                                                                      |
| Local and hosting  | Same Python API/PostgreSQL application; private environment values choose local HTTP or domain HTTPS                                                                                                                                                                       |
| Frontend           | React/TypeScript; API mode is the default; Vite development proxies API requests                                                                                                                                                                                           |
| Storage            | PostgreSQL persistent volume stores business records and forecasts; separate volume stores XGBoost JSON models                                                                                                                                                             |
| Sessions           | scrypt passwords, 12-hour default hashed cookie sessions, CSRF/Origin checks, business membership and owner/staff permissions                                                                                                                                              |
| Registration       | Email/password signup creates a separate empty owner store with explicit data provenance; email login retains optional legacy Business ID selection                                                                                                                        |
| Google access      | Optional server-configured authorization-code/PKCE flow, verified Google identity, first-store setup, and intentional connection from Inventory account controls                                                                                                           |
| Inventory          | Product opening stock, sales, deliveries, returns, write-offs, and stock-count adjustments use the existing transactional audit records                                                                                                                                    |
| Imports            | Inventory snapshots are atomic; historical SKU-mapped sales imports preserve current stock                                                                                                                                                                                 |
| Exports            | Sales/stock-movement downloads use authenticated Python CSV endpoints                                                                                                                                                                                                      |
| Forecasts          | Official Python XGBoost, immutable queued inputs, chronological selection/testing, saved predictions/metrics/models                                                                                                                                                        |
| Restock            | Python reads the operating forecast or baseline and current stock; zero suggestions or unavailable demand still allow recording actual deliveries from Restock or Inventory                                                                                                |
| Data quality       | Missing/incomplete dates, explicit zeros, closures, and stockouts have reviewed classifications, audit history, and CSV export                                                                                                                                             |
| Backups            | `npm run backup` creates a PostgreSQL dump; CI checks a separate restore and container recreation                                                                                                                                                                          |
| User guide         | Header User guide link and Strategies User guide tab provide searchable, expandable everyday task instructions and a download from docs/USER_GUIDE.md; technical commands live in docs/SETUP_AND_OPERATIONS.md; legacy /guide still redirects inside the authenticated app |
| System evaluation  | Strategies Evaluation collects four client-rated characteristics; local drafts remain separate from authenticated, durable submissions and authorized summaries/CSV                                                                                                        |
| Optional prototype | Explicit `VITE_DATA_MODE=browser-demo` retains synthetic browser data and the custom TypeScript prototype                                                                                                                                                                  |

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
Historical sales imports match the complete saved catalog, including inactive products, and
preserve both current stock and activation status. Importing earlier history does not reactivate
a discontinued product or make it available for new operational transactions.

Sales ledger pages through the complete history in 40-row pages. Owners can delete an individual
imported sale or all imported sales after reviewing a confirmation dialog; recorded sales remain
protected. Owner-only, CSRF-protected, business-scoped DELETE routes at `sales/{sale_id}` and
`sales/imported` remove imported records without changing stock or movement audits. Import audit
metadata remains saved. Exact-file duplicate detection permits reimport only after all accepted
rows in that batch have been removed; partially deleted batches retain their safeguard.
Deletion marks existing queued/running/completed forecast configurations `salesHistoryChanged`;
worker persistence preserves concurrent invalidation and dashboard reports those runs as stale.
Frozen forecast inputs and archived outputs remain intact. Browser-demo preserves synthetic and
recorded rows, recognizes earlier importer IDs, and gives repeated imported IDs separate identities
without resetting their quantities/history. New demo imports save explicit source and unique IDs.
Committed deletions stay successful if the follow-up ledger read fails, with a reload notice.
Sales import/deletion refreshes retry a read when a sales write changes the cache during loading.
Verification on 2026-10-09 passed typecheck, lint (three existing React Refresh warnings), build,
12 frontend deletion regressions, six isolated Edge flows with intercepted API transport, and
412 Python tests with no skips using Python 3.12.14 and an independent disposable PostgreSQL 16.
The existing 20 sales-import and 22 auth-session frontend regressions also passed. Browser mocks
are separate from the real database checks; no live business records were deleted during testing.

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
business/model settings, staff access, and manual forecast refresh; owners/staff record sales, deliveries,
returns, and reviewed data-quality classifications and access records/exports. Personal account
and password controls remain available to staff. Backend authorization remains authoritative.

Browser-demo keeps the existing storage key and records new movement audits separately from its
synthetic sales; previous history is not assigned invented audits. Explicit Reset demo clears these
new audits along with the existing demonstration reset. Stock-movement and product maintenance
required no database schema, migration, endpoint, or backend permission changes.

## CSV and historical-import contract

Inventory and sales CSV parsing supports quoted fields, embedded delimiters, doubled quotes,
multiline fields, comma/semicolon/tab exports, optional spreadsheet separator directives, and
UTF-8 or BOM-marked UTF-16 file uploads. Normal use is upload, preview, and import; detailed
mapping/settings are under Adjust import.
Automatic delimiter detection samples up to 50 meaningful logical records and uses consistent
column widths plus recognized headers, so comma-rich notes do not override semicolon/tab tables.
Clear aliases, unique catalog identifier columns, and
unique date-shaped columns can be detected. Date/number interpretations are checked across the
whole file. Column and format choices are made automatically, without mandatory questions or
a review checkbox. A read-only summary and converted preview show the selected interpretation;
Adjust import contains optional overrides and manual product matching. Extra columns are ignored;
totals/revenue are not guessed as sold quantity. Automatic sales matching checks recognized
identity columns for known product conflicts across the whole file before excluding incomplete
columns; an unknown identifier elsewhere cannot hide a contradictory SKU/name match. Explicit
column mappings and manual product matches remain available under Adjust import.
When recognized product-identity headers exist, automatic matching considers only those columns;
an unrelated receipt or note cannot replace an unknown SKU/name just because it matches a product.
Table extraction ignores safe title/preamble
rows, delimiter-only padding, identical repeated headers, and narrowly identified trailing report
totals without a product identifier or source key. A neutral ignored-row count describes this
cleanup. Inferred headerless files bypass header/report cleanup after blank-row removal, preserving
real repeated records even when their values include header aliases. Explicit header choices take
precedence. Real transaction rows with invalid required values still block the whole import.
Explicit formats and full row validation remain available. No external AI service is used.
Wide files retain needed columns beyond column 100 and ignore unused columns. Optional mapping
choices show the first 100 columns plus detected or selected columns, using their actual indices.
Files and pasted sources are limited to 25 MiB before reading or parsing; existing inventory/sales
row limits remain unchanged. Existing inventory SKUs may
import only SKU and stock count by default: unrelated supplied details are ignored, saved details
are displayed from the catalog, and the Python transaction preserves the latest saved metadata.
Optional Update existing product details from CSV under Adjust import enables strict metadata updates.
New SKUs require
all real product details; an incomplete new SKU rolls back the entire stock count import.
Invalid or blank required fields remain errors. Explicit metadata updates validate supplied
values; a nonblank incompatible counting unit remains a blocking safeguard in either mode.

The importer detects ISO, day/month/year, or month/day/year dates and supported decimal /
grouping formats using whole-file evidence. If multiple valid interpretations remain, date
preference is ISO, then day/month/year, then month/day/year; number preference is decimal point,
then comma grouping, then decimal comma. The preview exposes these choices for optional correction.
Valid dates become canonical YYYY-MM-DD; calendar-invalid dates, two-digit
years, timestamps, malformed number grouping, currency signs, excess precision, and lossy large
numbers are rejected. No per-row locale guesses or automatic rounding are performed. Inventory
Category, Unit, Lead Time, Safety Stock, and Unit Cost can use user-entered verified shared values
only when the same value applies to every row. Identifiers, stock counts, sale dates, and sold quantities require source columns; new
inventory products also need their real names and other details. File selection resets mapping/format/shared-value choices.

Inventory and sales use the shared `CsvImporter`, which owns selection, preparation, and errors
separately from product cards and the sales ledger. `CsvImportReview` presents bounded setup,
product resolution, converted preview, and diagnostics. Existing sales summaries and catalog
filtering remain memoized; CSV state changes do not repeat those calculations. A Vite module Web
Worker reads, decodes, parses, converts, validates, and retains complete source, rows, and issues.
Only a bounded summary reaches React. One accessible Choose CSV file button opens a persistent
native file input. Selection prepares records; a persistent Upload CSV button sits beside the
selected filename in its own action row before status text and the preview. Both sales and
inventory use this label. The button remains visible while preparation or invalid required data
disables saving; inline status explains the reason. Ready text tells the user to choose Upload CSV
to save, and the active request shows Uploading….
Unused content produces no warnings. The first required-data blocker appears in neutral inline
text; the complete diagnostics and error report remain under collapsed Import details.
Optional performance measurements are best effort and cannot interrupt CSV preparation.
A failed import request after clicking Upload CSV remains an alert. Submission retrieves cached
validated rows without repeating preparation. A complete error CSV is generated as a Blob in the worker only on demand;
spreadsheet formula prefixes in exported diagnostic values are neutralized.

Original uploaded previews show at most 50 logical records, including the header. Preview cells
remain bounded to 500 characters, 12 fields per record, and 24,000 source characters overall.
Converted previews show at most the first 50 data records, with 200-character diagnostic/display
values. On-screen errors and unresolved identifiers are capped at 50 each; the downloadable
report retains every collected row problem and source record/starting physical line. Catalog
choices for manual matches are searchable and bounded to 50 matches plus the current selection.
Selected matches have their own source/SKU/name search and 50-entry pages; every assignment
can be edited or removed without resetting the source. Changing the product column, separator,
or header choice clears manual matches from the previous source structure. Identifier names
inherited from JavaScript's object prototype do not appear as preselected products.
These display bounds never shorten the retained source or submitted records. Malformed CSV
quoting must be corrected before row validation can proceed.

Under optional Adjust import, users can resolve unknown/ambiguous sales identifiers to an existing
product, including an inactive one, review or remove those selections, or create a missing product separately in
Products. Overrides apply to
all rows with the exact trimmed source identifier. Nonblank optional source Unit values must match the
catalog unit; existing inventory SKUs cannot silently change their counting unit. No quantities
are converted between packs/pieces. Duplicate inventory SKUs and repeated/conflicting source
keys within a selected file block preparation. Equal-looking unkeyed sales remain distinct.

All retained data rows are checked, including errors beyond the preview; any unresolved configuration
or row problem blocks submission. Valid rows are never silently selected as a partial history.
Inventory retains whole-snapshot atomicity. A valid preparation enables the explicit Upload CSV button;
column/format/shared-value/product/catalog changes trigger fresh preparation before saving.
Cancellation, source replacement, and unmount terminate the worker and ignore older results.
The importer remounts when the signed-in user/business changes. Paste preparation retains its
300 ms typing pause. API limits remain 5,000 inventory or 100,000 sales rows per request;
oversized files can be reviewed but cannot be submitted, and are never split automatically.
Backend authorization, tenant checks, validation, historical-stock preservation, snapshot audit,
and cross-batch duplicate detection remain unchanged and authoritative.

Historical file uploads carry the prepared source's original filename through the importer,
store, and API into the existing `data_imports.original_filename` field. Spaces and Unicode
are preserved; pasted CSV has no filename. Filenames do not change content fingerprints or
source-record duplicate checks. This traceability change uses the existing backend contract
and requires no SQL migration.

Sales reads add paired `beforeDate`/`beforeId` cursor parameters and permit up to 1,000 rows per
page, while retaining legacy offset pagination. The browser seeks through the existing
business/date/ID index and keeps a 200-row fallback for older APIs. No SQL migration is needed.
Committed inventory/sales imports remain successful when a follow-up read fails; an explicit
notice reloads saved records without repeating the write. Late read results cannot replace
another signed-in account's cache or warning.
Inventory CSV submissions retain their original submitted rows and idempotency key across failed
attempts and catalog revalidation. This also covers a newly created SKU becoming an existing
product during a refresh. A lost write response can be retried without reapplying the stock count
over later sales or stock movements. A new selected source, an adjustment that changes submitted
rows, or a completed import starts a fresh submission; this retry state is local to the open
importer and does not survive closing it or reloading the page. The existing backend idempotency
contract and database schema are unchanged.

See [guided importer contract and verification](GUIDED_CSV_IMPORTS.md). The older
[CSV upload verification](CSV_UPLOAD_VERIFICATION.md) and
[follow-up verification](CSV_SCHEDULE_FOLLOWUP_VERIFICATION.md) describe prior preparation
behavior and explicitly identify mocked API browser evidence separately from database evidence.
The system workflow now runs guided inventory and 100,000-row sales imports through a browser
against the disposable Python API/PostgreSQL installation, with a separate uploaded report.

Product matching prefers exact IDs/SKUs and rejects ambiguous case-insensitive matches.
Inventory transactions prefer exact saved SKUs before unique case-insensitive matches; ambiguous
matches reject and roll back the entire snapshot, and surrounding source whitespace is trimmed.
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
Sales exports include each saved `source_record_key`, leaving unkeyed records blank. Reimport
recognizes the exported columns automatically and preserves those keys for duplicate checks.
Normal API CSV exports quote every field and prefix formula-like text with a tab for spreadsheet
safety; numeric values remain numeric. Existing identity trimming restores guarded SKUs and keys
on reimport. See [the export contract](GUIDED_CSV_IMPORTS.md#csv-exports).
The web form reports accepted/skipped/conflicting outcomes and retains the selected file or
pasted text when records are partially rejected.

## Account and Google access contract

Startup generates private owner credentials only when `.env` is absent. README contains no shared
owner password. Existing owners change their password through Inventory > Account & settings >
Account maintenance; editing `.env` or restarting does not update an existing password hash.
Removing a documented credential does not itself rotate any deployed credential.

Owner staff lists use session-authenticated GET without a CSRF header; all account mutations retain
CSRF and Origin protection. Account maintenance shows loading, failure, Retry, and an explicit empty
staff list, and prevents duplicate management submissions. The existing owner/business restrictions
and staff session revocation remain enforced by the repository.

Each public signup creates its own owner store with default settings and an empty catalog.
The existing PostgreSQL UUID default generates the Business ID for both password registration
and first-time Google store setup; Inventory account controls exposes it in Your account. The
**Records you plan to use** field chooses test/demo or authorized-real-business provenance.
Both choices retain the same application features and empty-store behavior; neither generates
records or establishes a partner or research result. Signup passwords are 12 to 128 characters.
New emails are reserved across businesses; existing tenant users remain intact and can use
optional Business ID login when credentials are ambiguous.

Sign-in, account creation, recovery, and token password forms use synchronous submission guards
and disable their controls while a request is pending. Password fields have visible labels and
accessible show/hide controls while preserving browser autocomplete. Switching access screens
clears passwords, confirmation, prior feedback, and the explicit browser-save choice. Successful
authentication returns the access screen to Sign in for a later logout. If an authentication POST
succeeds but reading store records fails, the page states that sign-in/account creation/setup
succeeded and offers reload guidance; the existing cookie can reload the store without another
registration request. Old tenant records are not displayed in that failure state.

Sign out shows a pending state and an inline retryable failure. Confirmed logout, including an
already-expired/revoked session reported as HTTP 401, clears the browser's session, records,
settings, provenance, and diagnostics. Network/CSRF failures preserve the current state for retry.
Auth request generations and same-session write/read guards prevent late responses from
restoring a signed-out account or replacing a newer account's state, including same-account
relogin. Server session/CSRF/Origin checks remain authoritative.

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
Forgot password opens its own native-validated email form, with optional Business ID selection
for legacy multi-store accounts, a pending state, and neutral accepted feedback under role=status.
Token password forms label both fields, check confirmation, prevent duplicate submission, and
offer Back to sign in for anonymous browsers or Back to StockCast when a session was restored.
Successful recovery displays Password updated without automatic sign-in; returning preserves
another account's valid session if present. Staff invitation acceptance still opens the invited store.
Password changes and successful recovery revoke all outstanding reset links and sessions for
that account. Issuance/consumption/password changes serialize on the existing user row so
concurrent requests cannot leave older links usable. Disabled accounts/stores cannot complete
recovery. These changes preserve the schema, migration history, endpoints, and JSON fields.
Neutral recovery feedback and ordinary sign-in after reset follow
[OWASP recovery guidance](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html).
Verification on 2026-10-09 passed 35 frontend auth/account regressions, 17 actual Edge browser
scenarios with every API request intercepted, and 400 Python tests against independent disposable
PostgreSQL 16 using Python 3.12.14. Typecheck, lint, and production build passed; lint retained three
existing React Refresh warnings. A parallel test attempt exhausted host memory; the affected
account tests passed sequentially. Browser/SMTP mocks are separate from database evidence and do
not establish live email or Google-provider delivery. Temporary test resources and credentials
were removed; durable regression scripts and synthetic evidence were retained.
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
- Refresh history includes valid sales and effective confirmed-zero reviews for active products,
  up to the current date in the configured business timezone. Product-specific classifications
  override store-wide reviews; unknown and excluded dates cannot extend usable history. Immutable
  snapshots save the usable observation bounds separately from transaction dates.
- Before and after refresh, baselines use each product's contiguous usable history ending at its
  last usable observation; absent or excluded dates are not filled with zeros. Products with no usable history
  retain unavailable demand, including after an empty-history worker run. The older recommendation
  generator applies this same reviewed-day policy within the requested window, ending on the
  requested recommendation date; it omits unavailable products and records `rule-v2-reviewed-days`.
- Worker fallback future dates use each product's last usable observation as their origin, not
  the newest product's global cutoff. Baseline final-test steps retain elapsed calendar spacing
  and score only actual usable targets. Without a contiguous tail at the validation cutoff,
  final-test predictions/metrics are unavailable. `fallbackPolicy` records
  `contiguous_tail_product_origin_v1`; older fallback results are archived but replaced by a
  conservative current preview and marked stale until Refresh. No historical SQL is rewritten.
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
- Normal Refresh reserves up to 14 final-test days and expands validation to 20–28 calendar days
  when training can retain the configured eligibility/CV minimum. Default complete daily histories
  reach a 100/20/14 split at 134 days and 100/28/14 at 142 days. Shorter histories keep compact
  splits and explicit unavailable interval evidence. Planned counts do not replace per-product
  usable observations or nonzero-day gates, and final-test actuals never calibrate intervals.
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
- The Python worker automatically queues the most recent due daily forecast slot, by default at
  00:15 in each business's saved timezone. The database clock determines the slot; only history
  through the preceding completed business day enters an automatic run. Startup catches up the
  latest due slot rather than backfilling every missed day. Owners retain explicit Refresh controls;
  staff need no manual refresh and see queued/running/completed/failed outputs through the existing
  five-second dashboard poll. Schedule claims require enabled metadata from the API.
- Scheduling checks use a monotonic 60-second cadence between jobs, including while the queue
  remains busy; a long-running job can delay the next check. Existing business/settings locks
  serialize slot checks and snapshots with manual requests. Only active businesses are candidates,
  with active status checked again under the lock;
  any queued/running run blocks another for that business. Existing JSON configuration stores the
  scheduled day/time/timezone, history cutoff, and attempt number; automatic jobs have no requested
  user. A completed scheduled slot is not queued again. Failed scheduled slots allow at most three
  attempts with a 30-minute database-clock backoff; invalid/empty/short history is skipped without
  stopping another business. Missing-date, confirmed-zero, chronological split, and immutable input
  rules are shared with manual refresh. No migration or database contract replacement is required.
- Completed worker runs persist measured preparation, all model fits, validation/evaluation,
  artifact/result persistence, and total processing durations. `disjoint_phases_v1` scopes do not
  overlap; total ends after the result commit and excludes queue wait and final timing/status
  publication. Failed/interrupted publication discards committed results before retry. Unexecuted
  phases stay null, and legacy phase scopes are unknown. Forecasts displays these saved times;
  total processing is never substituted for model training. API and actual Edge browser benchmarks
  have separate procedures and raw reports; synthetic measurements are not client findings.

The custom browser boosted-tree code is not the official XGBoost package and is isolated to
demonstration mode. The normal frontend displays Python outputs and does not trigger that prototype.

## Boundaries and delivery checks

Existing SQL migrations 001–006 are preserved. Additive `007_client_survey` stores immutable survey
submissions and item answers without replacing users, sessions, inventory, or forecast records.
The owner retains database-design authority; no replacement schema or second TypeScript backend
is introduced. The reserved `is_valid_iso_date` helper and its
dedicated tests remain the groupmate's task.

The GitHub workflow runs clean frontend installation/typecheck/lint/build, Python tests with
PostgreSQL, full web/API/worker smoke checks, backup restoration, and restart persistence. Local
unit checks and an added workflow are not by themselves evidence of an actual hosted deployment;
read the workflow outcome and record the target hosting verification separately.

Forecast-history regression fixtures freeze only the business day in the saved timezone;
session and idempotency expiry clocks stay real so they remain consistent with PostgreSQL's
creation timestamps. Scheduler assertions that index raw query results by column name explicitly
request psycopg dictionary rows.
On 2026-10-06, the repaired full backend suite passed all 363 tests with no skips in Docker
Python 3.12.14 against an isolated PostgreSQL 16 database (243 warnings). Frontend typecheck,
lint, and build also passed; lint reported three existing React Refresh warnings. This was
local verification of the supplied CI failures; the next GitHub workflow run remains separate.

Deployment account/DNS/storage settings and real-partner policies (corrections/voids, units,
import mapping, retention, collection permission, and independent research cutoffs) use confirmed
team/business requirements. They are not filled in with fictional research results.

## File map

- `compose.yaml`, `Dockerfile`, `backend/Dockerfile`, `deploy/`, `scripts/`: startup/hosting/backup.
- `src/components/csv-importer.tsx`, `csv-import-review.tsx`: shared upload/paste preparation, automatic column/format choices and previews, optional adjustments/product matching, bounded diagnostics, and explicit import controls.
- `src/lib/csv-import.worker.ts`, `csv-preparation.ts`: worker source/row cache, decoding/parsing/validation timings, preview bounds, and existing API row limits.
- `src/lib/csv-extraction.ts`: conservative removal of report titles, padding, repeated headers, and trailing totals while retaining original record/line references.
- `src/lib/import-csv.ts`, `guided-csv.ts`, `sales-import.ts`: spreadsheet parsing, guided conversion/complete diagnostics, indexed product matching, and browser source-identity checks.
- [CSV upload verification](CSV_UPLOAD_VERIFICATION.md), `scripts/test-csv-preparation.mjs`, `test-import-csv.mjs`, `test-sales-import.mjs`: browser measurements and CSV correctness regressions.
- [User guide](USER_GUIDE.md), `src/components/user-guide.tsx`, `src/lib/user-guide.ts`: the Strategies guide reader; `src/routes/guide.tsx` keeps old links working.
- [Setup and operations](SETUP_AND_OPERATIONS.md): separate installation, service, backup, hosting, email/Google configuration, and development instructions; this technical manual is not rendered in the in-app task guide.
- `src/components/system-evaluation.tsx`, `src/lib/client-survey.ts`: client questionnaire, private drafts, durable submission and role-aware summaries; `iso-eval.ts` retains archived local prototype data.
- `backend/app/survey.py`, `client_survey_v1.json`: authenticated survey contract, canonical versioned items, calculations and owner CSV export.
- `backend/app/`: FastAPI, PostgreSQL repositories, worker, official model training, dashboard.
- `backend/app/auth_routes.py`, `auth_repository.py`, `google_auth.py`: public signup, optional Google access, and existing cookie sessions.
- `src/components/api-gate.tsx`, `account-access-card.tsx`, `account-maintenance.tsx`: sign-in/store onboarding, intentional Google connection, password and owner staff management.
- `scripts/test-api-gate.mjs`, `test-auth-session.mjs`, `verify-auth-browser.mjs`: token-form precedence, session/recovery adapter regressions, and isolated browser auth flows with intercepted API transport.
- `backend/db/`: existing SQL migration history and package data.
- `src/lib/api.ts`, `store.ts`, `use-api-forecast.ts`: normal frontend integration.
- `src/lib/forecast/`: optional browser demonstration prototype.
- `backend/tests/`, `.github/workflows/system.yml`: verification.
- [README](../README.md), [backend README](../backend/README.md): run commands and contracts.

## Client evaluation and separate engineering review

The client survey has three statements for each of Functional suitability, Reliability,
Interaction capability, and Perceived performance efficiency. Agreement is 1 (Strongly disagree)
through 5 (Strongly agree). Unanswered and Not applicable are distinct statuses with null ratings;
they are excluded from means and valid response counts. Summaries identify participant counts,
valid item-response counts, rating frequencies, and contributing participants per characteristic.
All valid rated item responses have equal weight; overall means are not averages of category means.

The signed-in owner role records Owner / manager participation; staff records Staff participation.
There is no new database user role. Each account can submit one immutable final response per
questionnaire version, with database timestamps, stored item wording, and provenance. Repeating
the same UUID and answers safely returns that record. Owners access their business's summaries,
role breakdowns, submissions, and CSV; staff access only their own submitted evidence. Survey writes
retain session, CSRF and Origin checks. Drafts remain local, and earlier five-category prototype
drafts are retained separately without being converted or uploaded.

Demo-origin feedback is visibly test feedback, including stored provenance when a business changes
origin later. No responses are seeded into normal startup or presented as actual client findings.
Browser demonstration supports drafts, with server submission unavailable. Database backups include
submitted evidence, while local drafts remain outside the dump. Maintainability is assessed through
[code, documentation, and change review](MAINTAINABILITY_REVIEW.md), without a client rating.
Questionnaire wording/administration and actual partner evaluation still need team review.
See [executed verification](REVIEW_VERIFICATION.md).
