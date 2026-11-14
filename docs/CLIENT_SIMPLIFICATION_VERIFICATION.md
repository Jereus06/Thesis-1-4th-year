# Client controls and account-email feedback

Local verification on 14 November 2026. Browser fixtures and database test records are
synthetic; they are not partner observations or forecast-accuracy findings.

## Changes

- Forecasts has visible View and Compare models controls. Days to show and Advanced options
  are removed. The saved run determines the chart period, with legacy date-span fallback;
  obsolete browser day preferences cannot trim saved predictions.
- Daily, Weekly, Monthly, Line, Area, Candlestick, Step, model scores, range evidence,
  product selection and earlier saved predictions remain available.
- Everyday screens use shorter instructions. Important stock/import/deletion warnings,
  missing-data notices, limited accuracy evidence and unit-cost valuation remain explicit.
  Zero missing/excluded day counts no longer add a notice.
- Account throttling states the remaining wait and rounds Retry-After up. Existing limits
  and account-neutral password recovery remain intact.
- SMTP verifies STARTTLS certificates, uses advertised LOGIN where available, and separates
  sender sign-in, recipient rejection and other delivery errors without exposing secrets.

## Executed checks

- Frontend focused regressions: 125 passed across forecast/chart preferences, evidence,
  account controls, authentication and session tests (61 evidence cases and 64 other cases).
- Python mail transport, account-email routes, retry timing and multi-store regressions:
  38 passed, using Python 3.12 and a separate disposable PostgreSQL 16 database.
- Client UI Edge browser checks: 10 passed, using intercepted synthetic HTTP, including
  saved model settings, pending/completed refreshes, record warnings and password controls.
- Forecast Edge browser checks: 15 passed against the production frontend, including
  obsolete 14-day preferences, all four chart styles, exact saved values/ranges, unchanged
  MAE/RMSE, weekly/monthly totals, model comparison, 390px layouts, table alignment and
  retrying earlier saved predictions to fill the historical gap.
- `npm run typecheck`, `npm run build` and `npm run lint` passed. Lint retains the same
  three React Refresh warnings and has no errors. `git diff --check` passed.
- Local API/web images were rebuilt and only those two services were recreated. HTTP
  page/health checks returned 200 with database connected. Served HTML matched the build,
  and the forecast asset contains Chart options without Days to show. Database and worker
  services were not restarted; the disposable test database and network were removed.
- The full Python run completed with 567 passed, 156 failed, 14 setup errors and 14 passed
  subtests. Thirteen failures were old mail-error text assertions; these were corrected
  and all 38 focused Python cases subsequently passed. The remaining 143 failures and
  14 setup errors match the documented product-schema mismatch. A separate reproduction
  confirms `products.brand` is absent after applying the checked-in migrations.
  The full suite was not repeated after updating those thirteen text assertions.

## Remaining configuration and database issues

Gmail returned SMTP 535 during sender authentication, both with the configured password
and with spaces removed. Runtime settings matched the private .env. No email was sent,
and credentials were neither printed nor changed. Gmail sender authorization still needs
to be resolved before staff invitations or recovery emails can be delivered.

Invitation URLs currently use the configured localhost address. Accepting invitations
on another device requires an appropriate reachable application address in PUBLIC_APP_URL.

Fresh database initialization remains inconsistent with product repository fields. The
team owns the missing product-column migration; this work does not alter its schema or
migration history. Existing local store records were not changed by tests.
