# Repeatable performance measurement

Performance targets are requirements, not measured outcomes. Agree targets before partner
evaluation. Generated workloads measure this deployment; they do not establish client results,
forecast accuracy on real records, or production capacity.

## Isolated authenticated API benchmark

Use an isolated test deployment with public registration enabled. The
[benchmark script](../scripts/benchmark.mjs) registers a new demo-origin owner store, imports
deterministic synthetic products and daily sales, records synthetic receipts, and submits normal
Forecast Refresh requests to the real worker. It requires no supplied owner credentials. The store
and records remain in the test database after measurement; dispose of them with the isolated test
deployment when finished. Do not point the benchmark at a real client deployment.

The script holds its random email/password and session/CSRF cookies in memory. It signs out at the
end and writes only workload counts, selected settings, safe runtime metadata, run timing, raw
latency samples, and statistical summaries. Response bodies, credentials, cookies, and tokens are
not exported. `sessionRevoked` records whether server sign-out succeeded; the in-memory cookie jar
is cleared even if sign-out fails.

### Run it

The base URL must match the deployment's allowed `CORS_ORIGIN`, including hostname and port.
`localhost` and `127.0.0.1` are different origins. Node 24 and the installed project dependencies
are sufficient; no additional package is required.

```powershell
npm run benchmark -- --base-url http://localhost:8080 --output benchmarks/api-local.json --samples 30 --products 8 --days 180 --movements 24 --concurrency 2 --max-runs 5 --environment "Isolated local Docker Compose"
```

The same command works in a Linux shell. Startup and the test deployment's environment remain the
operator's responsibility. Do not run browser measurements, other benchmark jobs, or unrelated
store Refresh jobs during the API measurement.

| Option               | Default                              | Meaning                                                              |
| -------------------- | ------------------------------------ | -------------------------------------------------------------------- |
| `--base-url`         | `http://localhost:8080`              | HTTP/HTTPS origin, without credentials, path, query, or fragment     |
| `--output`           | Timestamped JSON under `benchmarks/` | Safe report, including partial results after failure                 |
| `--samples`          | 30                                   | Accepted samples per endpoint in each phase, minimum 5               |
| `--products`         | 8                                    | Generated active products, 1–20                                      |
| `--days`             | 180                                  | Complete positive daily history per product, 134–730 days            |
| `--movements`        | 24                                   | Additional quantity-one receipts, 0–2,000                            |
| `--concurrency`      | 2                                    | Simultaneous measured GET requests, 1–8                              |
| `--max-runs`         | 5                                    | Maximum additional worker runs used to collect running samples, 1–20 |
| `--timeout-seconds`  | 600                                  | Deadline per worker run/sampling phase, 30–3,600 seconds             |
| `--environment`      | `isolated-synthetic-test-deployment` | Human-readable deployment label                                      |
| `--environment-file` | None                                 | Optional JSON containing selected safe versions/resource limits      |

`BENCHMARK_URL`, `BENCHMARK_OUTPUT`, `BENCHMARK_REPETITIONS`, and `BENCHMARK_ENVIRONMENT` supply
defaults for their corresponding options; explicit arguments take precedence. `--help` prints the
available options.

With defaults, the generated store has 8 products, 1,440 imported sales rows, 8 opening-balance
audit movements, 24 receipt movements, and no reviewed day classifications. Historical imports
preserve the opening stock balance. History ends on the API's actual business day. Daily positive
quantities follow a fixed pattern, and every run records its actual date range and model settings.
The 134-day minimum allows the normal default split to retain 100 training observations and
20 validation observations, but eligibility still depends on the deployment's actual settings.
The report records each completed run's eligible-product count and algorithm identity.

### Endpoints and sampling rules

The benchmark measures health, authenticated forecast dashboard, products, settings, sales
(`limit=100`), stock movements (`limit=100`), forecast runs (`limit=20`), a saved run, its saved
predictions (`limit=200`), and its metrics. List measurements read the first page. They do not
represent loading every transaction or rendering a browser page. Business/run IDs in endpoint
paths are replaced with placeholders in the report.

First, a normal warm-up Refresh must complete successfully. Idle reads then require that run to
remain completed both before and after each request batch. Next, the script queues finite
successive normal Refresh jobs. A running sample is accepted only when the **same run reports
`running` both before and after the whole measured request batch**. Queued states are awaited;
requests that cross completion are retained as boundary samples and excluded from summaries.
After collecting enough samples, the script waits for the final run to finish so the report
contains its real saved timing. It never assigns a busy label solely because a run was queued.

`complete: true` means every endpoint has the requested accepted sample count in both phases.
Insufficient worker overlap, a failed worker job, or a request failure produces a partial report
and a nonzero process exit. Increase `--max-runs` or workload size for insufficient overlap;
retained boundary observations remain available for review. Other stores' activity cannot be
excluded by a single-store status probe, so the operator must keep the deployment isolated.

Each raw sample includes timestamp, response status/byte count, latency, phase, run ID,
before/after worker status, and acceptance. Latency covers `fetch` through receiving the complete
response body; status probes are outside that duration. Request concurrency and status-probe
traffic are part of the stated workload. Median uses the midpoint of the two central values for
even counts; p95 uses nearest rank. With only 30 samples, p95 is a small-sample observation,
not a reliable capacity or service-level guarantee. Compare results only for the same endpoint,
workload, repetition count, request concurrency, software, hardware, and container limits.

## Environment and worker timing

Reports always include benchmark-host Node/OS versions, CPU model/count, total RAM, and free RAM
at start/end. These describe the machine running Node; they are not inferred container versions.
An optional metadata file may separately provide `hostVerificationRuntime`,
`containerRuntime.api/worker/db/web`, `docker`, and `containerLimits.api/worker/db/web`.
Version fields are restricted to Node/Python/FastAPI/psycopg/PostgreSQL/XGBoost/NumPy/Caddy/Docker
and Docker Compose. Container limits accept only `cpus` and `memoryBytes`. Generic environment
fields and full Docker inspect output are not copied. Verify actual container versions before
claiming them; absence of a configured per-service limit is different from Docker Desktop's
total CPU/RAM allocation.

Saved worker timing uses monotonic elapsed time. `queueWaitMs` is separate from processing.
`preparationMs` covers input loading/preparation; `trainingMs` includes all model fits and refits;
`validationMs` covers prediction, scoring, selection, and calibration on validation observations;
`evaluationMs` covers final-test and operating prediction work; `persistenceMs` covers model
artifacts and forecast result persistence. `validationEvaluationMs` is the sum of validation and
evaluation. Unperformed phases are `null`, so a baseline run does not claim model training.
`totalProcessingMs` and the saved `timingScope` specify the complete measured processing boundary;
phase measurements must not be reconstructed by dividing total duration. The final timing/status
publication transaction is excluded from the stated processing boundary.

## Browser responsiveness

Browser measurement is separate from API response timing. Use the actual authenticated
application and a dedicated synthetic account. Record five cold and five warm navigations to
Overview, Forecasts, Data quality, and Restock while idle and during verified worker execution.
For each observation, retain navigation/render timing and worker-status evidence. Record browser
version, viewport, products, transaction rows, classifications, host CPU/RAM, and throttling.
Export a sanitized trace where available; do not export credentials, cookies, tokens, or response
bodies. A renderer failure or unavailable trace is an incomplete observation, not a passing
responsiveness result.

Keep raw API reports and browser artifacts under gitignored `benchmarks/`. The focused script
regressions run with `node scripts/test-benchmark.mjs`; they verify percentile calculations,
running-boundary exclusions, request authentication headers, finite run scheduling, report
redaction, and sign-out. They do not substitute for an actual deployment measurement.

## Recorded measurements

On 2026-10-05, the isolated local Compose deployment completed the
[API review report](benchmarks/api-review-2026-10-05.json). The workload was 8 active products,
180 complete daily observations per product (1,440 imported sales rows), 8 opening balances,
24 receipts, and no reviewed classifications. Two concurrent GET requests produced 30 accepted
observations per endpoint per phase: 600 accepted samples and 2 excluded completion-boundary
samples. All accepted running samples have `running` before/after evidence. A real warm-up and
four additional official `xgboost.XGBRegressor` runs completed with 8 eligible products each;
sign-out succeeded.

| Endpoint                     | Idle median / p95 (ms) | Worker-running median / p95 (ms) |
| ---------------------------- | ---------------------: | -------------------------------: |
| Health                       |            6.66 / 9.61 |                     7.09 / 12.75 |
| Forecast dashboard           |        205.32 / 367.03 |                  274.87 / 598.31 |
| Products                     |          19.34 / 26.32 |                    17.56 / 32.11 |
| Settings                     |          16.85 / 32.18 |                    18.29 / 27.52 |
| Sales first page             |          24.07 / 34.74 |                    25.55 / 52.82 |
| Stock movements first page   |          23.13 / 31.35 |                    27.99 / 41.47 |
| Forecast runs first page     |         87.28 / 164.23 |                  274.25 / 451.50 |
| Saved forecast               |        100.89 / 163.61 |                  191.04 / 442.10 |
| Saved predictions first page |          47.01 / 73.89 |                   57.75 / 130.34 |
| Saved metrics                |         45.22 / 100.32 |                    57.28 / 90.95 |

The benchmark host was Windows 10.0.26200, Node 24.13.1, an Intel Core i7-8550U with 8 logical
CPUs, and 8,442,302,464 bytes of RAM. Docker 29.2.1 ran Linux x86_64 with 8 allocated logical
CPUs and 4,030,959,616 bytes of memory; individual service limits were not supplied in the report.
Actual containers used Python 3.12.14, FastAPI 0.115.12, psycopg 3.2.9, XGBoost 3.0.2,
NumPy 2.2.6, PostgreSQL 16.15, and Caddy 2.11.6.

The warm-up processed in 67.48 seconds. The four subsequent measured runs processed in
10.92–13.99 seconds, with separate queue waits of 1.20–4.94 seconds. Their saved disjoint phase
durations are in the raw report. This is one small synthetic workload on one laptop; its latency
distribution and warm-up difference do not establish a production capacity, partner result, or
agreed target. Browser render observations are separate from these API results.
