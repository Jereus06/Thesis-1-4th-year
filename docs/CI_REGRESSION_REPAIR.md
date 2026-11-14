# CI regression repair (14 November 2026)

The owner supplied `logs_117966993835.zip`. Its Linux system job stopped at the serial
frontend regression step: 518 tests, 488 passed and 30 failed. Subsequent application,
Python, browser and restore steps did not execute. Missing artifact messages and the
upload action's deprecation warning were not the failing test result.

## Causes and changes

- Thirteen Daily sales assertions expected the earlier summary shape. They now check
  the existing unit costs and product/date/unit/overall value totals as well as quantities,
  source counts, date boundaries and search results. Unknown-product costs remain zero.
- Sixteen Settings panel tests rejected the `lucide-react` import before exercising the
  real save handlers. The isolated component harness now supplies icon placeholders;
  validation, refreshed settings, conflict handling, permissions and retries remain tested.
- One stock-maintenance render test expected an old demo label and a raw user identifier.
  It now checks the visible `Demo record` label and the current user's display-name audit
  text, retaining its owner/staff permission assertions.
- Daily sales value accumulation also exposed binary floating-point noise. It now sums
  integer ten-millionths using the existing three-decimal quantity/four-decimal unit-cost
  contract, converting at the output boundary. Unit totals accumulate directly rather
  than repeatedly filtering all products. A regression checks fractional quantities,
  four-decimal costs, multiple products/dates/units and reversed input order. These values
  remain estimates based on unit cost; no selling-price or stored-record contract changed.
- CI previously created its disposable `.env` after the frontend step, so an early failure
  made `docker compose logs` and `down` fail while resolving `APP_DB_PASSWORD`. Disposable
  configuration now runs before dependency installation and tests. Log collection and
  cleanup require that setup step to have succeeded; test failures still fail the job.

## Verification

The original 30 failures reproduced locally in the affected 77 tests. After repairing the
expectations, harness and accumulator, those 77 passed. The additional precision regression
is included in the full frontend run. Workflow YAML parsing, setup order, cleanup conditions
and preservation of failure propagation were checked against the edited workflow.

The full serial frontend run passed **519 tests**, with zero failures, skips or cancellations
(268.57 seconds). Typecheck, production build and lint passed; lint retains the same three
React Refresh warnings. `git diff --check` passed. Reports are ignored local artifacts at
`benchmarks/ci-regressions-before.tap`, `ci-regressions-focused.tap` and
`ci-regressions-full.tap`.

This is local verification. The hosted GitHub Actions run must execute the updated files
to establish the result of the entire Linux/PostgreSQL/browser/restore pipeline. No live
business records, email settings, database migrations or Python sources were changed.
The previously documented fresh-database product-column mismatch in
[client simplification verification](CLIENT_SIMPLIFICATION_VERIFICATION.md) remains a separate
backend/migration issue; this repair does not claim that the unreached backend stages passed.
