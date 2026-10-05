# Browser observations

Browser page and interaction measurements are separate from authenticated API latency and worker
phase timings. `scripts/benchmark-browser.mjs` launches an actual headless Microsoft Edge with a
new profile inside the repository's ignored `benchmarks/` directory. It uses Node 24's native
WebSocket and the browser's debugging protocol; no additional package is required.

Use an isolated Compose project and a dedicated synthetic owner account. Keep its credentials in
a private ignored environment file. The script reads `BENCHMARK_EMAIL` and `BENCHMARK_PASSWORD`,
or the isolated project's `OWNER_EMAIL` and `OWNER_PASSWORD`, in memory. Never pass passwords on
the command line. The authenticated business must have `dataOrigin: "demo"`; a synthetic label
does not establish a real partner or research result.

After that project's web, API, PostgreSQL, and worker services are healthy, run from the repository:

```powershell
node scripts/benchmark-browser.mjs --base http://localhost:18089 --env-file benchmarks/stockcast-review-e0d778/.env --synthetic --repetitions 10 --exercise-member-retry --artifacts benchmarks/stockcast-review-e0d778/browser --output benchmarks/stockcast-review-e0d778/browser-observations.json
```

Change the origin, private environment path, and output directory to match the isolated project.
Use `--edge` if Edge is installed elsewhere. `--expected-role staff` uses a dedicated synthetic
staff account and checks personal account controls without the owner staff-management section.
An owner run is required for the member-list checks.

The runner performs actual form input and mouse/keyboard actions. It records:

- One first sign-in-page navigation and one real sign-in submission until the dashboard is ready.
- Repeated authenticated dashboard document loads until current demand finishes loading.
- Inventory navigation until product controls render, an All-products filter change, stock-ledger
  navigation until its loading state clears, and account-tab navigation until the staff list loads.
- Owner staff-list refreshes. The optional retry check deliberately blocks only the member GET in
  Edge, checks the visible Retry control, clears the block, and executes a successful retry. This is
  an injected browser-network failure, not evidence of a naturally occurring server failure.

Each action stores its raw elapsed sample and action name. Summary values use the nearest-rank
median and p95; single observations remain single observations. These controller timings include
debugging-protocol overhead, readiness checks at approximately 50 ms intervals, and two animation
frames after the ready condition. They are repeatable interaction observations, not standardized
field Core Web Vitals or a claim about client satisfaction. Repeated document loads retain the
session and HTTP cache. The first load uses a new browser profile; Edge launch time is not included.

The report also records actual browser navigation timing, paint entries, available long tasks,
sanitized API request paths/statuses/durations, observed product/prediction counts, run status,
hardware, Node/Edge/JavaScript/protocol versions, and the environment label. It does not record
credential values, cookies, tokens, headers, request bodies, response bodies, or screenshots. A
failed run saves completed observations with `outcome: "failed"` and its last safe startup/action
stage; it never marks unfinished actions as passed. Invalid arguments, missing private environment
files, or an unwritable output path can prevent an observation report from being created.

A new isolated profile remains under the ignored artifacts directory after each execution because
it contains that run's session. Treat that directory as private. The script closes its own Edge
instance and does not access the user's normal browser profile or delete any profile directory.

Run this procedure against a described synthetic workload and state whether the worker was idle
or actively processing. The report's observed `latestRunStatus` is a point-in-time observation;
it does not prove that every browser sample overlapped training. The authenticated API benchmark
independently verifies worker-running overlap for its own request samples. This procedure alone
contains no measured results; cite an actual generated report only after execution.

## Recorded local run: 2026-10-05

[The saved browser report](benchmarks/browser-review-2026-10-05.json) contains actual observations
from 08:56:38 to 08:57:03 UTC. The isolated Compose application ran locally on Windows
10.0.26200, an Intel Core i7-8550U with eight logical CPUs and approximately 8.44 GB RAM.
The browser was headless Edge 154.0.4258.53, with JavaScript engine 15.4.11.7 and debugging
protocol 1.3; the controller used Node 24.13.1. Browser launch required execution outside the
restricted tool sandbox. The separate authenticated API benchmark had completed before this run.

This browser session used the dedicated synthetic verification owner with an empty catalog:
zero products and zero saved predictions. Its latest and saved forecast run statuses were
`none`. It measures that workload's controls and navigation; it does not establish populated-store
browser performance, concurrent-training browser performance, or production service targets.

All 63 recorded actions completed. The real sign-in form opened the authenticated dashboard;
Inventory products and stock-ledger navigation worked; the owner staff list loaded and refreshed.
The deliberately blocked member GET produced a visible error and Retry control, and the real
retry succeeded after the block was removed. The report labels this injection separately.

| Repeated action | Samples | Median (ms) | p95 (ms) |
| --- | ---: | ---: | ---: |
| Authenticated dashboard reload | 10 | 436.43 | 725.96 |
| Inventory navigation | 10 | 132.29 | 221.49 |
| All-products status filter | 10 | 197.86 | 1907.20 |
| Stock-ledger navigation | 10 | 183.68 | 239.21 |
| Account tab and staff-list load | 10 | 168.02 | 548.09 |
| Staff-list refresh | 10 | 163.49 | 770.13 |

The first sign-in page took 2206.81 ms, sign-in submission through dashboard readiness took
1711.61 ms, and the injected-error retry took 130.52 ms. Each is one observation, without a
repeatable distribution estimate. The raw report preserves every sample, navigation/paint/long-task
entry, environment detail, and sanitized API-request observation. These figures include the
controller overhead and readiness conditions described above and are not client survey findings.
