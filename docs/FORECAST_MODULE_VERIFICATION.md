# Sales forecasting verification — 13 November 2026

All records used here are synthetic engineering fixtures. No partner records, research results,
live account writes, deployment, or guaranteed future accuracy are claimed.

## Changes

- Fixed the actual production chart failure: model lines inside a React fragment were omitted
  by the installed React/Recharts combination. Each line is now a direct chart child.
- Turning off strategy comparison retains actual quantities and the selected method's prediction.
  The default chart horizon is 30 days; it displays only dates present in the saved run and
  distinguishes chart controls from the saved training settings.
- Chart dates use calendar spacing. Unknown historical dates remain null, unavailable models
  remain unavailable, and weekly buckets never combine historical actuals with future estimates.
  Daily marginal intervals are hidden in weekly totals because summing their endpoints does not
  establish a calibrated weekly interval. Straight, nonanimated lines preserve the saved values
  when switching products or views.
- Sales quantity MAE/RMSE keep their original day/week basis when the chart shows weekly totals
  or estimated values. Cost-based values are explicitly distinguished from selling prices.
- Repaired the optional browser prototype: training-only eligibility and volume ranking;
  separate method selection, reserved interval calibration, and final testing; fixed-origin
  recursive MA and boosted-tree predictions; frozen selection/weights/tree count before testing;
  and an operational refit after evaluation. This remains a custom TypeScript prototype, not
  the official Python XGBoost runtime.
- Demo comparison scores use the same product/date cohort. Different units or temporal grains
  are not pooled, and untrained models do not inherit Moving Average scores. Metric helpers
  reject mismatched or missing predictions instead of silently scoring a smaller subset.
  Ensemble mixing rejects mismatched arrays and invalid weights.
- Non-demo browser histories use contiguous observed tails; missing dates are not inserted as
  zero sales. Empty products have unavailable demand. Generated seed/fallback records carry
  demo provenance, and the generated fallback is labeled synthetic rather than a public dataset.
- The demonstration cache includes sale contents and the minimum nonzero-day setting, plus a
  forecasting policy version. Recalculation preserves stored sales, stock, and the demo itself.

The Python application/model implementation, API response/request contract, SQL migration
history, and stock transaction behavior were not changed. The reserved date helper and its
dedicated tests were not implemented.

## Executed verification

| Check | Result |
| --- | --- |
| `npm run typecheck` | Passed |
| `npm run lint` | Zero errors; three existing React Refresh warnings |
| `npm run build` | Passed, API-mode production frontend |
| Six focused frontend test files | 117 passed, no failures or skips |
| Complete frontend suite | 443 passed; 43 existing failures reproduced against unchanged HEAD |
| Focused Python forecasting/evidence/history helpers | 145 passed and 14 passed subtests |
| `python -m pytest backend/tests -q --disable-warnings` | 467 passed, 238 skipped, 14 passed subtests; three warnings |
| Production frontend in native Edge | Five browser groups passed, including 390px layout |

The focused frontend command is:

```sh
node --test --test-concurrency=1 scripts/test-forecast-module.mjs scripts/test-forecast-evidence.mjs scripts/test-interval-evidence.mjs scripts/test-demand-evidence.mjs scripts/test-forecast-validity.mjs scripts/test-forecast-schedule.mjs
```

The new Python cases in `backend/tests/test_forecast_thirty_days.py` run the real CPU
`XGBRegressor` through the worker's result-persistence boundary using constant and weekly-pattern
histories. They check 30 future dates, the same 30 final-test actuals for all three methods,
finite nonnegative quantities, recomputed MAE/RMSE, the weighted ensemble, validation-based
operating selection, a saved model artifact, and no manufactured results for an empty product.
The constant-history Moving Average check has a known expected forecast and zero error;
it is not a measured client accuracy result. Result SQL is captured by a test connection;
these cases do not prove a real PostgreSQL commit. Existing sensitivity tests also verify that
altering final-test actuals cannot change selection, test predictions, or calibration.

The Python run used an isolated local environment with Python 3.13.2, XGBoost 3.4.1,
NumPy 2.4.2, and scikit-learn 1.8.0, within the package's declared version ranges. It is
separate from the deployed Python 3.12 / locked-dependency environment. Docker was not running
and no `STOCKCAST_TEST_DATABASE_URL` was supplied, so PostgreSQL-dependent checks were skipped.
A dummy unreachable `DATABASE_URL` supplied the required application setting without connecting
to business data. An initial run without it had 17 configuration failures; the configured run
above resolved those failures. An unrelated optional host PyArrow import issue was avoided by
isolating the virtual environment from host packages; application code was not changed for it.

`scripts/verify-forecast-module-browser.mjs` uses the production build with intercepted synthetic
HTTP and no permitted mutations. It verifies the real Recharts paths, all model lines,
selected-method-only mode, weekly partial totals, baseline product selection, and mobile fit.
The earlier general client UI verifier timed out before initial rendering; it is not counted as
a pass. The dedicated production verifier completed successfully. Browser fixtures do not train
models and are separate from the real XGBoost tests.

The broad frontend suite has existing failures in account-member, daily-sales,
pending-submission-form, settings, and stock-maintenance tests. The same 43 failed cases were
reproduced using an isolated archive of unchanged HEAD, with matching failure names; those
unrelated modules were left intact. Local raw logs, baseline reproduction, browser report, and
screenshots are under the ignored `benchmarks/forecast-module/` directory.

The existing Python early-stopping/refit behavior was checked against the official
[XGBoost sklearn API documentation](https://xgboost.readthedocs.io/en/release_3.0.0/python/python_api.html).

## Remaining verification and team decisions

### Chart-history follow-up

At the owner's request, the chart can now show earlier saved predictions in the elapsed
interval after final testing. The frontend uses the existing authenticated
`forecast-runs/{run_id}/predictions` endpoint, reads all pages, and maps only the selected
product's saved `future` rows before the current future period. It does not reconstruct or
interpolate missing forecasts. Actual sales remain null for those rows. Current demand,
expiry, confidence, restock advice, test predictions, MAE, and RMSE are unchanged.

The new history hook loads only when needed and retains the same run's rows across product
switches; session/run guards discard late responses. A failed read leaves existing results
usable and offers Retry. This follow-up changes only frontend code and adds no backend endpoint,
migration, database write, or new training run. The focused frontend suite now has 120 passing
tests, including elapsed/expired saved forecasts, unchanged demand/scores, cross-product/date
filtering, archive pagination, and failed requests. The earlier Python results above are a
separate verification record; Python was not rerun for this frontend-only follow-up.
All seven production-Edge browser groups passed, including a 16-day elapsed interval,
an initial archive failure followed by Retry, unchanged scores/demand, and switching products
without another archive read. Typecheck and production build passed; lint retained only the
same three React Refresh warnings. These browser responses were synthetic and read-only.

### Simplified Forecast options

The subsequent Forecast options simplification defaults to daily quantity, a 30-day displayed
horizon, and Actual plus the chosen forecast. Daily/Weekly view, Days to show, and Compare models
are inside a closed native Advanced options disclosure. The estimated-value selector and the
separate days/weeks selector were removed. Controls change the chart only; they do not save
settings, extend a saved run, or retrain. Score cards, model evaluation, saved earlier predictions,
interval evidence, and the product table are retained. This is a frontend-only change.
All 120 focused frontend tests and eight production-Edge browser groups passed, including
closed default controls, keyboard opening, a seven-day displayed horizon, model comparison,
unchanged scores, restored earlier predictions, and the 390px layout. Typecheck and production
build passed; lint had zero errors and the three existing React Refresh warnings. Browser
responses were synthetic; no new Python/database checks were required or claimed.

### Deployment and data

The later display/photo/scroll follow-up adds persistent chart choices and Monthly aggregation.
See [its separate verification record](PRODUCT_PHOTOS_AND_SCROLL_VERIFICATION.md) for the
current 18 forecast-module unit cases, nine forecast browser groups, photo migration checks,
and broad-suite results. The earlier execution records above remain dated to their own changes.

- Re-run the complete suite with the project's locked Python 3.12 Docker environment and a
  separate disposable PostgreSQL database. Database commits, migration compatibility,
  API/worker integration, and deployed images were not revalidated in this session.
- Real-world predictive accuracy still requires authorized retail data and an untouched
  chronological final test. Sufficient history, including the separate eight-week and
  100-nonzero-training-day requirements, is necessary before comparing XGBoost and ensemble.
- Confirm the partner's treatment of missing records, closures, stockouts, confirmed zeros,
  business-day cutoffs, and counting units before research evaluation. The existing conservative
  Python policy remains authoritative.
- The optional sparse-data browser demonstration retains native weekly forecasts and labels
  them as weekly quantities. It is not a validated daily retail forecasting substitute.
- Existing saved runs retain their predictions and metrics. A refreshed run is required to
  apply changed settings; choosing 30 chart days does not extend an older shorter saved run.
