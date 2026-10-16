# StockCast review verification

Workspace review date: 2026-10-05. All software-verification accounts and generated workloads use
an isolated local Compose project, `stockcast-review-e0d778`, and demo-origin records. They are
test fixtures, not a partner business, survey respondents, client findings, or thesis results.

## Sequential fixes

1. Removed the literal owner password from README and the development URL credential from the
   backend environment example. Documented privately generated startup credentials and actual
   password maintenance. No deployed credential was rotated. The available documentation/config
   scan covered 181 text files; private environment files and generated/alternate workspaces were
   excluded. Git metadata is unavailable, so this is not a certified tracked-file inventory.
2. Fixed authenticated member reads and kept write CSRF/Origin checks, owner permissions, and
   business isolation. Account maintenance exposes loading, errors, Retry, and saved-write status.
   Focused account tests and a full 248-test backend run against isolated PostgreSQL passed.
3. Shared usable-history bounds include effective confirmed-zero reviews through the actual
   business timezone. Twelve new real database/precedence regressions passed, including frozen
   snapshots, trailing unknown/excluded dates, future reviews, and active-product scope.
4. Normal Refresh can reserve 20–28 validation days while preserving training gates/CV and an
   untouched test period. Eighteen split/model checks, eight model isolation checks, three real
   Refresh interval cases, and forty frontend interval/evidence checks passed. The 134-day case
   saved actual bounds; the shorter eligible 128-day case saved unavailable evidence.
5. Persisted disjoint measured processing phases and explicit unavailable values. Five controlled
   timing tests plus eight database timing/interval cases passed, including failure and interrupted
   publication cleanup. Thirteen frontend mapping/duration checks passed.
6. Added the versioned twelve-item questionnaire for the four client-rated characteristics,
   with private drafts and durable authenticated submissions. Ten database regressions and
   eight frontend regressions passed, covering strict ratings/statuses, role/tenant boundaries,
   stable retry identity, concurrent submissions, provenance, and valid response denominators.
   Maintainability is assessed separately through engineering review.

## Executed measurements

The [API raw report](benchmarks/api-review-2026-10-05.json) has 600 accepted observations across ten
endpoints, thirty idle and thirty verified worker-running observations per endpoint. Two boundary
observations were excluded. The warm-up and four measured worker runs each completed with eight
eligible official Python XGBoost products, and benchmark sign-out succeeded. The generated data
contained eight products, 180 days, 1,440 imported sales rows, and 24 additional receipts.

Dashboard median/p95 was 205.32/367.03 ms at idle and 274.87/598.31 ms during confirmed processing.
These local workload observations do not establish production capacity or client satisfaction.
See [the API procedure and complete endpoint table](PERFORMANCE_BENCHMARK.md).

The [browser raw report](benchmarks/browser-review-2026-10-05.json) records 63 passed actual Edge
actions, including sign-in, navigation, member-list refresh, and successful Retry after a deliberately
injected network failure. Ten authenticated dashboard reloads had median/p95 436.43/725.96 ms.
This browser account had an empty synthetic catalog and no saved predictions; its workload differs
from the API benchmark. See [the browser procedure and limitations](BROWSER_BENCHMARK.md).

Seven additional [actual browser workflow checks](benchmarks/browser-workflows-2026-10-05.json)
passed for owner product creation/editing/deactivation/reactivation, return/write-off stock and
audit persistence, staff action visibility, and owner/staff survey draft/submission/reload.
These explicitly labelled software fixtures are separate from future client respondents.

Docker resources were eight logical CPUs and 4,030,959,616 allocated memory bytes. Runtime versions
read from the containers were Python 3.12.14, FastAPI 0.115.12, XGBoost 3.0.2, psycopg 3.2.9,
NumPy 2.2.6, PostgreSQL 16.15, and Caddy 2.11.6. Host checks used Node 24.13.1 and Python 3.13.2;
Edge was 154.0.4258.53. The reports preserve environment metadata separately.

## Consolidated verification

Final `npm run typecheck` and `npm run build` passed. `npm run lint` passed with zero errors and
three existing Fast Refresh warnings. All 112 frontend regressions passed using
`node --test --test-concurrency=1 scripts/test-*.mjs`; the initial concurrent run exhausted host
memory and was not counted as passing. The complete backend suite passed against real isolated
PostgreSQL: 302 passed, zero failures/skips, 243 warnings. One outdated audit-clock test fixture
was corrected without weakening its database-clock/lock assertions before that successful run.

All twelve migration 001–006 files match their initial SHA-256 values. Migration 007 adds the two
survey tables; the installed container package includes the canonical questionnaire and passes
the twenty-table schema check outside its source directory. Clean isolated initialization/startup
and the later additive upgrade/rebuild passed. Initial invalid synthetic email, Windows temporary
folder access, and long test model paths were corrected using private fixture settings and short
workspace temporary paths. No existing account was altered by that fixture correction.

The reviewed documentation has resolving local links/anchors. A final scan of public
documentation/configuration/report files found no private verification passwords or secrets;
secret values were never printed.

The [executed stack verification](benchmarks/stack-verification-2026-10-05.json) passed installed
package/schema checks, authenticated owner/staff survey reads and replay, owner CSV/staff export
denial, member disable/restore and session revocation, and other-business access rejection.
Fresh HTTP connections returned the same saved submissions. A binary PostgreSQL dump was restored
into a separate new database, with operational records and timestamps matching the original.
The scoped database, API, worker and web containers restarted; records/timestamps, saved model
artifact count, and fresh authenticated survey reads were preserved. Local drafts remain outside
the database dump. The original database and every persistent volume were retained.

The private verification harness initially stalled in inherited-input and HTTP/TLS transport
initialization. Its fixed-loopback HTTP transport, closed subprocess input and explicit timeouts
resolved that harness problem; only the completed successful check is counted as passed.

## Remaining external and research work

Live SMTP recovery/invitation delivery and Google OAuth require real deployment configuration and
were not claimed as tested. Hosting/domain credentials, actual partner data, survey administration,
questionnaire review, research model validation, and agreed performance targets remain team work.
The [maintainability review](MAINTAINABILITY_REVIEW.md) is separate engineering evidence.

Git metadata was unavailable during the original implementation checks. At publication, the
current checkout contained only the earlier stock/product/role fixes, already merged into
`main` as `48ee4c0`. The completed six-fix source was recovered from the retained isolated
review build's exact source snapshot and restored onto `stockcast-fixes-20261005`, after a clean
fast-forward to that main history. Recovery preserved all twelve migration 001–006 files and
private configuration. Publication checks passed again: typecheck/build, lint with the same three
existing warnings, all 112 frontend regressions, and all 302 backend tests with 243 warnings and
zero failures/skips. The backend rerun used production Python 3.12.14 and real PostgreSQL in an
isolated source copy; it completed at 19:32 Singapore time on 2026-10-05 in 276.66 seconds.
All 57 reviewed commit files passed the private-credential scan and patch-format checks.
Public reports retain the original executed measurements; they are not new client findings or
reconstructed samples. Private recovery files remain ignored.
