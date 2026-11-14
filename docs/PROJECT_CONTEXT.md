# StockCast project context

CSV importer, account access, and imported-sale deletion source reviewed against this workspace: 2026-10-09. Recorded-sale correction updated and verified on 2026-10-15. Transaction retries, future-sale validation, comparison units, and forecast polling updated on 2026-10-16. Stock-movement retries/date validation, saved forecast descriptions, client dashboard/account controls, shared-state concurrency, and the import/snapshot timestamp fix updated on 2026-10-20. Forecast capture locking, shared sales polling, and completed-run horizon display updated on 2026-10-23. Read alongside [AGENTS.md](../AGENTS.md) and source.

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
| Sales tools        | Browser-demo dashboard cards open forecast options and an owner sales report with date/product/category filters, trend summaries, product ranking, and holdout comparison; monetary totals use recorded unit cost as an estimate until selling prices are modeled          |
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

## Concurrent saves and displayed forecast inputs

Manual sales, product creation/edits, and stock movements acquire the existing business row
lock before product locks, matching imports, quality reviews, settings saves, and forecast
capture. A concurrent save either finishes before capture reads its inputs or waits until the
immutable snapshot transaction ends. Sale creation and new catalog timestamps use the database
wall clock after acquiring that lock. Additive migration `009_wall_clock_revisions` changes the
existing `set_updated_at()` trigger function to `clock_timestamp()` so a prestarted settings or
product transaction cannot hide a later write behind transaction-start `now()`. Migrations
001–008, table shapes, request/response contracts, and frozen forecast inputs remain intact.
This follows PostgreSQL's documented distinction between
[transaction-start and wall-clock timestamps](https://www.postgresql.org/docs/current/functions-datetime.html#FUNCTIONS-DATETIME-CURRENT).

Changed dashboard revisions also reload sales alongside the shared catalog/settings, with
session and local-write guards; unchanged revisions retain the existing lightweight polling.
Another user's sale can therefore update both stock and Recent sales without a page reload.
Overview's forecast horizon belongs to the displayed completed run, including while a new run
is queued/running. A different saved setting is identified separately until replacement results
arrive. Legacy results without a saved horizon show it as unavailable instead of borrowing
current settings; the optional browser pipeline records the horizon it actually used.

The 2026-10-23 focused verification used Python 3.12.14 and a separate disposable PostgreSQL
16.15 instance. Fourteen new cases cover transactions started before capture and actual blocked
writes during capture for sales, product edits/activation/creation, settings, receipts, and
quality reviews. All 15 focused database tests passed, including the existing import/worker
regression. Running the seven prestarted cases against copied original source and migrations
001–008 produced six expected failures and one existing-quality pass: sales, metadata, settings,
and receipts reproduced a later save with `stale=false`; catalog creation/activation also
retained an older timestamp even where product membership independently marked the result stale.
The fixed tests require later timestamps and preserve the frozen snapshot.

All 11 focused Edge browser checks passed using intercepted synthetic HTTP, including another
browser's sale updating both stock and the open sales ledger, retained 40-row pagination,
same-revision retry after a failed ledger read, and no ledger reads for unchanged revisions.
These browser fixtures are separate from the real PostgreSQL tests. No live business records,
partner accuracy findings, or hosted deployment are claimed.

The full serial frontend run passed all 414 tests with no failures or skips. Frontend typecheck,
production build, and lint passed; lint retained the three existing React Refresh warnings.
The first parallel check attempt exhausted host memory, so checks were completed sequentially.
The complete current-source Python suite then passed 671 tests and 14 subtests, with no failures
or skips, in 990.99 seconds using the isolated Python 3.12.14/PostgreSQL 16.15 environment
(249 dependency warnings). The schema contract check passed for all 20 tables. These checks
used synthetic test schemas and temporary SQLite fixtures; running application services were
not rebuilt or changed. The normal application rebuild/startup must apply migration 009 and
load the new code before these fixes take effect in a running installation.

## Product maintenance, stock movements, and frontend roles

Inventory has Products, Low stock, Sales ledger, Daily sales, Stock movements, and Account & settings tabs
(Account for staff). Owners can maintain SKU, name, category, unit, lead time, safety stock, and unit
cost;
verified stock-count corrections are a separate action using the existing audited product PATCH.
Low stock lists active catalog products at zero or at/below their displayed threshold, independently
of whether sales history or a forecast exists. It uses the current finite forecast reorder point
(demand during lead time plus safety stock) when available, with the existing inclusive boundary.
When demand is unavailable or expired, this Inventory view explicitly labels the product's saved
safety stock as an inventory minimum; it does not present that minimum as a forecast or suggested
order quantity. Overview and Restock retain their existing forecast-availability rules.
Out-of-stock products appear first. Search matches name, SKU, or category; count cards filter all
alerts, out-of-stock items, or low-stock items. Each row shows SKU, current quantity, counting unit,
threshold and its basis, and status. Current catalog quantities drive alerts after sales or deliveries.
Owners and staff can open the existing Record delivery dialog from an alert; its saved transaction,
retry safeguards, and permissions are unchanged. Inactive products are excluded from operational alerts.

The 2026-11-10 Low stock change passed 16 focused stock-rule tests and all 15 isolated Edge
browser groups, including historyless stockouts while forecasts load or fail, threshold boundaries,
search/status filters, owner/staff delivery access, and the 390px mobile layout. Frontend typecheck,
production build, and lint passed; lint retained the three existing React Refresh warnings.
Browser verification used intercepted synthetic HTTP with no live writes or model training.
The API/database contract, migrations, and forecasting implementation were not changed.
The local web service was rebuilt; HTTP checks confirmed the matching build, Low stock asset,
and healthy API. Database, API, and worker services were not restarted.

Daily sales is a separate date-based view with a calendar picker, previous/next day, Today and
Yesterday shortcuts, a clickable weekday strip, and an optional inclusive date range. Its grouped
product table shows sale date, name, SKU, quantity, unit, and total amount based on unit cost, with a separate
row for each product and sale date in a range. A case-insensitive name/SKU search filters the rows
and all summary totals together; the product count remains the number of distinct products.
Quantity and unit columns use a compact gap with consistent header/value alignment. Numeric
column headings and values are centered across Daily sales, Low stock, Sales ledger, and Stock
movements. Summaries use the complete
shared sales history across all API pages and both recorded/imported sale dates, including inactive
products' earlier history. Quantities retain up to three decimal places without forced trailing
zeros (`3`, `3.5`, `3.125`); thousands use comma grouping (`1,000`). Totals remain separate by
catalog counting unit. Business dates use the saved store timezone. Empty selections state that
no sales records were found without claiming a confirmed zero-sales day. Existing void exclusion
and the return policy apply: returns remain separate stock movements while the original sale stays
in history. This view consumes the existing sales/catalog contract and shared refresh behavior.

The 2026-11-10 Daily sales change and search/date follow-up passed 19 focused aggregation tests
and all 20 isolated Edge
browser groups, including full-history pagination, store-timezone dates, mixed counting units,
inclusive ranges, search and matching totals, actual dates per product row, quantity/unit spacing,
and the 390px mobile layout. Frontend typecheck and production build passed;
lint had zero errors and the three existing React Refresh warnings. Browser checks used synthetic
intercepted HTTP with no live record writes. No backend, database, or forecasting changes were made.
The local web service was rebuilt; HTTP checks confirmed matching build HTML, the Daily sales
Inventory asset, and a healthy API.

Inventory tabs have matching icons for Products, Low stock, Sales ledger, Daily sales, Stock
movements, and Account & settings (Account for staff). Products uses the Daily sales green/cream
palette, a labeled search/status toolbar, and expandable category cards with item-count pills,
green open headers, and rotating chevrons. Category disclosures retain native keyboard behavior.
Shared tabs and native select controls use green active/focus styling; product creation still
supports choosing an existing category or adding a new one with the existing SKU suggestion.
Inventory quantity displays and sale/delivery dialogs share the same trimmed-decimal formatter;
stored quantities, currency/metric formatting, and stock calculations are unchanged.

The later client-facing cleanup extends the green header design to Low stock and Returns &
write-offs. Routine screens omit database/storage narration, formulas, raw movement IDs,
processing timings, and range-calibration internals. Short instructions, stock-change consequences,
units, dates, validation/errors, forecast method/scores, test coverage, and unavailable/limited
evidence remain visible where useful. Account reference is collapsible; normal business stores
do not show a research/provenance label, while existing demo data keeps its explicit test label.
Evaluation questions, response scales, and saved results are unchanged; introductory and status
copy is shorter. Unexpected page failures offer a plain reload message instead of raw exception
text. Signup and recovery behavior is described under the account contract below.

This client cleanup passed typecheck, production build, and lint (zero errors, the same three
React Refresh warnings), 76 focused frontend tests, 19 isolated auth-browser groups, and 11
isolated client-screen browser groups. The browser checks used intercepted synthetic HTTP with
no live writes, including email/Google new-store payloads, reset-link rerenders, desktop/mobile
layout, green header/button contrast, stock dialogs and error recovery, and separate business/demo
labels. Existing forecast render verifiers were updated for the already-collapsible Restock
sections and searchable product picker; all 61 demand/interval cases passed after that harness
correction. Evaluation tests retained role, retry, final-submission and demo-provenance coverage.
Live Google-provider access and email delivery remain deployment checks. This work changes no
backend API/database contract and did not rerun Python tests. The local Docker web image was
rebuilt and updated; HTTP checks confirmed matching build HTML, the updated signup and Inventory
assets, and a healthy API with its database connected.

The 2026-11-10 Inventory styling follow-up passed frontend typecheck, production build, and
lint (zero errors, the same three React Refresh warnings). All 10 focused isolated Edge browser
groups passed, covering tab icons, category keyboard controls/search/status filters, category/SKU
previews, whole and fractional quantities, computed column alignment, and every Inventory tab at
390px without document overflow. Browser responses were synthetic and all writes were blocked;
there were no browser errors or unexpected endpoints. The local web service was rebuilt and
updated; HTTP checks confirmed the matching build HTML, updated Products asset, and healthy API.
No backend/database changes or Python tests were needed for this presentation change.

New product forms display an editable, automatically generated SKU before saving. Choosing or
typing a category regenerates that code. A clear category numeric sequence is continued with its
existing prefix and padding; otherwise the first three normalized category characters start a
code such as `STA-001`. Generation checks the full catalog, including inactive products, without
renaming saved SKUs. An uncertain creation retry retains its submitted SKU and request key;
editing that failed submission reserves the previous code for the rest of the open form.
These frontend suggestions use the existing API/database contract; simultaneous saves from
different browsers remain subject to the server's unique-SKU validation.

The 2026-11-10 SKU change passed 22 generator and 37 stock-maintenance unit regressions,
frontend typecheck, production build, and lint (zero errors, the three existing React Refresh
warnings). All 44 isolated Edge browser groups passed using intercepted synthetic HTTP, including
category previews, inactive SKU collisions, existing-product edits, and creation retries. The local web service was rebuilt;
HTTP checks confirmed matching build HTML, the updated inventory asset, and API health. These
frontend checks did not create live products, change the database contract, or rerun Python tests.

Cover days after delivery accepts a typed nonnegative whole number and retains the 3/7/10/14-day
suggestions. Moving Average window offers 3, 7, 14, 28, and 30 days using the existing settings API.
The Moving Average score description uses the completed forecast's frozen
`dataSnapshot.settings.moving_average_window`, carried into frontend result diagnostics, so
changing the current window does not relabel older scores while a replacement is queued or
running. Results without that saved setting show an unavailable window instead of guessing from
current settings. Browser-demo results retain the window used when their pipeline ran.
The setting is a local draft until Save settings succeeds. Its control identifies the saved
window and unsaved edits, and explains that the lookback used for each average is separate from
the accuracy test period. Forecasts shows a notice when the saved setting differs from the
completed result's window. Saving alone does not queue training; a new refresh captures the
saved setting. For example, a 14-day Moving Average may correctly retain 30 final-test days.
The desktop sidebar stays at the viewport's top while the main content scrolls; its own contents
remain scrollable on short screens.
Owners can activate/deactivate products without deleting their stock balance or historical
records. A separate owner-only Delete action confirms permanent removal of a product with zero
stock and no saved history. The business-scoped, CSRF-protected product DELETE preserves sales,
stock movements, saved forecasts/snapshots, reorder records, and quality reviews/audits by rejecting
deletion when any reference exists; no SQL migration is needed. Retrying an already deleted product
returns zero deleted rows. Browser-demo protects its stock, sales, and movement history as well.
Active/Inactive/All filters keep the complete catalog accessible. New sales, deliveries,
returns, write-offs, and operational forecast/restock displays use active products. Changing a unit
label does not convert existing quantities. Inventory snapshots retain the backend's existing
reactivation behavior, including in the browser demonstration.
Historical sales imports match the complete saved catalog, including inactive products, and
preserve both current stock and activation status. Importing earlier history does not reactivate
a discontinued product or make it available for new operational transactions.

Sales ledger pages through the complete history in 40-row pages. Owners can delete an individual
recorded or imported sale, or all imported sales, after reviewing a confirmation dialog.
Owner-only, CSRF-protected, business-scoped DELETE routes at `sales/{sale_id}` and
`sales/imported` remove imported records without changing stock or movement audits. Recorded-sale
deletion instead marks the sale voided, restores its quantity to current stock once, and appends an
adjustment identifying the sale and acting owner while preserving the original sale and stock
deduction internally. Voided sales are excluded from the ledger, sales exports, and future forecast
inputs. The additive sales-void migration preserves the previous migration history. Import audit
metadata remains saved. Exact-file duplicate detection permits reimport only after all accepted
rows in that batch have been removed; partially deleted batches retain their safeguard.
Deletion marks existing queued/running/completed forecast configurations `salesHistoryChanged`;
worker persistence preserves concurrent invalidation and dashboard reports those runs as stale.
Frozen forecast inputs and archived outputs remain intact. Browser-demo preserves synthetic rows,
restores stock with an adjustment when a recorded sale is deleted, recognizes earlier importer IDs,
and gives repeated imported IDs separate identities without resetting their quantities/history.
New demo imports save explicit source and unique IDs.
Committed deletions stay successful if the follow-up ledger read fails, with a reload notice.
Sales import/deletion refreshes retry a read when a sales write changes the cache during loading.
Verification on 2026-10-09 passed typecheck, lint (three existing React Refresh warnings), build,
12 frontend deletion regressions, six isolated Edge flows with intercepted API transport, and
412 Python tests with no skips using Python 3.12.14 and an independent disposable PostgreSQL 16.
The existing 20 sales-import and 22 auth-session frontend regressions also passed. Browser mocks
are separate from the real database checks; no live business records were deleted during testing.

Recorded-sale correction verification on 2026-10-15 passed typecheck, lint (the same three React
Refresh warnings), production and Docker builds, 21 frontend deletion regressions, 52 related
authentication/import/stock regressions, and nine isolated browser flows with intercepted API
transport. The full Python suite passed 469 tests and 14 subtests against a separate disposable
PostgreSQL 16 database, with no skips; all 24 deletion/SQLite cases also passed in the freshly built
image. These checks used synthetic test records and did not delete live business records.

Stock movements offers returns for owners/staff and owner-only write-offs. Returns increase usable
stock; write-offs decrease it and the form requires a reason. Both use the existing movement POST,
CSRF, and idempotency contract, with movement date, decimal quantity, and note validation. A saved
movement's balance belongs to its historical audit entry; current catalog stock is refreshed
separately from the products API. Its audit entry includes the existing
note, provenance, and recorded user ID. The searchable/filterable ledger loads all movement pages
on opening or Refresh and supports the existing authenticated CSV export.
CSV downloads in Sales ledger and Stock movements use outlined button controls. Products no
longer duplicates the stock-movement export; use Stock movements > Export CSV instead.
The existing authenticated download URLs and permissions are preserved. Quality and submitted
evaluation exports also retain their existing button controls.
Refresh reads again when a stock/catalog write happens during loading, so an older read cannot
replace the newly saved balance, audit entry, or product status. The existing response
does not include a creation timestamp or other users' display names; the UI does not invent them.
Backdated movements change current stock without recomputing earlier saved balances.

Record sale and Record delivery retain the submitted request identifier after a failed response.
Retrying unchanged fields reuses that identifier; changed submitted values or a completed save
start a new submission. Delivery retries also retain the original movement date across midnight.
This pending state belongs to the open form and does not survive a page reload. Sale retries can
reach the backend even after a catalog refresh shows lower or zero stock; server stock validation
and idempotency remain authoritative. A replay does not duplicate a loaded sale or deduct stock
again from an already refreshed catalog balance.

Deliveries, returns, and write-offs reconcile current stock through a guarded products read after
the backend confirms the saved movement. Replayed `balanceAfter` values remain in the audit ledger
and never replace current catalog stock, including when that follow-up read fails. A confirmed
save stays successful if stock cannot be refreshed; the ledger shows a notice to refresh its
balances. Unchanged pending write-off retries bypass the form's stock limit and the store's local
negative-balance check so the existing backend idempotency handler can confirm a write-off even
after stock refreshes to zero. The store matches the complete normalized payload and request key
within the submitting session; edited payloads and new keys retain ordinary stock validation.
The API/database contract, permissions, migration history, and browser-demo stock checks are
unchanged. Pending form submissions still do not survive a page reload.

Verification on 2026-10-20 passed frontend typecheck, lint (the same three React Refresh warnings),
production build, 24 stock-maintenance regressions, 63 related session/sales/import regressions,
and 11 isolated Edge browser checks. These used synthetic intercepted HTTP responses, including
lost delivery/write-off responses, intervening stock changes, failed catalog reads, and edited
retry payloads. A browser rerun timed out in an existing sale flow; the final clean run passed
all checks, and the timeout's cause was not confirmed. Python and PostgreSQL behavior was reviewed
against existing source; this frontend-only change did not rerun the Python/database suite or
write live business records.

Manual sales and historical sales imports reject dates after the current day in the business's
saved timezone before saving or changing stock. An import containing any future sale rejects the
whole batch. The sale date picker uses the same business-date upper bound; API validation remains
authoritative. Existing legacy future rows still trigger the forecast-history safeguard.

New deliveries, returns, write-offs, and dated adjustments reject movement dates after the
business's current day in its saved timezone before changing stock or writing an audit record.
The return/write-off picker, submit handler, and shared store apply the same boundary; delivery
defaults also use the business timezone rather than the browser's calendar date. PostgreSQL and
the optional SQLite API enforce the check independently of the browser, while ordinary backdated
corrections remain supported. An unchanged pending retry can still reach the backend to confirm
an existing saved movement if a timezone change makes its original date appear future-dated;
if the original was not saved, backend validation rejects the new future-dated write.

Movement-date and saved-window verification on 2026-10-20 passed frontend typecheck, lint
(the same three React Refresh warnings), production build, 101 frontend regressions, and 28
isolated Edge browser checks. The complete Python suite passed 572 tests and 14 subtests with
no skips using Python 3.12 and a separate disposable PostgreSQL 16 database, including 27 new
movement-date cases covering saved timezones, rollback, past dates, retries, and optional SQLite.
The forecast browser verifier's earlier CDP launcher failed before navigation; its final run
passed all 11 checks using the same Playwright Edge launcher as the 17 movement checks. Browser
responses and database records were synthetic; no live business records were changed. SQL
migration history and forecast calculations are unchanged. The disposable test database and
temporary browser servers were removed after verification.

Verification on 2026-10-16 passed frontend typecheck, lint (the same three React Refresh warnings),
production build, 143 related frontend regressions, and 15 isolated browser checks covering
transaction retries/date guards and forecast status polling. Python 3.12.14 with a separate
disposable PostgreSQL 16 database passed 535 tests and 14 subtests with no skips; the final
dashboard/status subset also passed all 26 tests. Browser interception fixtures and synthetic
database records remain separate from client findings. These checks did not use live business data.

Shared frontend capabilities mirror the Python permissions: owners manage products, imports,
business/model settings, staff access, and manual forecast refresh; owners/staff record sales, deliveries,
returns, and reviewed data-quality classifications and access records/exports. Personal account
and password controls remain available to staff. Backend authorization remains authoritative.

Browser-demo keeps the existing storage key and records new movement audits separately from its
synthetic sales; previous history is not assigned invented audits. Explicit Reset demo clears these
new audits along with the existing demonstration reset. Stock-movement and product-detail
maintenance retain the existing database schema, migration history, and backend permissions.

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

## ZIP startup and private configuration

The launcher retains a private user-profile copy of `.env` per Docker context/Compose project
and restores it into a new extraction when the local file is absent. Existing `.env` takes
precedence. API/worker/web processes stop before database recreation, avoiding stale connections
when extraction paths change. PostgreSQL health waits for the final TCP listener rather than
the socket-only initialization server. After readiness, startup checks both database roles' actual TCP authentication
before initializing. Password checks use the API's Docker-network hostname rather than
PostgreSQL's localhost trust path; CI independently rejects a wrong application or administrator
password. Mismatched legacy **local development** credentials can be aligned using a
container-local admin transaction without removing volumes or changing application password
hashes. Initial owner bootstrap is serialized on the business row and does not add an owner
to an already-owned store when a new ZIP supplies a different seed email. Hosted/public-domain/remote configurations never receive automatic password repair;
existing hosted API containers are checked before any database recreation. This changes deployment
handling only, with no API/schema/migration or forecasting change. Configuration copies do not
replace database backups or transfer business records. See [setup and operations](SETUP_AND_OPERATIONS.md).
Regression checks are in `scripts/test-startup.mjs`; the system workflow exercises independent
ZIP-like folders, actual role-password repair, record counts, and unchanged user password hashes
through `scripts/verify-zip-startup.mjs`. A workflow definition is not a completed runtime result.

## Account and Google access contract

The owner approved the durable account-activity contract on 2026-11-10. **Sign-in activity** in
Inventory > Account & settings shows actor name/email/role, action, and store-timezone timestamps,
with server search/action filters, refresh, and cursor pagination. The event list has a fixed
320px desktop/288px mobile height and scrolls internally as logs accumulate, keeping the card size
and store settings stable. Owner-only `GET /api/v1/auth/activity` derives its business scope from
the authenticated session. Additive migration `010_account_activity` creates
`account_activity_events` with identity snapshots and database-clock event timestamps; migrations
001-009 remain intact. Successful session starts and their events are atomic, as are explicit
session deletion and sign-out events. Google identity linking refreshes its existing access without
creating a false sign-in. Password reset, account deactivation, expiry, and browser closure are not
labelled explicit sign-outs. No older events are backfilled and no credentials or session tokens
are stored in the log. Staff cannot read it; the browser-only prototype does not invent shared
account activity. An older API's 404/501 response shows **Sign-in activity is not configured**.
See the [account activity contract](../backend/docs/ACCOUNT_ACTIVITY_CONTRACT.md).

The 2026-11-10 activity change passed 32 focused real-PostgreSQL cases and all 15 isolated Edge
browser groups, including atomic rollback, concurrent sign-out, Google linking, identity snapshots,
owner/business isolation, full-history filters, cursor ties/retries, session guards, and mobile
layout. Typecheck, production build, and lint passed, with the three existing React Refresh
warnings; the 21-table structural schema contract passed. Browser traffic used synthetic
intercepted HTTP; database tests used Python 3.12.14 and a separate disposable PostgreSQL 16.

The complete Python run finished with 546 passed, 143 failed, 14 setup errors, and 14 passed
subtests (no skips). All 157 failure/error cases report the existing missing `products.brand`
column: repository/schema code expects `brand`, `model`, and `variant`, while migrations 001-009
do not create them. This product source and migration history match HEAD; the failure also
reproduced with the original authentication repository. A read-only inspection confirmed that the
running local database already has those three columns. Adding their missing migration remains
a separate database-design decision; the activity change does not alter product columns.
The initial broad test attempt used an authentication-only image lacking XGBoost and was discarded;
the reported complete run used the full backend image, including XGBoost 3.0.2.
The approved activity migration was applied locally and the API/web services were updated.
HTTP checks confirmed matching build HTML, the activity screen asset, healthy API, and rejection
of an unauthenticated activity request. Database and worker services were not restarted. Runtime
checks used schema metadata and read-only HTTP; no fake live account activity was generated.
The fixed-height activity-box follow-up passed all 16 Edge browser groups, including equal card
height with 1, 50, and 53 logs, internal scrolling to the last event, and mobile fit. Frontend
typecheck, production build, and lint passed (the same three existing React Refresh warnings).
This follow-up changes presentation only and did not rerun Python/database tests.

Startup generates private owner credentials only when both the local `.env` and its saved private copy are absent. README contains no shared
owner password. Existing owners change their password through Inventory > Account & settings >
Account maintenance; editing `.env` or restarting does not update an existing password hash.
Removing a documented credential does not itself rotate any deployed credential.
Current and new password fields start masked and each has an eye with Show/Hide controls for
the entered value. They do not retrieve a saved password; the existing password-change API,
validation, and session revocation are unchanged.
Account maintenance omits the helper sentence beneath the current password field. Its password
form includes the signed-in email as a read-only username field and named current/new password
inputs with native autocomplete, so browser-owned password managers can recognize the account.
Autofill depends on the browser and a matching saved credential; StockCast does not promise it
or store a recoverable application password.

Owner staff lists use session-authenticated GET without a CSRF header; all account mutations retain
CSRF and Origin protection. Account maintenance shows loading, failure, Retry, and an explicit empty
staff list, and prevents duplicate management submissions. The existing owner/business restrictions
and staff session revocation remain enforced by the repository.

Each public signup creates its own owner store with default settings and an empty catalog.
The existing PostgreSQL UUID default generates the Business ID for both password registration
and first-time Google store setup; Inventory account controls exposes it under Your account >
Store reference. Public signup and first-time Google setup no longer offer a test-record selector.
New stores use the existing `dataOrigin: "partner"` request value after an explicit, unchecked
permission confirmation. Both paths create empty catalogs; this operational provenance label
does not establish a research partner or findings. Existing demo stores and browser-demo data
remain visibly identified and are not migrated, deleted, or relabeled. Signup passwords are
12 to 128 characters.
An email can now be reused to create another store, using the existing password to verify
access to an active account with that email. Each store retains its own user ID, password
hash, role and business-scoped records; no accounts are merged. Repeated signup with the
same normalized store name/location is rejected. Email/password sign-in asks which store
to open when credentials match several active stores; optional Business ID login remains
available. Store names are disclosed only after password verification, and selection
rechecks credentials before issuing a session. Recovery sends one email containing an
independent, single-use link for each matching store (or only the supplied Business ID).
Changing one store's password does not change its other store accounts. Google links keep
their existing store association. This 2026-11-14 change uses existing tables and migrations.
See [the multi-store email contract](../backend/docs/MULTI_STORE_EMAIL_CONTRACT.md).

The email-reuse change passed 40 focused Python cases, 38 frontend cases and all 20
synthetic Edge auth browser groups, plus typecheck, build and lint (the same three
warnings). The full Python suite finished with 574 passed, 143 failed, 14 setup errors
and 14 passed subtests; the same 157 product-schema failures described above remain.
API and web were updated locally; matched web assets, API health and the new endpoint's
OpenAPI entry were verified read-only. Database and worker services were not restarted,
and no real account or recovery email was generated for verification. See
[the full email-reuse verification record](MULTI_STORE_EMAIL_VERIFICATION.md).

Sign-in, account creation, recovery, and token password forms use synchronous submission guards
and disable their controls while a request is pending. Password fields have visible labels and
accessible show/hide controls while preserving browser autocomplete. Switching access screens
clears passwords, confirmation, prior feedback, and the explicit browser-save choice. Successful
authentication returns the access screen to Sign in for a later logout. If an authentication POST
succeeds but reading store records fails, the page states that sign-in/account creation/setup
succeeded and offers reload guidance; the existing cookie can reload the store without another
registration request. Old tenant records are not displayed in that failure state.

Password reset retains the initial URL token in component state after clearing it from the
address bar. Rerenders therefore keep the password-reset form open until the flow finishes.

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

## Sales forecasting review — 2026-11-13

The normal Python forecasting implementation and API/database contract remain unchanged.
Two new synthetic worker tests run real CPU XGBoost and check 30 matching final-test dates
and 30 future dates for Moving Average, XGBoost, and ensemble; saved MAE/RMSE are recomputed
from the persisted quantities. They also check training-only eligibility, validation-based
operating selection, ensemble weights, model artifacts, and historyless products.

Forecasts now initially displays 30 future days, within the completed run's saved predictions.
Changing its chart horizon does not retrain or invent extra predictions. Each model line is a
direct Recharts child: the installed React/Recharts combination omitted the lines nested in
a fragment. Disabling comparison keeps Actual and the operating method's predicted line.
Calendar gaps remain null, dates use elapsed calendar spacing, and weekly/monthly aggregation separates
final-test actuals from future estimates. Missing model values stay unavailable. Weekly totals
do not add daily marginal intervals into a purported weekly interval. Quantity scores keep their
original day/week basis when the chart changes view.

The optional browser prototype now uses training-only scope/ranking, separate validation and
reserved calibration, recursive final-test predictions, frozen method/weights/tree count, and a
fresh operational refit. Model comparison uses matching products/dates and counting units/grain;
untrained ML/ensemble scores are unavailable. Non-demo imports use contiguous observed tails
without inserting unknown zero-sales dates. Generated seed/fallback rows carry demo provenance,
and the fallback is correctly labeled synthetic. The browser cache includes historical record
contents and the nonzero-day setting; its policy version invalidates older forecast calculations
without resetting stored sales or inventory.

See [the forecasting verification report](FORECAST_MODULE_VERIFICATION.md) for executed checks,
environment limits, and remaining partner/data-policy decisions. These are engineering checks
with synthetic records, not client findings or a guarantee of future sales accuracy.

The later 2026-11-13 chart-history follow-up restores saved predictions for elapsed dates
between the final-test series and current future estimates. Forecasts reads the existing
authenticated, paginated run-predictions endpoint only when that product has such an interval
(or the saved run has expired). Results are reused for product switches within the same run
and guarded by session/run identity. Earlier forecasts are shown as predictions, with actuals
left null; missing archive records still leave a gap, and failed reads offer Retry.
This is chart-only data: current future predictions, demand, stock advice, final-test metrics,
confidence, and expiry behavior remain unchanged. No API or database schema change is needed.

Chart options shows Daily/Weekly/Monthly view and Compare models directly. At the owner's
request on 2026-11-14, Days to show and the Advanced options disclosure were removed. The
forecast period is managed in Inventory settings; charts use the displayed completed run's
saved horizon and available prediction dates, including while new settings await a refresh.
Legacy chart-day preferences are ignored so they cannot hide saved predictions. Initial display
remains Daily with Actual sales and the chosen forecast, using the product's counting unit.
Saved forecast settings, all model score cards, archived chart predictions, intervals, product
selection, and the error table remain available.

View, chart style and comparison choices persist in browser storage separately for each
business/account (and separately for the optional demo). Monthly totals summarize only available
daily dates, keep test/future periods separate, and identify partial months; they neither extend a
saved forecast nor sum daily intervals into a monthly confidence range.

Sales report and forecast chart choices were expanded on 2026-11-14. Sales report now offers
Single day or an inclusive Date range, preserving separate input drafts when switching modes.
Untouched defaults follow asynchronously loaded sales history, dates use the store timezone,
and empty, invalid, reversed, or future selections do not display stale report totals.
Sales trends offer Bar, Line, and Area charts, with quantities separated by counting unit and
missing calendar dates left unknown. The Pie option shows each product's share of sales
records, not quantity or revenue. More than eight products use seven leading products and
an Other slice, including every matching record. Product/date filters apply to all charts
and report summaries.

Forecasts offers Line, Area, Candlestick, and Step views of the same actual/predicted quantities.
Chart type persists alongside the existing account/store-specific view preferences. Changing
chart type does not retrain models, extend the saved horizon, combine actuals with forecasts,
or change MAE/RMSE. Calendar spacing, null gaps, chosen-method comparison, and available
prediction intervals remain part of the chart. These changes use the existing API/database
contract. See [the date and chart verification record](SALES_REPORT_CHARTS_VERIFICATION.md).

This follow-up passed typecheck, production build and lint (the three existing warnings),
44 focused unit/render cases, and 26 isolated Edge browser groups. The local web service was
rebuilt and updated; HTTP checks confirmed matching build assets and a healthy API. Browser
fixtures used synthetic intercepted HTTP, with no live business-record writes. Python and the
full frontend suite were not rerun for this frontend-only change.

The later 2026-11-14 forecast style follow-up replaces Forecasts' Bar option with Candlestick
and Step; Sales report keeps its existing Bar option. Saved forecast Bar display preferences
open as Candlestick. Step uses horizontal/vertical segments between dated quantities and
preserves null gaps. Sales candles use recorded actual and chosen forecast quantities as body
endpoints; their whiskers use the exact saved estimated range when available. Future dates
have forecast markers and available range whiskers, without invented actuals or financial
open/high/low/close data. Compare models keeps the other model traces available. All forecast
styles use the same wrapping line-and-circle legend, with readable range labels, above the
existing range-evidence panel. The frontend-only display change does not alter model fitting,
selection, stored quantities, or MAE/RMSE.

The forecast style follow-up passed 37 focused forecast/interval tests, all 15 isolated Edge
browser groups, typecheck, build, and lint (the same three existing warnings). The local web
service was rebuilt and updated; HTTP checks confirmed matching assets and API health.

The subsequent 2026-11-14 report follow-up gives the Other pie slice a muted blue color and
places percentage labels outside the circle with connectors and collision spacing. Record
a sale supports name/SKU search without changing the selected product until an explicit
choice. Sales report labels its totals Sales records and Estimated value per record, and
explains that imported daily product totals count as individual records. A read-only local
database audit reproduced the screenshot's four-record product totals and 362-record pie
denominator from the supplied `Sales_One_Year_SIMULATED (1).csv` import; equal record counts
come from daily product rows, while quantities differ. No stored records or database/API
contracts changed. See [the record audit and verification](SALES_RECORDS_AND_SEARCH_VERIFICATION.md).

This report/search follow-up passed all 22 related chart/form cases and 14 isolated Edge
browser groups, plus typecheck, build and lint (the same three warnings). The local web
service was rebuilt and updated; HTTP checks confirmed matching assets and API health.

## Shared interface and sale picker refresh — 2026-11-14

Record a sale now opens a styled product dropdown with its name/SKU search inside the
expanded picker. Results show stock and SKU, keep the existing selection while typing,
and support keyboard selection, Escape, focus return and outside dismissal. Home/End
retain native cursor movement in the editable search. Opening the picker clears its
query; selecting a result does not submit the sale. Existing validation and retry behavior
remain in place.

Shared cards, controls, dialogs, typography, chart colors and navigation use a coordinated
sage/ivory theme. The Sales report summary uses equal-height cards with separate bounded
quantity/unit rows, preserving unlike units and full currency values. Mobile navigation
keeps all seven routes on one row, and the sticky header stays above page filters. Sales
chart tooltips wrap long labels and remain contained after resizing.

A light-green canvas network now adds slow decorative movement behind the authenticated
shell, adapting the owner's supplied LATTICE ZIP to the existing sage/ivory theme. Its
React-owned renderer replaces the standalone script's global injection and negative layer.
Dots, curved connections, travelling signals, mouse parallax and gentle click ripples stay
behind opaque content; touch gestures remain available for scrolling. CSS glows provide a
fallback if canvas is unavailable. No external dependencies or network assets are required.
Its existing pause/resume preference persists locally; operating-system reduced motion keeps
a still image, hidden tabs and printing stop the renderer, and print omits the decoration.
Rendering targets at most 30 frames/second, 36–110 points (at most 48 on narrow screens),
device scale at most 1.5 and approximately 1.6 million canvas pixels. Resizing and context
restoration redraw safely; unmounting removes its observers, input listeners and animation
frame. Decoration is hidden from assistive technology and cannot intercept input. No backend
contract, database or forecasting calculation changed.
See [the interface verification record](UI_REFRESH_VERIFICATION.md).

The 2026-11-14 palette follow-up uses a cooler mint page background and teal network,
with a deeper sage desktop sidebar, pale green store/selected-navigation panels and
matching mobile navigation. Ivory content cards and chart-series colors stay intact.
The latest staff-invite screenshot reports the existing SMTP authentication error;
sender authorization remains unresolved and is independent of the palette change.
This palette update passed typecheck, production build, lint (the same three warnings)
and all seven existing synthetic background browser groups, including mobile overflow
and motion controls. The desktop screenshot was also visually reviewed.

The owner's subsequent color adjustment deepens the page to soft sage and the desktop
sidebar to forest green, matching the primary green controls. Sidebar labels use pale
text; the store card and selected route retain light surfaces and dark readable text.
Mobile navigation uses a deeper pale green. The owner reports email is now working;
no new live delivery check or email-configuration change was performed for this styling task.
Typecheck, build, lint (the same three warnings), and the seven synthetic background browser
groups passed again for the forest-green palette; the desktop screenshot was visually reviewed.

The LATTICE adaptation on 2026-11-14 passed seven focused background lifecycle/rendering
browser groups and all 15 forecast browser groups, plus typecheck/build/lint (the same
three warnings). Browser checks used synthetic intercepted HTTP and 390px touch/high-DPI
emulation, including unavailable canvas and simulated context loss/visibility. Physical
phone hardware and Safari remain unverified. See [background verification](LATTICE_BACKGROUND_VERIFICATION.md).

The earlier interface refresh passed 63 focused frontend cases and 60 synthetic Edge browser groups,
typecheck, production build and lint (the same three existing warnings). Only the local
web service was updated; matching HTML, JavaScript/CSS assets and API health were verified.
The full frontend and Python suites were not rerun for this frontend-only change.

## Product photos and bounded record panels — 2026-11-13

The owner approved one optional product photo in PostgreSQL, editable by owners and viewable by
signed-in members of the same store. Additive migration `011_product_photos` stores normalized
WebP bytes with a composite business/product foreign key and deletion cleanup. Existing product
JSON fields and earlier migrations are unchanged. Photos have independent metadata reads and do
not change stock, sales, product forecast revisions or saved predictions. Backend dependencies now
include Pillow; normal database dumps include the photo table. The optional browser demo uses
separate local photo storage, cleared only by explicit demo reset. See the
[photo contract](../backend/docs/PRODUCT_PHOTOS_CONTRACT.md) for endpoints, limits and permissions.

Inventory product cards provide Add/Change photo, a file preview, supported-device camera capture,
replacement and removal. Create/import the product first, then add its photo. Sales report filters
now have a stacking context above summary cards so their searchable product list stays visible.

Growing catalog/category lists, sales and stock tables, forecast product/error tables, Restock
groups, staff accounts, reviewed dates and CSV product-match lists now have viewport-aware maximum
heights and internal scrolling. Table headings stay visible while scrolling; filters/pagination
remain outside the bounded rows. Existing bounded activity logs, CSV previews, dropdowns and guide
reader remain available. Dialogs also fit within the viewport and scroll on short screens.

The scroll-boundary follow-up restores native scroll chaining: reaching a panel's top or bottom
allows wheel scrolling to continue to its parent/page. Sticky table heading cells now have an
opaque shaded background, so translucent row-group utility styles cannot reveal rows underneath.
The production Edge verifier checks actual mouse-wheel handoff at both edges, opaque heading
cells across the record tables, and unchanged heading pixels while low-stock rows scroll.
All seven extended browser groups passed, alongside typecheck, build and lint (the same three
existing warnings). Only the local `stockcast` web service was rebuilt/recreated for this CSS
correction; HTTP checks confirmed the matching CSS and healthy API. API, worker and database
services were not recreated and no business records were changed.

The 2026-11-14 selling-table alignment follow-up gives headings and values matching horizontal
padding, centers heading text vertically, and fixes the product/SKU/quantity/stock proportions at
40/20/20/20 percent. A minimum table width keeps numeric labels readable on small screens, with
horizontal scrolling inside the existing panel; long names and SKU identifiers wrap. Filtering
to one product no longer changes column widths. Least/Best selling, ranking, quantities, search
and the existing scroll behavior are retained. Typecheck, build and lint passed (the same three
warnings), and all eight extended synthetic Edge browser groups passed, including measured
heading/value alignment, one-row filtering, ranking switches and the 390px long-name layout.
The local web service was rebuilt/recreated, with matching served HTML/Inventory assets and
healthy API confirmed over HTTP. API, worker, database and business records were unchanged.

The later 2026-11-14 follow-up applies matching heading/body padding and stable, responsive
columns to Sales ledger, Product performance, Top products for XGBoost and Past forecast errors.
Numeric headings and values share alignment; filters, pagination, record actions, quantities,
metrics and model selection remain intact. Least/Best selling retains its earlier correction.

Take photo now opens a live `getUserMedia` video preview rather than a file-input capture hint.
It requests no microphone, prefers a rear camera while allowing desktop webcams, and offers
exposed camera devices for selection. Muted inline playback supports phone browsers. Capture
creates a JPEG within 960 pixels for the existing preview/Save flow. Cleanup covers capture,
cancel, dialog/account changes, device switching, page hiding and late permission grants.
Choose photo remains a separate file picker. Permission/no-device/busy/unsupported/insecure
failures give an actionable message. Phones using the PC's plain-HTTP LAN address need trusted
HTTPS for live access; desktop localhost is a secure-context exception. See the
[camera setup instructions](SETUP_AND_OPERATIONS.md#product-camera-on-phones-and-desktops).

Typecheck, build and lint passed (three existing warnings), along with 18 forecast unit tests
and 21 synthetic production Edge browser groups. The latter include actual fake-device video,
captured JPEG/CSRF upload, stream cleanup/error races, and measured desktop/mobile table layouts.
The browser fixture day remains 13 November; the checks were rerun on 14 November. Physical
Android/iPhone camera hardware and the final trusted-HTTPS installation remain separate checks.
No API, database or forecasting algorithm change was needed for this follow-up.
The compact ledger keeps all five owner columns, including Delete, visible in the normal 1440px
desktop layout beside the import panel; small screens still scroll internally. The local web
container was rebuilt/recreated with the final camera and table bundle. Served HTML and
Inventory/Sales report/Forecasts assets match the tested build, API health passed, and a read-only
OpenAPI check confirmed that the existing running product-photo endpoints are present. API,
worker, database services and business records were unchanged.

See [the follow-up verification record](PRODUCT_PHOTOS_AND_SCROLL_VERIFICATION.md). Source checks
and synthetic verification do not deploy these changes or constitute partner findings. A normal
rebuild/start is required to install Pillow, apply migration 011 and serve the updated frontend.

## Forecast contract

Future forecast horizons in settings and forecast creation both accept 1–365 days.
The Python settings request schema rejects values outside this range before saving;
invalid requests leave the previous settings unchanged. This limit applies to future
predictions, not the age or length of historical sales used for training. Boundary
regressions are in `backend/tests/test_settings_horizon.py`.
The existing Forecast horizon control accepts typed whole numbers from 1 to 365,
with 7/14/21/30-day suggestions. An inline warning explains values above 365 or
other invalid entries; Save settings stays disabled until the number is valid.
Drafts remain local until a successful save, and saved values display on reload.

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
- The Python dashboard supplies `modelComparison` for validation and final testing. Each split
  pools only matching active products with valid, positive, equal per-method observation counts.
  Final-test comparisons also require identical saved product/date actuals, unique dates, and
  prediction counts matching each metric. Incomplete cohorts are withheld. With no ML products,
  a separately identified Moving Average-only score is available when its saved test is valid.
  Missing legacy comparison metadata is unavailable rather than recomputed from unequal cohorts.
  The displayed selected model uses validation scores only; no selection badge appears without
  valid validation evidence. Python fallback demand is labelled Moving Average, including its
  selected-method final-test denominator; expiration retains the saved operating method.
- Python intervals are available only when validation contains at least 20 usable observations:
  the later segment reserves at least 10 residual observations after method selection. Fixed
  10th/90th residual quantiles give a nominal 80% band for the operating method, clipped at zero.
  Saved evidence includes selection/calibration counts and calibration dates, residual offsets,
  and untouched final-test coverage. The UI shows range-check counts/dates, target coverage, and
  final-test coverage/denominator; calibration formulas and raw offsets stay out of client screens.
  Small time-ordered samples and later model refits do not guarantee future coverage. Missing
  legacy metadata is reported as unknown, and expired runs retain archived calibration evidence.
  Browser-demo bands are illustrative. No certified accuracy is claimed; `xgboost_verified`
  remains false. Operational pages use Python `forecastEvidence` and `forecastConfidence`.
  The `past_test_wape_v1` app rating recomputes absolute error from the operating method's matching
  saved final-test predictions and divides its sum by total actual sales. High (at most 20%)
  and Medium (at most 50%) require at least 14 consecutive tested days with positive total actual
  sales. Larger errors, shorter/gapped tests, all-zero tests, and untested previews receive Low
  with explicit reasons. These are disclosed display thresholds, not probability estimates,
  universally established statistical minima, or new model-selection criteria. Confidence
  describes past support for the estimate, separately from expected sales volume.
  Refresh needed, No current estimate, and Expired forecast override confidence; cached ratings
  are withheld at business midnight with advice itself. The UI shows actual test-day counts,
  average quantity errors, and the relative past error; older API metadata retains neutral
  evidence labels instead of inventing grades. `confidenceLevel` retains its required enum for
  compatibility, but the operational badge uses the structured policy/level/reason.
  Shared Forecasts/Restock evidence compares each product's saved test observations with the
  completed run's canonical `forecastHorizonDays`. A shorter test says, for example, "Accuracy
  checked on 14 of the requested 30 days. Test evidence is limited." Current settings, queued
  replacements, and snapshot defaults do not supply that denominator; an explicitly requested
  run horizon can differ from the settings snapshot. Legacy missing/invalid horizons and
  untested previews retain their existing evidence. This disclosure changes no forecast,
  interval, model-selection, or confidence calculation.
  New previews cannot inherit older model test results. Demo badges
  say Demonstration. The legacy `lowConfidenceCount` diagnostic counts products with fewer than
  30 nonzero training sales days; it does not classify measured forecast accuracy. Sparse counts
  use observed zero-day share rather than assuming every product excluded from ML is sparse.
- Forecasts includes a Top products for XGBoost panel. The worker persists `trainingScope`
  in its existing configuration JSON, and the read-only dashboard can reconstruct older
  selections from frozen prepared targets, saved eligibility, and the captured ML limit.
  Selected products use training-period quantity ranking and the worker's product-ID tie break;
  validation/final-test sales and current live sales never influence the saved list. The panel
  shows rank, active product name/code/unit, training quantities/dates, expected sales per day,
  and the structured confidence rating. A limit of five means at most five qualified products,
  not five guaranteed future best sellers. Changing a limit preserves the saved limit/list
  until a new completed refresh; deactivated products leave the active view without rewriting
  the saved selection. Missing legacy inputs produce an unavailable list, not inferred ranks.
  No SQL migration, training algorithm replacement, or extra frontend/backend runtime is needed.
- Forecasts shows product results only, with no Overall results option. It initially selects the
  active product with the highest saved training rank and returns to that product when a new
  completed run arrives. Manual choices survive ordinary polls and queued/running replacements.
  The existing API run ID identifies completed results; the optional browser demonstration
  generates an ID only for completed training, while legacy results fall back to their saved
  training timestamp. Missing legacy ranks use deterministic SKU/product-ID order, preferring a
  product with results, without inventing a rank. The dropdown switches MAE/RMSE, chart, and
  evidence together. Different counting units retain per-product scores. Products outside the ML
  selection retain Moving Average results and unavailable ML scores; switching products does not
  select models from final-test errors or change saved forecasts. Overview retains its existing
  aggregate/unit safeguards and includes a compact green Forecasts button inside the MAE card.
  An unavailable MAE omits the dash placeholder while retaining the explanatory hint.
- Client page headers omit the introductory sentences on Overview, Restock, Forecasts, Inventory,
  and Strategies. Overview also omits the duplicate date above Morning briefing; the shared
  upper header retains its date. The shared forecast banner omits the repeated daily schedule sentence, while
  retaining update progress, saved forecast status, expiration, and errors. Strategies contains
  only User guide and Evaluation in both API and browser-demo modes; removed or unsupported tab
  queries open User guide. Methodology/thesis documents remain in the repository outside the
  client interface. Existing guide links and the `/methodology` route remain compatible.
- Forecasts, Restock, and Quality use short retail wording.
  Wording-only requests must preserve the existing cards, positions, styling, and visible data;
  do not add disclosures or move/hide sections without the user's request. The owner's later
  client cleanup retains inline MAE/RMSE cards, the all-product table, selection summary, and
  useful range evidence, while omitting the processing-time panel and internal calculations.
  Forecasts uses the product-only selector described above. Restock keeps stock, expected sales, reorder point, stock cover,
  suggested order, and delivery actions visible. Its metadata shows SKU/category, with test
  errors, confidence reasons, and missing/excluded-day counts under closed Forecast details.
  Unavailable estimates, fallback reasons, shortened-test limitations, and actionable quality
  warnings remain outside that disclosure. Forecasts uses concise evidence descriptions. Forecast
  copy controls remain removed and CSV export buttons remain available. The chosen-method badge
  still uses earlier validation. Quality labels retain existing classification values, override
  rules, audit export, and permissions; an empty review list makes no claim that the store has no
  records. These presentation changes do not change API, database, model, or inventory policy.
- Normal Refresh grows the final test to the configured forecast horizon when history can retain
  the configured training eligibility/CV reserve and at least 20 separate validation days. With
  default training requirements and a 30-day horizon, 140 complete daily observations allow a
  100/20/20 split, 150 allow 100/20/30, and 158 allow 100/28/30. Less history automatically uses
  a shorter test; the existing compact split remains for short histories, with unavailable
  intervals when validation is too small. The same plan applies to scheduled refreshes. Existing
  saved runs retain their original test periods until a new refresh. Planned calendar counts do
  not replace per-product usable observations or nonzero-day gates, and final-test actuals never
  select the model or calibrate intervals.
- Absent dates are not zero-filled. Audited `confirmed_zero` dates are eligible observations; closures, incomplete records, and full/partial stockouts are excluded. XGBoost conservatively requires a complete observed-or-confirmed-zero daily training sequence so calendar lag spacing is preserved. Confirm this policy with the partner before research evaluation.
- The Data quality screen records store-wide or product-specific classifications with an immutable
  audit log and CSV export. Classification upserts and deletes acquire the existing business row
  lock before reading prior state, so concurrent first writes preserve created/updated/deleted
  actions and the actual previous classification/note. Each revision uses one database clock
  timestamp captured after the lock for the classification and audit entry; forecast snapshots
  capture their database timestamp after the same lock. Migration history and API fields are unchanged.
- Overview, Restock, and Forecasts distinguish unavailable history/current advice from usable
  zero demand. Overview omits the Demand evidence section at the owner's request; its restock
  queue and summary notices remain. Restock and Forecasts show saved fallback reasons,
  unknown/excluded-day counts, and quality warnings;
  absent legacy counts are shown as not saved rather than zero. Delivery recording stays available.
  Forecast-run snapshots retain the classifications used by the worker.
- The Python worker automatically queues the most recent due daily forecast slot, by default at
  00:15 in each business's saved timezone. The database clock determines the slot; only history
  through the preceding completed business day enters an automatic run. Startup catches up the
  latest due slot rather than backfilling every missed day. Owners retain explicit Refresh controls;
  staff need no manual refresh and see queued/running/completed/failed outputs through the existing
  five-second status poll. Schedule claims require enabled metadata from the API.
- The browser polls the authenticated `forecast-status` revision endpoint every five seconds and
  reads the full dashboard when persisted inputs/run status change or local records/settings change.
  The revision observes sales additions/removals/voids, catalog/settings/quality changes, forecast
  transitions, the business day, and schedule metadata without loading/preparing daily histories.
  Dashboard preparation groups sales, quality classifications, and future predictions by product
  once instead of repeatedly scanning the complete lists for each product. Database schema and
  saved forecast behavior are unchanged. Older/optional SQLite APIs without the status route retain
  full-dashboard polling through a 404 fallback.
  The [preparation benchmark](../scripts/benchmark-forecast-dashboard.py) uses 100 synthetic products
  and 36,500 daily sales rows, reconstructs the former repeated scans, and checks response equality.
  Its five-run in-process measurements exclude PostgreSQL and HTTP; they are engineering checks,
  not client findings or an end-to-end latency claim. A separate authenticated
  [ASGI/PostgreSQL benchmark](../scripts/benchmark-forecast-endpoints.py) with the same synthetic
  row count measured median dashboard/status requests of 1,379.294/39.072 ms and response sizes of
  477,100/88 bytes; see the [five-request raw report](benchmarks/forecast-endpoints-2026-10-16.json).
  It includes real database reads and API serialization, with no saved forecast run, and excludes
  network transport and browser rendering. Actual partner-scale performance still needs measurement
  against permitted data volumes and deployment conditions.
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
  phases stay null, and legacy phase scopes are unknown. These times remain saved for engineering
  review; the client Forecasts screen omits the timing panel. Total processing is never
  substituted for model training. API and actual Edge browser benchmarks
  have separate procedures and raw reports; synthetic measurements are not client findings.

The custom browser boosted-tree code is not the official XGBoost package and is isolated to
demonstration mode. The normal frontend displays Python outputs and does not trigger that prototype.

## Boundaries and delivery checks

The follow-up [logic audit and fixes on 2026-10-20](LOGIC_AUDIT_2026-10-20.md) reproduced six
issues and addressed them sequentially. Stock counts retain their request identity across an
unchanged retry; product creation retains both its generated SKU and request key. Confirmed count,
creation and metadata saves read the current catalog instead of using historical response stock.
Late metadata acknowledgments also preserve a newer product object and its known stock. A failed
follow-up read displays a refresh notice while keeping an acknowledged save successful.

Dashboard responses add `sharedState` with the full catalog, including inactive products, and the
canonical settings used for advice. Revision polling synchronizes these inputs together and
observes profile changes. Unchanged values preserve store references, avoiding dashboard loops;
session and input-reference guards reject late reads. Older APIs retain a guarded products,
settings and profile read path.

Settings responses add canonical business profile/provenance fields and an opaque `version`.
Optional `expectedVersion` rejects stale saves with 409 under business/settings locks before any
write; existing clients without the field remain compatible. The form merges only actual edits
over current saved settings, preserves invalid cover-day text, reloads canonical values on a
conflict and keeps edits for deliberate resubmission. No PostgreSQL business-table or migration
change was needed. Optional SQLite adds only a durable request cache for existing writes;
its existing business schema still has no location field, so nonempty location saves return 422
atomically rather than pretending to persist them.

Exact pending sale/movement retries match the submitting session, key and normalized body before
mutable activity/date/stock validation. Forms retain their original product, including delivery
dialogs whose Inventory/Restock rows disappear. New/edited submissions, role/quantity/sign/note
checks and backend validation remain authoritative. Cached voided sales remain rejected, and
pending form identities still do not survive page reloads. Browser demonstration keeps its
ordinary stock/date checks.

Imports timestamp accepted sales with one database clock value captured after acquiring the
business lock. A prestarted importer that waits behind a forecast snapshot can no longer hide
its later rows behind PostgreSQL transaction-start `now()`. Saved forecast snapshots and metrics
remain immutable. The linked audit records the real concurrency reproduction and verification;
all records were synthetic and no live business data or credentials were changed.

Sequential logic-fix verification on 2026-10-20 passed all **393 frontend unit tests**, including
37 stock-maintenance, 12 shared-state and eight pending-form regressions, with no failures or
skips. Typecheck and production build passed; global lint reported zero errors and the three
existing React Refresh warnings. All **41 transaction browser** and **eight shared-state browser**
checks passed using intercepted synthetic HTTP. Workflow YAML and browser step order also passed.
The complete current-source Python suite passed **636 tests and 14 subtests**, with no failures
or skips, in **665.00s** using Python 3.12.14, a separate disposable PostgreSQL 16.15 instance
and temporary SQLite fixtures (249 dependency warnings). The import regression reproduced the
old `stale=false` before the fix, then confirmed `needs_refresh` and withheld confidence while
preserving 30 saved test observations and MAE 0. These are synthetic engineering checks, not
partner accuracy findings. Existing running images still require the normal application rebuild;
the local checks do not claim a deployed or hosted GitHub Actions result.

Existing SQL migrations 001–006 are preserved. Additive `007_client_survey` stores immutable survey
submissions and item answers without replacing users, sessions, inventory, or forecast records.
The owner retains database-design authority; no replacement schema or second TypeScript backend
is introduced. The reserved `is_valid_iso_date` helper and its
dedicated tests remain the groupmate's task.

The GitHub workflow runs clean frontend installation/typecheck/lint/build, Python tests with
PostgreSQL, full web/API/worker smoke checks, backup restoration, and restart persistence. It also
runs `scripts/verify-transaction-retries-browser.mjs` and
`scripts/verify-shared-state-browser.mjs` after Playwright Chromium installation. These separate
synthetic transport checks self-start isolated Vite servers and cover count/product/movement
retries, delayed product responses, session boundaries, shared revisions and settings conflicts;
they do not replace real PostgreSQL checks. Their relative API URLs are pinned so environment
settings cannot send fixture requests to another server. Local
unit checks and an added workflow are not by themselves evidence of an actual hosted deployment;
read the workflow outcome and record the target hosting verification separately.

The transaction browser verifier waits for the current failed POST/PATCH and its form to
finish before checking retry state; an earlier error toast cannot advance the next case.
Its simulated API uses fixture settings and the browser's explicit fixed instant without
evaluating a live page inside request callbacks.
Before return/write-off navigation it lets earlier notifications expire away from the pointer,
so hovering the notification stack cannot keep a tab covered. Cleanup intercepts new API polls
and drains context route callbacks before closing the page, preserving the original assertion
failure instead of masking it with a closed-page error.

On 2026-10-20, adding 200 ms to the old transaction guard reproduced an early retry-state
lookup failure followed by the reported closed-page callback error. The corrected verifier
passed all 41 checks both normally and with that delay in isolated native Edge runs. Typecheck,
lint (the same three warnings), and production build passed. Fixtures were synthetic; these
local checks do not claim a completed Linux/GitHub Actions run or new Python/database tests.

The real API/PostgreSQL forecast-evidence browser verifier follows the compact Restock layout:
it checks that each product's Forecast details starts closed, opens its summary, and then checks
the untested, tested, or older-result text. Forecasts checks the saved first-ranked product's
own evidence and the current Past test coverage label. On 2026-10-20 all six integration checks
passed with native Edge, the real Python API/worker and a separate disposable PostgreSQL 16
installation, without intercepted responses. Typecheck, production build and lint also passed
(the same three lint warnings). Only synthetic records in the disposable installation were used;
this is separate from the next GitHub Actions result and from client research findings.

Shortened-test display and retry-CI verification on 2026-10-20 passed typecheck, lint (the same
three React Refresh warnings), production build, 36 shared evidence/render regressions, 30
forecast adapter regressions, and all 18 isolated Edge transaction-browser checks. Workflow YAML
parsing and step-order checks passed. The browser checks used synthetic intercepted responses;
Linux Chromium execution and the actual GitHub Actions result remain for the next workflow run.
The Python/database suite was not rerun for this frontend/workflow-only change; its earlier
movement-date verification above remains a separate record. No live business records were used.

Client dashboard/account verification on 2026-10-20 passed typecheck, lint (the same three React
Refresh warnings), production build, 43 shared evidence/route render regressions, 31 forecast
adapter regressions, and eight account regressions. Seven focused Edge browser checks passed
for the Overview shortcut, saved-rank selection through a real refresh click and queued/running/
completed synthetic responses, compact Restock details with visible warnings, and independent
password visibility controls. Desktop and 390px password screenshots and bounds checks confirmed
no text/control overlap. The existing 11 scheduled-forecast browser checks also passed, including
unchanged-revision polling and saved Moving Average settings. Browser attempts during guide
editing were rerun with the workspace frozen. These checks used synthetic intercepted responses,
with no password-change request or live business records. No Python/database rerun was needed for
these frontend-only changes. The new focused verifier is `scripts/verify-client-ui-browser.mjs`;
its screenshots/report are local ignored artifacts under `benchmarks/client-ui/`.

Password/window follow-up on 2026-10-20 confirmed that the account API returns identity, not a
recoverable password, and that the worker uses the frozen Moving Average setting independently
of final-test length. In an isolated no-database synthetic worker simulation, changing the
window from 7 to 14 changed predictions while both runs retained 30 final-test observations and
30 future days. All 54 focused Python settings/worker/split tests passed in Docker Python
3.12.14 with networking disabled and source mounted read-only; no Python code changed and the
full database suite was not rerun. Frontend typecheck, lint (the same three warnings), build,
44 evidence/route render tests, 31 adapter tests, three settings tests, and eight account tests
passed. All 10 focused Edge browser checks passed using API-mode startup and intercepted
synthetic responses, including selecting 14, saving, queued/running results retaining 7,
completed results using 14 alongside 30 tested days, and settings surviving a full reload.
Browser password-manager autofill remains browser-dependent; metadata and independent visibility
controls were verified, without submitting a password change. Read-only local runtime metadata
also included a completed run with window 14 and horizon 30, but its usable final-test count was
28; this anonymized run was not linked to the screenshot account or presented as client accuracy.
At that verification, the running web image still predated those follow-up UI changes and
required the normal rebuild. No live business records or credentials were changed.

UI polish on 2026-10-20 makes the Overview MAE card's Forecasts button green, omits its
unavailable-score dash, and removes the current-password helper paragraph. Typecheck,
production build, 44 evidence/route render tests, and eight account tests passed; lint retained
the same three React Refresh warnings with no errors. The local web container was rebuilt and
restarted, and HTTP checks confirmed its HTML and Overview/Inventory assets match the build
and its API health endpoint responds successfully. These checks did not use client records.

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

## Client wording and account-email feedback (2026-11-14)

Dashboard, sales report, forecast evidence, inventory/import dialogs, settings and account
screens use shorter task wording. Forecast history warnings, nonzero missing/excluded day
counts, limited test scope, confidence/range evidence, unit-cost valuation and irreversible
action notices remain explicit. Routine zero issue counts are omitted. Formal questionnaire
items and thesis text are unchanged. The user guide matches the visible Forecast methods
settings and Chart options controls.

The existing account limits remain five registration attempts per hour and ten other account
operations per minute per operation/address/identity, plus the shared 120/minute IP limit.
HTTP 429 now gives the remaining wait in seconds/minutes and an accurately rounded-up
Retry-After; rejected requests do not extend the original window. This is temporary throttling,
not an email-address ban.

SMTP STARTTLS now verifies the server certificate and uses advertised LOGIN authentication
where supported, avoiding the observed provider disconnect during PLAIN. Mail failures
distinguish sender authentication, recipient rejection and connection/delivery problems without
exposing credentials or raw provider diagnostics. Password recovery remains account-neutral.
Read-only authentication checks against the configured Gmail server returned 535 for both
the supplied password and its space-normalized form. Runtime settings matched the private
.env; no messages were sent. Gmail sender authorization remains unresolved, independently
of the UI fixes. No environment secrets or database schema were changed.

Verification: 125 focused frontend cases, 38 focused Python mail/account cases, 15 forecast
Edge browser groups and 10 client-UI browser groups passed. Typecheck/build passed; lint
has the same three warnings. The full backend run and its follow-up mail assertions,
remaining schema issue and sender-authorization limitation are recorded in
[client simplification verification](CLIENT_SIMPLIFICATION_VERIFICATION.md).

## File map

The 2026-11-14 CI log repair updates stale Daily sales summary assertions, Settings icon
imports in the isolated test harness, and the stock-ledger demo/audit labels. Daily sales
value totals now accumulate with the existing quantity/cost precision. CI creates disposable
settings before tests and guards log collection/cleanup when setup fails. No private local
settings or database contract changed. See [CI regression repair](CI_REGRESSION_REPAIR.md)
for the supplied-log failure counts, local verification and hosted-run limits.
The repaired full serial frontend suite passed 519 tests with no failures/skips; typecheck,
build, lint (the same three warnings), workflow YAML/order/guard checks and diff checks passed.

The subsequent 14 November 2026 run reached PostgreSQL tests and reported 143 failures
and 14 setup errors, all with `products.brand` missing. Migration 012 adds the existing
API's optional `brand`, `model`, and `variant` fields with empty-string defaults, preserving
existing product quantities and migration checksums. Inventory imports of new products
require only fields marked required by `ProductCreate`; optional attribute columns can be
omitted, and stock-only updates preserve saved attributes. Regression coverage checks
an upgrade from migration 011, repeated migration execution, unchanged stock/audit records,
and attribute creation, editing and inventory imports. The hosted workflow verifies the
complete application against PostgreSQL; no checks are disabled or made optional.
With the migration applied, the hosted run exposed five CSV export failures from untyped
null date parameters. Sales and stock-movement exports explicitly cast optional bounds
to SQL dates. Regression cases cover omitted, one-sided, and inclusive date ranges.

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
