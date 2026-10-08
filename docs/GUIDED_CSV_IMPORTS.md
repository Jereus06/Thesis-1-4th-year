# Guided CSV imports

Implemented for current inventory snapshots and historical sales on 2026-10-08. Everyday steps
are in [the User guide](USER_GUIDE.md#import-current-inventory). This document describes the
conversion contract and engineering verification; it does not report client findings.

## Preparation and confirmation

The shared importer accepts a selected CSV/TSV/text file or pasted CSV. A module Web Worker
reads/decodes, parses logical records, suggests mappings, converts values, and validates every
parsed data record. The source, validated rows, and complete diagnostics stay in that worker.
React receives bounded setup, preview, error, and product-resolution summaries.

The normal flow is Upload → Check import preview → Import. Detailed column mappings, header
and separator controls, constants, and explicit formats are under **Adjust import**. The
original source preview is under **View original file**. No external AI service, new dependency,
layout-profile manager, or SQL migration is introduced.

Known aliases identify columns automatically. An otherwise unnamed sales identifier column
can be detected when its sampled values uniquely match active catalog products; every row
still goes through the normal product validator. A unique date-shaped column can be suggested.
Redundant SKU/name columns are resolved to the named SKU only when every row agrees about the
product. Conflicting candidates require a column choice. Numeric shape alone never establishes
that an Amount or receipt-total column is sold quantity.

Date and number interpretations are checked across all mapped observations, including records
beyond the preview. Invalid observations remain row errors. Only an interpretation consistent
with the whole file is selected. If several interpretations produce the same values, no question
is needed for this file. If they produce different dates or quantities, a short question shows
an actual example and blocks readiness until confirmed. Mixed incompatible formats remain
errors; individual rows are not given different guessed locales. Explicit choices still undergo
full validation. Choices apply only to the selected source and are reset on replacement.

Users can override mappings, header detection, and comma/semicolon/tab selection. Extra source
columns are ignored. Mapping two target fields to one source column is rejected. At most 100
source columns are supported. Headerless inventory retains the eight-field positional default;
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
must be valid; blank values, currency signs, exponential notation, negatives, unsupported
precision, and values that cannot survive JavaScript numeric transport exactly are rejected.
Quantities/stock/safety retain the API's three-decimal limit, unit cost retains four, and lead
time is a nonnegative integer within the database integer range. No import rounding occurs.

For existing inventory SKUs, only SKU and stock count are required. Unmapped name/category/unit/
lead-time/safety/cost values are previewed from the catalog, but remain **omitted** from the API
payload. The Python API keeps its latest saved values under the existing business/product locks;
a browser's earlier preview cannot overwrite details edited since preparation. Supplied blank,
invalid, or incompatible unit fields remain errors. New SKUs still require every ProductCreate
field. An incomplete new SKU raises a clear 422 and rolls back the whole inventory transaction,
including any earlier count adjustments and their audit rows. Full existing payloads remain
compatible, and the existing owner/tenant rules and reactivation behavior are preserved.

Category, Unit, Lead Time, Safety Stock, and Unit Cost can also use an explicitly entered verified
shared value instead of a column when it applies to every row. No costs, units, dates, quantities,
or new-product details are invented. The browser demonstration follows the same missing-detail
policy before applying any count changes.

Before submission, the user must check the review confirmation. Source/mapping/format/shared
value/product-match/catalog changes invalidate earlier readiness and review. Selecting a new
source resets its choices. Source replacement, cancellation, and unmount terminate the worker
and ignore obsolete completions. Paste input retains a 300 ms typing pause; option changes
have a 150 ms pause for repeated field edits. Submission retrieves the cached rows rather
than decoding/parsing/validating again.

## Products, units, errors, and persistence

Sales matching retains exact ID/SKU, unique folded SKU, and unique folded name priority.
Unknown or ambiguous identifiers can be explicitly assigned to an existing active product;
the choice applies to every row with that exact trimmed source identifier. Selected matches
can be searched by source identifier, SKU, or catalog name, then reviewed, changed, or removed
in pages of 50. All selections remain accessible, including choices after the first page;
searching or paging does not reset them. Changing the product column, separator, or header
choice clears manual assignments because they belong to the previous source structure.
Object-prototype names such as `constructor` are ordinary source identifiers and are never
treated as a selected match unless the user explicitly chooses a product.
New products must be created separately in Products.
An optional sales Unit column checks the catalog unit. An existing inventory SKU must retain
its counting unit. Pack/piece conversion is never inferred, and leading-zero SKUs remain text.

Inventory duplicate SKUs and repeated/conflicting source keys within one sales source block
preparation. Source keys remain trimmed, case-sensitive identities of individual sale lines.
Equal-looking unkeyed sales are still separate transactions. No transaction keys are fabricated.

Validation collects every field problem on every parsed row, including rows beyond the preview.
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
can be reviewed but are blocked from submission; no automatic splitting is performed.
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

## Verification

Run the pure conversion/preparation regressions:

```bash
node --test scripts/test-guided-csv.mjs scripts/test-import-csv.mjs scripts/test-csv-preparation.mjs scripts/test-sales-import.mjs
npm run typecheck
npm run lint
npm run build
```

The 29 guided regressions cover column aliases/manual mapping, headerless inputs, extra
columns, ambiguous mappings, actual calendar dates, explicit grouping/decimal formats, precision,
all-row/all-field diagnostics, physical line numbers, product resolution and ambiguity,
inactive matches, counting units, duplicate identities, required values, Unicode key limits,
bounded summaries, formula-safe reports, forced delimiters, verified shared metadata, 100,000
sales rows, the existing inventory limit, automatic detection, brief ambiguity questions,
whole-file format evidence, redundant catalog columns, count-only inventory preservation, and rejection of fractional lead times without guessing
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
review invalidation, cancellation/retry, source replacement, and 55 editable selected matches.
Four additional browser scenarios verify automatic sales without settings, ambiguity confirmation,
count-only inventory persistence, and rejection of mixed imports with incomplete new products.
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
```

This starts Vite and uses intercepted API responses; its report explicitly says **mocked API;
no database**. `CSV_BROWSER_EXECUTABLE` can select an already installed Chromium binary.
Do not describe a mocked transport check as PostgreSQL persistence evidence.

The system workflow is the source of truth for full frontend/Python tests, real PostgreSQL writes,
browser imports, backup/restore, and restart persistence. Added PostgreSQL cases check current
metadata preservation after an intervening edit, count/audit rollback for an incomplete new SKU,
and compatibility of partial existing rows alongside complete new products. Local browser runs
with `--mock` establish UI behavior only; their labelled output is not database evidence.
