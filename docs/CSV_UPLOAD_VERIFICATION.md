# CSV upload fix and executed verification

Executed on 6 October 2026 (Asia/Singapore). Raw reports use UTC timestamps.
All CSV fixtures and preloaded records were generated synthetic data. These engineering
measurements are not partner data, client findings, or thesis evaluation results.

This report describes the original fix with its then-current 50,000-row sales API limit.
The subsequent 100,000-row cap and automatic daily forecast work have a separate
[follow-up verification record](CSV_SCHEDULE_FOLLOWUP_VERIFICATION.md); the observations below
remain the original trials.

## Cause and implementation

Before this change, file selection asynchronously read the complete file, decoded it on the main
thread, and placed the complete decoded text in a controlled textarea. The textarea then required
large native text/layout work. Selection state also rerendered inventory product cards and caused
the sales route to sort existing history again. A tiny sales file still sorted the existing 73,100
records; the development baseline recorded two sorts taking 67.4 and 81.9 ms.

The 73,100-row sales baseline read took 16.4 ms and decoding took 6.0 ms. The subsequent selection
window contained a 45,897 ms main-thread long task and a 46,214.8 ms frame gap. The corresponding
inventory selection contained a 53,433 ms long task. Source inspection and the controlled-textarea
measurements attribute the dominant freeze to rendering/layout of the full text, with unrelated
rerenders and history sorting adding work. The long-task duration is not a separately captured
Chrome tracing `Layout` event.

Parsing and validation originally ran when **Import** was clicked, not when the file was selected.
A separate main-thread diagnostic of the original sales importer measured 795.1 ms for parsing
alone and 1,367.7 ms for the complete parse-and-validate call in development; the production
diagnostic measured 1,325.0 and 1,301.2 ms respectively. These calls used separate executions and
their times must not be subtracted to infer validation duration or added to selection latency.

The shared importer now owns file, paste, preparation, preview, and error state. Sales sorting,
history summaries, catalog filtering, and product-card rendering are cached or isolated from CSV
edits. Individual unchanged product cards and the inventory importer wrapper skip unrelated parent
renders; the inventory import callback retains a stable identity. A Vite module Web Worker performs reading, decoding,
parsing, validation, and indexed product matching. It retains the complete decoded source and
validated rows. Import retrieves those rows
without repeating preparation; source record keys retain their existing identity rules.

Uploaded files show their name, byte size, status, and a read-only preview of at most 50 logical
records, including any header. Preview fields are limited to 500 characters, 12 fields per record,
and a 24,000-character source budget; shortened content is labelled. These limits affect display
only. Field excerpts in parser diagnostics are bounded to 200 Unicode characters plus an ellipsis,
while record/line details, error reasons, and corrective guidance remain available. A malformed field
cannot become an unbounded error paragraph; the complete source remains retained. Manual paste
uses a separate editable textarea with preparation after a 300 ms typing pause.
Cancellation, replacement, or unmount terminates workers; generation and catalog checks discard
stale results. User/business changes remount the importer.

The existing API limits remain 5,000 inventory rows and 50,000 historical-sales rows. An oversized
file is prepared and previewed with a limit error before submission. The importer does not split
requests or change transaction guarantees. Historical imports preserve current stock; inventory
imports retain snapshot semantics. Missing-date and confirmed-zero policies are unchanged.

## Environment and measurement method

| Setting | Value |
| --- | --- |
| Operating system | Windows (kernel 10.0.26200) |
| CPU | Intel Core i7-8550U at 1.80 GHz; 8 logical processors |
| RAM | 8,442,302,464 bytes, approximately 8 GB |
| Browser | Microsoft Edge 154.0.4258.53, headless, isolated temporary profile |
| Browser viewport | 1440 × 1100; GPU disabled |
| JavaScript runtime | Edge V8 15.4.11.7; Node.js 24.13.1 |
| Frontend toolchain | Vite 8.3.0; React/TypeScript application |
| Browser-demo comparison workload | 200 products and 73,100 sales records |
| Tiny files | 2 data rows each; inventory 182 bytes, sales 101 bytes |
| Large selectable files | 73,100 data rows; inventory 4,656,362 bytes, sales 2,986,025 bytes |

`scripts/verify-csv-browser.mjs` used real browser file inputs through CDP `DOM.setFileInputFiles`,
mouse/key input, wheel scrolling, and tab navigation. It measured asynchronous Blob reading,
decoding, textarea assignment, existing-array sorting, main-thread long tasks, and animation-frame
gaps. After the change, worker phase durations arrive in the preparation summary; preview commit
and next-frame durations are measured on the main thread.

End-to-end selection latency includes worker startup, browser/CDP readiness polling, and two frames
after readiness. Read duration includes asynchronous I/O wait. Worker phase durations have
`thread: worker` performance-measure metadata and duration-only scope: their synthetic measure
start times are not a chronological main-thread trace. Preview render and preview frame durations
overlap; neither should be added to the other. Long tasks and frame gaps measure browser
responsiveness independently of how long preparation takes.

Final after-change runs also collect native CDP layout/style/script counter deltas and limit frame
and long-task observations to the selection window. The earlier baseline observer could include an
initial frame starting just before selection; this can affect small-file frame-gap comparisons.
The tens-of-seconds baseline stalls remain clear. A follow-up native-counter baseline could not
complete its 73,100-row sales selection before the browser-protocol timeout, so no precise baseline
native-layout duration is claimed.

Timing comparisons use one Edge process at a time. Early sandbox launch crashes, development
servers sharing an optimizer cache, and runs affected by simultaneous browser/build activity were
discarded for the final comparison. The final development server uses its own dependency cache.
Each table entry is one observed selection, not a distribution or a guaranteed performance bound.

## Before/after selection timings

All values below are milliseconds. Development compares the original report on port 5174 with
the final normal-HMR report on 5177. Built application compares the original 4174 report with the
final 4176 report. Both comparison workloads use 200 products and 73,100 existing synthetic sales.

| Runtime | Selected file | Before selection | After selection | Before max frame gap | After max frame gap |
| --- | --- | ---: | ---: | ---: | ---: |
| Development | 2-row inventory | 1,392.5 | 3,083.3 | 1,299.9 | 166.7 |
| Development | 73,100-row inventory | 56,436.0 | 3,033.4 | 47,764.8 | 250.1 |
| Development | 2-row sales | 495.5 | 423.8 | 233.4 | 16.8 |
| Development | 73,100-row sales | 53,123.4 | 1,663.5 | 46,214.8 | 100.0 |
| Built application | 2-row inventory | 575.6 | 611.1 | 300.0 | 116.6 |
| Built application | 73,100-row inventory | 72,878.8 | 2,197.1 | 51,714.6 | 433.4 |
| Built application | 2-row sales | 353.2 | 295.5 | 66.6 | 33.3 |
| Built application | 73,100-row sales | 56,135.3 | 1,627.8 | 49,181.4 | 33.4 |

The final tiny inventory development selection was the first worker selection and took longer
overall than the baseline; startup/automation overhead falls outside the worker phase timers, and
its main-thread frame gap was smaller. Large-file stalls fell to the timings above. Small-file
worker startup remains variable, especially on the first development selection.
The built large inventory selection still recorded a 578 ms long task and a 433.4 ms frame gap;
the built large sales selection recorded one 58 ms long task. No large existing-array sorts,
main-thread Blob reads/decodes, or full-file textarea assignments occurred in the final selections.
Each large uploaded preview contained 50 logical records; each tiny preview contained all 3.

The baseline built application's measured read/decode/textarea setter costs were:

| File | Asynchronous read | Main-thread decode | Main-thread textarea setter |
| --- | ---: | ---: | ---: |
| 2-row inventory | 38.9 | 0.1 | 0.1 |
| 73,100-row inventory | 45.0 | 5.8 | 336.3 |
| 2-row sales | 3.4 | 0.1 | 0.2 |
| 73,100-row sales | 23.3 | 6.4 | 360.3 |

These setter times exclude the later large render/layout stall identified above.

Final after-change phases separate worker work from main-thread preview work:

| Runtime/file | Read (worker) | Decode (worker) | Parse (worker) | Validate (worker) | Worker total | Preview commit (main) | Preview frame (main) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Development: 2-row inventory | 6.3 | 1.4 | 1.6 | 1.5 | 11.8 | 23.2 | 24.9 |
| Development: 73,100-row inventory | 25.1 | 10.7 | 1,218.9 | 562.2 | 1,818.6 | 129.6 | 130.7 |
| Development: 2-row sales | 3.7 | 0.7 | 1.5 | 14.7 | 21.8 | 13.3 | 21.0 |
| Development: 73,100-row sales | 19.8 | 6.8 | 574.6 | 571.3 | 1,173.7 | 77.9 | 80.5 |
| Built: 2-row inventory | 3.3 | 1.1 | 1.0 | 0.9 | 6.9 | 4.2 | 4.7 |
| Built: 73,100-row inventory | 31.8 | 7.0 | 640.8 | 532.1 | 1,213.3 | 9.3 | 10.5 |
| Built: 2-row sales | 5.5 | 0.4 | 2.1 | 3.3 | 12.5 | 1.4 | 14.3 |
| Built: 73,100-row sales | 851.3 | 3.2 | 197.7 | 375.9 | 1,429.2 | 5.4 | 17.6 |

The 851.3 ms built sales read is an observed asynchronous file-read wait, not main-thread CPU
blocking. Native built-browser counters for that selection recorded 13.3 ms layout, 5.0 ms style
recalculation, and 14.6 ms script time on the main thread. The analogous development selection
recorded 15.3 ms layout, 6.3 ms style recalculation, and 120.6 ms main-thread script time. The native
counters include the browser work within the measurement window and automation reads.

## Browser correctness and responsiveness checks

The final extended development browser-demo report passed all 9 named checks, with no browser
errors and exactly one initial document navigation. It completed these checks:

- Tiny valid sales and inventory files prepared with all records visible in their bounded previews.
- A 73,100-record file prepared with 50 displayed logical records and no full-file textarea.
- Unsupported headers, invalid dates, and invalid UTF-8 produced useful errors.
- A malformed header containing a 2 MB field produced a bounded alert of fewer than 1,000 characters.
- BOM-marked UTF-16LE/BE and quoted commas, escaped quotes, and quoted newlines prepared successfully.
- Rapid replacement retained the newest file; cancellation stopped active preparation.
- Manual paste imported its rows and cleared after success.
- A real 50,000-row browser UI import added all rows beyond the preview; retry skipped all keyed duplicates.
- Navigation/unmount during preparation and subsequent typing remained usable.

The browser-demo stress test used a fresh temporary profile. After seeding that profile, the harness
suppressed further writes to its `stockcast-v5` key to keep localStorage quota separate from importer
verification. The 50,000-row check exercised the real browser UI and in-memory demo store; it did
not verify persistence/reload of that larger browser-demo dataset.

The final production API-mode browser run passed all 10 named checks and used explicitly
intercepted, synthetic HTTP responses,
not PostgreSQL. It passed the same preparation/error/encoding/replacement/cancellation/paste checks,
imported a tiny inventory snapshot and tiny sales file, and prevented oversized submission. Its
recorded sales POST row counts were 2, 2, 50,000, and 50,000 for tiny upload, paste, accepted large
import, and retry. The large request retained keys `large-0` through `large-49999` in one submission;
the mocked retry accepted zero rows. This verifies browser transport and full-row forwarding.
The unchanged real API can return HTTP 409 for an identical fully accepted batch; the mock's
duplicate-row response does not replace that backend contract.

During CPU-throttled preparation in the production API-mode run, a wheel event moved the document
450 pixels and the preparing status remained available (215.5 ms for the harness interaction).
Typing `Synthetic` in product search completed in 142.5 ms, with a 50.0 ms maximum frame gap.
That intercepted store had the small imported catalog; it is separate from the 200-product
browser-demo stress workload.

The final 200-product development stress run measured 1,814.3 ms for typing at 6× CPU throttling,
with a 1,433.2 ms frame gap; wheel scrolling moved 450 pixels in 884.5 ms. Typing passed an explicit
3,000 ms assertion, rather than only checking the final input value. A separate final normal-speed
development run measured typing during preparation at 154.5 ms, a 66.7 ms maximum frame gap, and
one 51 ms long task with the same 200-product/73,100-sales workload. It passed a 1,500 ms typing
assertion. Its faster file-selection samples are not substituted into the main comparison table.

The harness used 6× CPU throttling for cancellation/navigation/responsiveness overlap, then restored
normal speed. These stress timings are separate from normal-speed selection and typing measurements.
An earlier final-value-only development typing check took 37.8 seconds; a subsequent per-card
memoization run took 4.166 seconds and failed the newly added 3-second assertion. Memoizing the
inventory importer wrapper with a stable callback removed the remaining unrelated render work; the final measured
checks above passed. Incomplete mounting/capture harness runs were corrected and rerun, rather
than presented as successful final verification.

Production resource entries recorded successful execution of
`assets/csv-import.worker-xIMMw9Z5.js`. Worker phase measurements, previews, and accepted imports
completed in the built application, with no browser exceptions recorded. The development and
production extended reports both finished with `outcome: passed`.

## Regression checks and limits of verification

The CSV regression command passed **49/49 tests** in 4,599.3 ms:

```powershell
node --test scripts/test-import-csv.mjs scripts/test-csv-preparation.mjs scripts/test-sales-import.mjs
```

Coverage includes supported delimiters/encodings, exact quoted-newline values, useful logical
record/physical-line diagnostics, date/quantity validation, exact-ID/SKU preference and ambiguity,
source-key character limits and case sensitivity, full 50,000-row preparation, 73,100-row limits,
5,000-row inventory forwarding, duplicate/conflict handling, mixed keyed/unkeyed retry identifiers,
stock preservation, frontend owner permissions, CSRF forwarding, and authenticated tenant URLs.
Store/API-adapter tests use mocked responses; they are labelled as transport-contract checks.

The related stock-maintenance, settings, and demand-evidence checks passed **27/27 tests** in
12,517.5 ms, including existing inventory behavior and reviewed-day demand policies:

```powershell
node --test scripts/test-stock-maintenance.mjs scripts/test-settings.mjs scripts/test-demand-evidence.mjs
```

SSR store tests emitted expected warnings that localStorage was unavailable in Node; those were
not browser failures and did not change any saved browser or database records.

Final frontend typecheck passed. Lint passed with zero errors and three existing React Refresh
warnings. The default API build and explicit browser-demo comparison build both passed; the final
worker asset is `csv-import.worker-xIMMw9Z5.js` (8.31 kB). Production browser execution of that final
asset is recorded with the completed browser reports below.
All seven temporary Vite servers were stopped after verification, with no remaining listeners on
their test ports; the isolated Edge instances were closed.

The existing Dockerfile copies the complete built `dist` directory into Caddy's static root, and
Caddy serves that path without a restrictive worker CSP. This supports worker delivery through the
existing container build by source inspection; actual Docker/Caddy delivery was not executed.

No Python/backend code changed. Live PostgreSQL, container recreation, Docker/Caddy delivery, and
database-backed duplicate/tenant transaction checks could not run in this workspace: a read-only
Docker daemon check found the `dockerDesktopLinuxEngine` named pipe missing; no local PostgreSQL
binaries were available; the installed Python was 3.13.2 and had no pytest, rather than the project's
Python 3.12 environment. The legacy SQLite demo lacks CSV import endpoints and was not substituted
for PostgreSQL evidence. Existing database records, migration history, private environment files,
and the reserved groupmate date-helper task were preserved.

## Changed files

- `src/components/csv-importer.tsx`: isolated upload/paste UI, preview, worker lifecycle, and cached-row submission.
- `src/lib/csv-preparation.ts`, `src/lib/csv-import.worker.ts`: worker protocol, complete source/row cache, timings, and preview/API limits.
- `src/lib/import-csv.ts`: reusable parsed-record validation and indexed matching with existing ambiguity behavior.
- `src/routes/inventory.tsx`, `src/components/products-panel.tsx`: importer integration and cached unrelated calculations/rendering.
- `scripts/test-import-csv.mjs`, `scripts/test-csv-preparation.mjs`, `scripts/test-sales-import.mjs`: parser/preparation/full-row contract regressions.
- `scripts/verify-csv-browser.mjs`: isolated browser reproduction, interaction checks, and raw timing reports.
- `docs/PROJECT_CONTEXT.md`, `docs/USER_GUIDE.md`, this report: implementation facts, updated upload instructions, and executed evidence.

## Raw evidence

Raw artifacts remain under ignored `benchmarks/csv/`; the baseline source snapshot is
`benchmarks/csv/baseline-source/`. This document retains the important results in repository documentation.

| Report | Purpose |
| --- | --- |
| `before-5174/report.json` | Original development selection and main-thread importer diagnostic |
| `before-4174/report.json` | Original built application selection and importer diagnostic |
| `before-4174-diagnostic/` | Follow-up native-counter baseline attempt; timed out during the original freeze |
| `after-5176/report.json` | Extended development browser-demo correctness checks |
| `after-4175/report.json` | Built API-mode browser with explicitly mocked HTTP transport |
| `after-4176/report.json` | Final solo built browser-demo timing comparison |
| `after-5177/report.json` | Final solo normal HMR development timing comparison |
| `after-5177-normal-typing/report.json` | Separate final normal-speed development typing during preparation |

## Rebuild and run on Windows while retaining the database

Start Docker Desktop and wait for its Linux container engine to be ready. Use the existing workspace
and its existing private `.env`; the commands below retain Compose's named database volume.
The `.cmd` form avoids PowerShell script-execution-policy issues with npm's wrapper.

```powershell
Set-Location -LiteralPath 'C:\Users\User\Documents\4th year thesis\SFAIOUXGBOOSTA'
npm.cmd ci
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run build
node --test scripts/test-import-csv.mjs scripts/test-csv-preparation.mjs scripts/test-sales-import.mjs
npm.cmd start
```

`npm.cmd start` runs the existing `docker compose up --build --detach --wait --wait-timeout 180` flow.
It recreates services using the saved volumes and existing configuration. Its printed application
URL follows the existing `APP_ADDRESS`/`HTTP_PORT` configuration. Database retention requires keeping
the existing Compose project/volume identity and private `.env`.
