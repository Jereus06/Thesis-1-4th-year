# Repeatable performance measurement

Performance targets are requirements, not measured outcomes: the team should agree targets before
partner evaluation. Never describe synthetic measurements as client results.

## Safe API benchmark

The command below repeatedly calls the read-only health endpoint and writes raw samples plus
median/p95 latency, workload provenance, Node/OS versions, CPU model/count, and available RAM to
machine-readable JSON. It does not create or alter business records.

### Windows laptop with Docker Desktop (PowerShell)

```powershell
npm start
$env:BENCHMARK_ENVIRONMENT="Windows laptop / Docker Desktop / fill in hardware"
$env:BENCHMARK_REPETITIONS="30"
npm run benchmark
```

### Linux VPS

```bash
npm start
BENCHMARK_ENVIRONMENT="Linux VPS / fill in provider and instance" \
BENCHMARK_REPETITIONS=30 npm run benchmark
```

Run an idle set, queue a forecast for a dedicated **test/demo-origin** account, then immediately run
a second set labelled `training-active`. Do not use a real business account for load generation.
The worker's saved run includes queue-wait and total processing timing measured by Python's monotonic
`perf_counter`; detailed phase timings remain future work and must not be inferred from total time.

## Browser responsiveness

Use the browser Performance panel while signed into the same dedicated synthetic account. Record
five cold and five warm navigations to Overview, Forecasts, Data quality, and Restock, both idle and
while a run is active. Export the browser trace and record browser version, viewport, workload sizes
(products, transaction rows, classified dates), CPU/RAM, and whether DevTools throttling was used.
This manual procedure measures real rendering; the API script does not claim browser timings.

Keep output under `benchmarks/` (gitignored). Compare median and p95 only between runs with the same
endpoint, repetition count, workload, host, and container limits.
