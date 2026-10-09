# Guided CSV imports

Current inventory snapshots and historical sales are supported; the file-selection interface was
updated on 2026-10-09. Everyday steps are in
[the User guide](USER_GUIDE.md#import-current-inventory). This document describes the
conversion contract and engineering verification; it does not report client findings.

## Automatic preparation

The shared importer accepts a selected CSV/TSV/text file or pasted CSV. A module Web Worker
reads/decodes, parses logical records, suggests mappings, converts values, and validates every
parsed data record. The source, validated rows, and complete diagnostics stay in that worker.
React receives bounded setup, preview, error, and product-resolution summaries.

Before matching fields, table extraction ignores safe report titles/preamble rows, blank or
delimiter-only padding, identical repeated header rows, and narrowly recognized trailing totals
without a product identifier or source key. Source record and physical-line positions remain
unchanged. The summary reports ignored parsed logical records; physical blank lines already
omitted by the parser are not counted. Actual transaction rows with missing or
invalid required values are retained for validation; no valid subset is silently selected.

The normal flow is Choose CSV file → Prepare/check preview → Upload CSV. One accessible
**Choose CSV file** button opens a persistent native file input. Selection starts preparation;
the persistent **Upload CSV** button sits beside the filename in a dedicated action row before
status text and the preview. Both inventory and sales use this label. The button stays visible
before selection, during preparation, and for invalid files; it is disabled until the complete
file is ready. Ready text identifies the action that saves records; an active request shows
**Uploading…**. Selecting a file never submits it automatically. Detailed column mappings, header
and separator controls, constants, explicit formats, and manual product matching are under
the optional **Adjust import** panel. There are no mandatory setup questions or review checkbox. The
original source preview is under **View original file**. File selection shows extracted records
and a neutral preparation summary. Unused content produces no warnings; the first required-data
blocker is shown neutrally near the Upload CSV action. **Import details** holds collapsed full
diagnostics and the complete error-report download. Decoding or CSV syntax problems are under **File details**. Actual
required-data failures still disable Upload CSV. An import request that
fails after clicking Upload CSV remains an alert. No external AI service, new dependency,
layout-profile manager, or SQL migration is introduced.

Known aliases identify columns automatically. An otherwise unnamed sales identifier column
can be detected when no recognized product-identity headers exist and all its source values
uniquely match saved catalog products, including inactive ones. If recognized SKU/name columns
are unknown, unrelated receipt/note columns are not substituted. Every row
still goes through the normal product validator. A unique date-shaped column can be suggested.
Redundant SKU/name columns are resolved to the named SKU only when every row agrees about the
product; conflicting product identities remain diagnostics. Explicit sold-quantity aliases take
priority over generic Qty/Quantity. Other recognized aliases use semantic priority, then source
column order. Equivalent sold-quantity, generic Qty/Quantity, or stock-count aliases must agree
within their selected group. Repeated recognized identifier/header aliases are also checked;
conflicting values remain blocking diagnostics, while agreeing repeated columns are chosen automatically.
Users can change selections under Adjust import. Numeric shape alone never establishes that an
Amount or receipt-total column is sold quantity. Header-based inventory detection requires an
explicit stock-count column; a generic Qty/Quantity in a sales-shaped file is never treated as
current stock. Missing required information remains a diagnostic and blocks submission.

Date and number interpretations are checked across all mapped observations, including records
beyond the preview. Invalid observations remain row errors. Whole-file evidence chooses an
interpretation automatically. When several valid interpretations remain, dates prefer ISO,
then day/month/year, then month/day/year; numbers prefer decimal point without grouping,
then decimal point with comma grouping, then decimal comma with dot grouping. The read-only
format summary and converted preview show the result. For example, otherwise ambiguous
`05/10/2026` defaults to October 5 and `1,234` defaults to 1234. Users can override either format
under Adjust import. Mixed incompatible formats remain errors; individual rows are not given
different locales. Explicit choices still undergo full validation. Choices apply only to the
selected source and are reset on replacement.

Users can override mappings, header detection, and comma/semicolon/tab selection. Automatic
delimiter detection samples up to 50 meaningful logical records, comparing consistent column
widths and recognized headers instead of choosing the most frequent separator in one row.
Explicit separator choices and valid spreadsheet separator directives remain authoritative.
Extra source columns are ignored, including in files wider than 100 columns. Optional mapping
choices show the first 100 columns plus detected or selected columns, preserving their actual
source indices. Mapping two target fields to one source column is rejected.
Headerless inventory retains the eight-field positional default;
headerless sales retains Date, Product, Quantity, with an optional Source Record Key. A valid
first data row is retained even if its SKU resembles a header name.

Formats apply to the complete source, with no per-row guessing:

| Choice                         | Accepted example | Canonical value |
| ------------------------------ | ---------------- | --------------- |
| ISO date                       | `2026-10-05`     | `2026-10-05`    |
| Day/month/year                 | `05/10/2026`     | `2026-10-05`    |
| Month/day/year                 | `10/05/2026`     | `2026-10-05`    |
| Decimal point without grouping | `1234.50`        | `1234.5`        |
| Decimal point, comma grouping  | `1,234.50`       | `1234.5`        |
| Decimal comma, dot grouping    | `1.234,50`       | `1234.5`        |

Day/month formats accept matching slash, hyphen, or dot separators with a four-digit year.
Dates must be calendar-valid. Timestamps and two-digit years are rejected. Number grouping
must be valid; blank required values, currency signs, exponential notation, negatives, unsupported
precision, and values that cannot survive JavaScript numeric transport exactly are rejected.
Quantities/stock/safety retain the API's three-decimal limit, unit cost retains four, and lead
time is a nonnegative integer within the database integer range. No import rounding occurs.

For existing inventory SKUs, the automatic default (`inventoryDetails: "new-only"`) extracts
only SKU and stock count.
Name/category/unit/lead-time/safety/cost are previewed from the catalog and remain **omitted**
from the API payload, including unrelated source details that are blank or invalid. A nonblank
incompatible source unit still blocks the import; quantities are never converted between units.
Optional **Update existing product details from CSV** under Adjust import (`inventoryDetails: "all"`)
enables strict validation and
updates of supplied metadata. In that mode absent metadata stays omitted, while supplied blank
or invalid fields block submission. The Python API keeps its latest saved values under the
existing business/product locks; a browser's earlier preview cannot overwrite details edited
since preparation. New SKUs still require every ProductCreate
field. An incomplete new SKU raises a clear 422 and rolls back the whole inventory transaction,
including any earlier count adjustments and their audit rows. Full existing payloads remain
compatible, and the existing owner/tenant rules and reactivation behavior are preserved.

Category, Unit, Lead Time, Safety Stock, and Unit Cost can also use an explicitly entered verified
shared value instead of a column when it applies to every row. No costs, units, dates, quantities,
or new-product details are invented. The browser demonstration follows the same missing-detail
policy before applying any count changes.

Valid preparation enables the explicit Upload CSV button without an additional review checkbox.
Source/mapping/format/shared-value/product-match/catalog changes invalidate earlier readiness
and trigger fresh preparation. Selecting a new source resets its choices. Source replacement,
cancellation, and unmount terminate the worker
and ignore obsolete completions. Paste input retains a 300 ms typing pause; option changes
have a 150 ms pause for repeated field edits. Submission retrieves the cached rows rather
than decoding/parsing/validating again.

Optional browser performance measurements are best effort; instrumentation failures cannot stop
preparation or prevent a prepared result from reaching the interface.

## Products, units, errors, and persistence

Sales matching retains exact ID/SKU, unique folded SKU, and unique folded name priority.
Historical sales use the complete saved catalog, including inactive products. Importing their
past transactions preserves current stock and activation status; it does not reactivate the
product. New sales, deliveries, returns, write-offs, and operating forecasts/restock advice
continue to use active products.
Unknown or ambiguous identifiers remain blocking diagnostics; they are never assigned an
invented product. Under optional Adjust import they can be assigned to an existing saved product,
including an inactive one;
the choice applies to every row with that exact trimmed source identifier. Selected matches
can be searched by source identifier, SKU, or catalog name, then reviewed, changed, or removed
in pages of 50. All selections remain accessible, including choices after the first page;
searching or paging does not reset them. Changing the product column, separator, or header
choice clears manual assignments because they belong to the previous source structure.
Object-prototype names such as `constructor` are ordinary source identifiers and are never
treated as a selected match unless the user explicitly chooses a product.
New products must be created separately in Products.
An optional sales Unit column checks nonblank values against the catalog unit; a blank optional
unit is ignored. An existing inventory SKU must retain
its counting unit. Pack/piece conversion is never inferred, and leading-zero SKUs remain text.

Inventory duplicate SKUs and repeated/conflicting source keys within one sales source block
preparation. Source keys remain trimmed, case-sensitive identities of individual sale lines.
Equal-looking unkeyed sales are still separate transactions. No transaction keys are fabricated.

Validation collects every required-field problem on every retained data row, including rows
beyond the preview, plus explicit metadata, unit, and source-key safeguards.
Any row or configuration problem blocks submission; no valid subset is silently submitted.
CSV syntax errors must be corrected before records can be safely classified and checked.
Original values are retained. Display limits are:

| Content                  | Bound                                                                                      |
| ------------------------ | ------------------------------------------------------------------------------------------ |
| Original preview         | 50 logical records; 12 fields/record, 500 characters/cell, 24,000 characters overall       |
| Converted preview        | First 50 data records; at most 200 characters per displayed value plus a truncation marker |
| On-screen errors         | First 50 problems                                                                          |
| Unresolved identifiers   | First 50 distinct identifiers; additional ones appear as earlier choices are resolved      |
| Product search options   | First 50 matches plus the current selection                                                |
| Selected product matches | Searchable; 50 per page, with all pages editable                                           |

**Download complete error report** requests a worker-generated CSV Blob containing every
collected problem, its source logical record, starting physical line, field, and bounded original
value. Spreadsheet formula prefixes are neutralized in diagnostics. Display shortening never
changes imported data.

Existing API limits remain 5,000 inventory rows and 100,000 sales rows per request. Larger sources
within the source-size limit can be reviewed but are blocked from submission; no automatic
splitting is performed. Files and pasted sources have a 25 MiB limit. Oversized files are rejected
before reading; oversized pasted UTF-8 is rejected before parsing without allocating a full encoded
copy. Sources above this byte limit are not previewed or submitted.
Python inventory request validation now accepts omitted details for existing SKUs; endpoint URLs,
full-payload compatibility, and SQL migrations are unchanged. Backend authorization, tenant scope,
validation, business locks, inventory snapshot atomicity/audit, and cross-batch duplicate checks
remain authoritative. Historical imports continue to preserve current stock. Server-side
partial outcomes caused by saved keys or intervening catalog changes remain visible, and the
source is retained for review before retrying.

The sales read endpoint retains legacy offset pagination and adds paired `beforeDate`/`beforeId`
cursor parameters with pages up to 1,000 rows. The browser uses the existing business/date/ID
index to seek through saved history, avoiding hundreds of progressively larger offset scans.
The older 200-row API remains usable through a fallback on its page-limit validation response.
Cursor/offset mixing and partial/invalid cursors are rejected; tenant scope remains required.
An import that has committed stays successful if a follow-up record read fails. An explicit
notice offers **Reload saved records** without reissuing the import; cache updates also check
that the signed-in account has not changed.

Inventory CSV retries retain the original submitted rows and idempotency key while the same
importer stays open. If the server saved a stock count but its response was lost, retrying returns
that operation's saved result instead of overwriting subsequent stock movements. Catalog
revalidation preserves this request even when a newly created SKU now prepares as an existing
product. Selecting a new source, changing an adjustment's submitted rows, or completing the
import starts a fresh operation. Closing the importer or reloading the page clears this local
retry state; it does not provide recovery across browser sessions.

## CSV exports

Sales exports append the actual saved `source_record_key` to the existing columns. Unkeyed and
manual sales remain blank; no replacement keys are invented. The importer automatically recognizes
the export's date, SKU, quantity, and source-key fields and ignores its other columns. Saved keys
continue to identify duplicate sale lines on reimport; unkeyed overlaps retain their existing limits.

Normal sales, stock-movement, and data-quality API CSV exports quote every field and prefix
formula-like text (including Unicode variants and leading whitespace/control characters) with a
tab, following [OWASP's spreadsheet mitigation guidance](https://community.owasp.org/attacks/CSV_Injection).
Actual numeric values, including negative movement quantities, are unchanged. The tab is part of
the exported text; existing identifier trimming restores guarded SKUs/source keys during reimport.
This is a spreadsheet safeguard, not a guarantee across every spreadsheet or CSV consumer.

## Verification

Follow-up verification on 2026-10-09 passed 116 parser/extraction/guided/preparation regressions,
22 browser scenarios with a mocked API, and 394 backend tests against an independent disposable
PostgreSQL database using Python 3.12.14. Typecheck and production build passed; lint passed with
three existing React Refresh warnings. Browser evidence is UI/worker evidence, separate from the
backend/database test results. All test records were synthetic.

Run the pure conversion/preparation regressions:

```bash
node --test scripts/test-guided-csv.mjs scripts/test-import-csv.mjs scripts/test-csv-preparation.mjs scripts/test-sales-import.mjs
node scripts/test-csv-extraction.mjs
npm run typecheck
npm run lint
npm run build
```

The guided regressions cover column aliases/manual mapping, headerless inputs, extra
columns, ambiguous mappings, actual calendar dates, explicit grouping/decimal formats, precision,
all-row/all-field diagnostics, physical line numbers, product resolution and ambiguity,
inactive matches, counting units, duplicate identities, required values, Unicode key limits,
bounded summaries, formula-safe reports, forced delimiters, verified shared metadata, 100,000
sales rows, the existing inventory limit, automatic detection and deterministic format choices,
whole-file format evidence, redundant catalog columns, count-only inventory preservation,
comma-rich semicolon/tab reports, required fields beyond column 100, unrelated catalog-looking
receipts, quoted exports with guarded identifiers, pre-read file-size and pasted UTF-8 size limits,
ignored optional existing metadata, explicit metadata updates, blank optional units, conservative
report-row extraction with source positions, and rejection of fractional lead times without guessing
a thousands interpretation. Earlier parser/import regressions remain intact.

For the real browser/Python API/PostgreSQL path, use a **disposable local installation**:

```bash
npm ci
npm start
npx playwright install chromium
node scripts/verify-guided-csv-browser.mjs http://localhost:8080
```

That script registers an isolated test business with random generated credentials, imports
synthetic inventory and 100,000 synthetic sales through the UI, reads the saved API records,
checks stock preservation and overlap outcomes, downloads all diagnostics, and exercises
preparation invalidation, cancellation/retry, source replacement, and 55 editable selected matches.
Additional browser scenarios verify automatic sales without settings, automatic ambiguous-format
defaults and optional overrides, count-only inventory persistence, and rejection of mixed imports
with incomplete new products. A 21-row historical-sales scenario includes seven transactions
for an inactive SKU and checks that all records save without reactivation or stock changes.
Additional preview-only checks cover comma-rich semicolon/tab reports, automatic and optional
mapping of required fields beyond column 100, and blocking unknown product columns despite a
catalog-looking receipt. These invalid/preparation scenarios make no import requests.
The match-review checks also verify clearing contextual choices on product-column/header/separator
changes and leaving inherited object names unselected. They make no import writes during review.
It writes its labelled report
and screenshots under `benchmarks/guided-csv/`, which is ignored by Git. The system workflow
includes this run against Compose and uploads its evidence as `guided-csv-verification`.
No existing client account or records are used.

For an isolated frontend-only check:

```bash
npx playwright install chromium
node scripts/verify-guided-csv-browser.mjs --mock
node scripts/verify-inventory-retry-browser.mjs
```

This starts Vite and uses intercepted API responses; its report explicitly says **mocked API;
no database**. `CSV_BROWSER_EXECUTABLE` can select an already installed Chromium binary.

The inventory retry script starts its own isolated Vite/browser session and simulates a committed
write with a lost HTTP response. It verifies retries after catalog refresh, an intervening sale,
new-SKU creation, fresh import intents, and immediate repeated clicks through the real UI/store/API
client. Windows uses installed Microsoft Edge; other platforms use Playwright Chromium. Its
labelled mocked-service report and screenshot are under `benchmarks/automatic-csv/`; no actual
database records are written.
Do not describe a mocked transport check as PostgreSQL persistence evidence.

The system workflow is the source of truth for full frontend/Python tests, real PostgreSQL writes,
browser imports, backup/restore, and restart persistence. Added PostgreSQL cases check current
metadata preservation after an intervening edit, count/audit rollback for an incomplete new SKU,
and compatibility of partial existing rows alongside complete new products. Local browser runs
with `--mock` establish UI behavior only; their labelled output is not database evidence.
