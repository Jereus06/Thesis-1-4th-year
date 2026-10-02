# Repeatable performance measurement

Performance targets are requirements, not outcomes. Synthetic measurements must never be described
as client results. Use only a dedicated `demo`-origin account.

## API measurements

`npm run benchmark` always measures health. With `BENCHMARK_BUSINESS_ID` and an authenticated cookie
it also measures the saved dashboard endpoint, rejects redirects/non-JSON failures, and verifies
that `BENCHMARK_EXPECTED_STATE=training-active` really reports a running worker job. JSON includes
raw samples, median/p95, synthetic workload sizes, separate client/server labels, Node/OS, CPU, and
RAM. The command performs reads only.

PowerShell after `npm start`:

```powershell
$env:BENCHMARK_CLIENT_ENVIRONMENT="Windows laptop / fill in CPU and RAM"
$env:BENCHMARK_SERVER_ENVIRONMENT="Docker Desktop on this laptop"
$env:BENCHMARK_BUSINESS_ID="UUID OF DEDICATED DEMO ACCOUNT"
$env:BENCHMARK_COOKIE="stockcast_session=VALUE; stockcast_csrf=VALUE"
$env:BENCHMARK_PRODUCTS="8"; $env:BENCHMARK_SALES_ROWS="1600"; $env:BENCHMARK_CLASSIFIED_DATES="200"
$env:BENCHMARK_EXPECTED_STATE="idle"; npm run benchmark
# Queue Refresh, wait until the UI/API says Running, then:
$env:BENCHMARK_EXPECTED_STATE="training-active"; npm run benchmark
```

Linux VPS uses the same variables before `npm run benchmark`, for example:

```bash
BENCHMARK_CLIENT_ENVIRONMENT='VPS shell' BENCHMARK_SERVER_ENVIRONMENT='Hostinger VPS / fill in plan' \
BENCHMARK_BUSINESS_ID='UUID' BENCHMARK_COOKIE='stockcast_session=VALUE; stockcast_csrf=VALUE' \
BENCHMARK_PRODUCTS=8 BENCHMARK_SALES_ROWS=1600 BENCHMARK_CLASSIFIED_DATES=200 \
BENCHMARK_EXPECTED_STATE=idle npm run benchmark
```

## Browser rendering and concurrent writes

Use Playwright or the browser Performance panel against the dedicated synthetic account. Record five
cold and five warm navigations to Overview, Forecasts, Data quality, and Restock. Repeat only after
the dashboard API confirms `latestRun.status === "running"`. Export traces and record browser,
viewport, product/sale/classification counts, CPU/RAM, and throttling. During the active run, record
one synthetic sale and one synthetic stock receipt and verify both return success and persist. Never
interpret a login page, redirect, failed request, or merely queued job as a successful measurement.
The GitHub Docker smoke workflow checks API/worker persistence, but a real browser trace still must
be collected on each target machine because it includes client rendering and network conditions.
