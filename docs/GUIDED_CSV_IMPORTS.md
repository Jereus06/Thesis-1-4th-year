# Guided CSV imports

Implemented for current inventory snapshots and historical sales on 2026-10-08. Everyday steps
are in [the User guide](USER_GUIDE.md#import-current-inventory). This document describes the
conversion contract and engineering verification; it does not report client findings.

## Preparation and confirmation

The shared importer accepts a selected CSV/TSV/text file or pasted CSV. A module Web Worker
reads/decodes, parses logical records, suggests mappings, converts values, and validates every
parsed data record. The source, validated rows, and complete diagnostics stay in that worker.
React receives bounded setup, preview, error, and product-resolution summaries.

Known aliases suggest a mapping; unfamiliar names can be mapped manually. Multiple aliases
for the same target field require a deliberate choice. Users can correct header detection,
select comma/semicolon/tab explicitly, and leave extra source columns unmapped. Mapping two
target fields to one source column is rejected. The guided setup supports at most 100 columns.
Headerless inventory retains the existing eight-field positional default; headerless sales
retains Date, Product, Quantity, with an optional Source Record Key.

Formats apply to the complete source, with no per-row guessing:

| Choice | Accepted example | Canonical value |
| --- | --- | --- |
| ISO date | `2026-10-05` | `2026-10-05` |
| Day/month/year | `05/10/2026` | `2026-10-05` |
| Month/day/year | `10/05/2026` | `2026-10-05` |
| Decimal point without grouping | `1234.50` | `1234.5` |
| Decimal point, comma grouping | `1,234.50` | `1234.5` |
| Decimal comma, dot grouping | `1.234,50` | `1234.5` |

Day/month formats accept matching slash, hyphen, or dot separators with a four-digit year.
Dates must be calendar-valid. Timestamps and two-digit years are rejected. Number grouping
must be valid; blank values, currency signs, exponential notation, negatives, unsupported
precision, and values that cannot survive JavaScript numeric transport exactly are rejected.
Quantities/stock/safety retain the API's three-decimal limit, unit cost retains four, and lead
time is a nonnegative integer within the database integer range. No import rounding occurs.

Inventory Category, Unit, Lead Time, Safety Stock, and Unit Cost can use an explicitly entered
verified shared value instead of a column. It must apply to every row; an empty entry cannot
satisfy a required field. SKU, product name, stock count, sale date, and sold quantity still
require source columns. The application supplies no invented values.

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
can be reviewed, changed, or removed. New products must be created separately in Products.
An optional sales Unit column checks the catalog unit. An existing inventory SKU must retain
its counting unit. Pack/piece conversion is never inferred, and leading-zero SKUs remain text.

Inventory duplicate SKUs and repeated/conflicting source keys within one sales source block
preparation. Source keys remain trimmed, case-sensitive identities of individual sale lines.
Equal-looking unkeyed sales are still separate transactions. No transaction keys are fabricated.

Validation collects every field problem on every parsed row, including rows beyond the preview.
Any row or configuration problem blocks submission; no valid subset is silently submitted.
CSV syntax errors must be corrected before records can be safely classified and checked.
Original values are retained. Display limits are:

| Content | Bound |
| --- | --- |
| Original preview | 50 logical records; 12 fields/record, 500 characters/cell, 24,000 characters overall |
| Converted preview | First 50 data records; at most 200 characters per displayed value plus a truncation marker |
| On-screen errors | First 50 problems |
| Unresolved identifiers | First 50 distinct identifiers; additional ones appear as earlier choices are resolved |
| Product search options | First 50 matches plus the current selection |

**Download complete error report** requests a worker-generated CSV Blob containing every
collected problem, its source logical record, starting physical line, field, and bounded original
value. Spreadsheet formula prefixes are neutralized in diagnostics. Display shortening never
changes imported data.

Existing API limits remain 5,000 inventory rows and 100,000 sales rows per request. Larger sources
can be reviewed but are blocked from submission; no automatic splitting is performed.
The canonical Python API and SQL migrations are unchanged. Backend authorization, tenant scope,
validation, business locks, inventory snapshot atomicity/audit, and cross-batch duplicate checks
remain authoritative. Historical imports continue to preserve current stock. Server-side
partial outcomes caused by saved keys or intervening catalog changes remain visible, and the
source is retained for review before retrying.

## Verification

Run the pure conversion/preparation regressions:

```bash
node --test scripts/test-guided-csv.mjs scripts/test-import-csv.mjs scripts/test-csv-preparation.mjs scripts/test-sales-import.mjs
npm run typecheck
npm run lint
npm run build
```

The new 20 guided regressions cover column aliases/manual mapping, headerless inputs, extra
columns, ambiguous mappings, actual calendar dates, explicit grouping/decimal formats, precision,
all-row/all-field diagnostics, physical line numbers, product resolution and ambiguity,
inactive matches, counting units, duplicate identities, required values, Unicode key limits,
bounded summaries, formula-safe reports, forced delimiters, verified shared metadata, 100,000
sales rows, and the existing inventory limit. Earlier parser/import regressions remain intact.

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
review invalidation, cancellation/retry, and source replacement. It writes its labelled report
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

Local typecheck/build/lint passed, with only the three existing React Refresh warnings.
All 158 checks that do not require Docker passed locally; the three existing Compose/email
checks require Docker, which is unavailable in this editing environment. The isolated browser
run passed using mocked transport. The pull request's system workflow is the source of truth
for the full frontend, PostgreSQL, browser, backup, and restart-persistence outcome.
