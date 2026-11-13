# Sales report dates and chart choices — 2026-11-14

This change uses the existing sales, catalog, and saved forecast responses. No backend,
database, migrations, model fitting, or saved forecast metrics were changed.

Sales report supports Single day and an inclusive Date range. Each mode keeps its input
draft when switching. Untouched defaults follow loaded sales history; single day starts on
the latest recorded sale date, or the current store date when history is empty. Invalid,
empty, reversed, or future selections show validation instead of stale totals.

Sales report offers Bar, Line, Area, and Pie. Timeline charts use actual UTC calendar
spacing for saved business dates, separate catalog counting units, preserve fractional
quantities, and leave unrecorded dates unknown. Line/Area include point markers, including
single-day selections. Sparse long gaps need only a null marker, avoiding large arrays of
unrecorded dates. Pie shows the share of sales records by product, explicitly separate from
quantity or sales value. More than eight products use seven leading slices plus Other,
including all selected records. The displayed unit summary also keeps counting units separate.

Forecasts offers Line, Area, and grouped Bar for the same saved actual/prediction quantities.
Chart type persists with the existing account/store-specific display preferences. The chosen
method, model comparison, prediction interval, null gaps, calendar spacing, and display horizon
remain available. Changing chart type does not change forecast calculations or MAE/RMSE.

## Verification

Executed checks:

- `npm run typecheck`, `npm run lint`, and `npm run build` passed. Lint reported zero errors
  and the same three existing React Refresh warnings.
- All 44 focused cases passed across [forecast module](../scripts/test-forecast-module.mjs),
  [sales chart aggregation](../scripts/test-sales-report-chart.mjs), and
  [interval evidence](../scripts/test-interval-evidence.mjs). These include selected-method
  preservation, unchanged quantities and nulls across chart styles, interval rendering,
  single-point visibility, calendar gaps, fractional/mixed units, and complete pie totals.
- All 14 [forecast browser groups](../scripts/verify-forecast-module-browser.mjs) passed:
  actual/prediction quantities and tooltips, absent future actuals, fully visible grouped bars,
  four-model comparison, unchanged scores/horizon, account-specific persistence, mobile layout,
  calendar aggregation, table alignment, and saved-history retry/reuse.
- All 12 [report/photo/scroll browser groups](../scripts/verify-product-photos-scroll-browser.mjs)
  passed. New report checks cover inclusive boundaries, separate date drafts, invalid/future
  dates, one-day Line/Area points, all chart choices, complete 360-record pie totals with a
  339-record Other slice, accessible legends, mixed counting units, long unit names, and 390px
  layout. Existing camera, permissions, photo retry/removal, pagination, sticky headers,
  scrolling, and column-alignment checks remain passing.

Browser checks ran in headless Edge against the production frontend with intercepted
synthetic HTTP. They did not write live business records or produce partner research data.
The forecast verifier now uses an advancing clock at the fixture date: freezing `Date.now`
also froze Recharts' throttled hover updates. Temporary preview servers were closed.
The full frontend suite and Python suite were not rerun for this frontend-only change.

The local `stockcast` Compose web service was rebuilt and updated on 2026-11-14. HTTP checks
confirmed matching build HTML and Forecasts/Sales report/Inventory assets, plus API health.
The API, worker, and database services were not restarted.

The existing monetary estimate still uses recorded unit cost. Selling-price design and
real partner-data evaluation remain separate work.

## Later forecast style follow-up — 2026-11-14

At the owner's request, Forecasts now offers Line, Area, Candlestick and Step, replacing
its Bar option. Sales report retains Bar. Existing forecast `bar` display preferences map
to Candlestick without changing other saved display choices or business data.

Sales candle bodies span the recorded actual and chosen forecast quantity for a date.
Actual markers use the actual-series color and forecast markers use the chosen-series color.
Whiskers use the exact saved range endpoints when available; an absent range has no whisker.
Future dates have forecast markers and available whiskers, without invented actual quantities
or financial OHLC data. Model comparison retains the other model traces and all tooltip values.
Step uses `stepAfter` segments and retains the existing null-gap behavior. All forecast styles
share one wrapping, accessible line-and-circle legend with readable labels. The existing
range-evidence panel remains below it.

Typecheck, build and lint passed, with the same three existing lint warnings. All **37** focused
forecast/interval cases and **15** production Edge browser groups passed. New checks cover
actual-to-forecast geometry, future actuals remaining absent, exact range endpoint scaling,
missing ranges, consistent legends, Step paths, retained metrics, per-account persistence,
legacy Bar preference migration, mobile markers and legend layout. The tests use synthetic
fixtures and do not claim measured partner accuracy. Python and the full frontend suite were
not rerun for this frontend-only change.

The local web service was rebuilt and updated with this follow-up. HTTP checks confirmed
matching Forecasts/Sales report assets and build HTML, and the API health check passed.
