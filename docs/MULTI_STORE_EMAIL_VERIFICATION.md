# Multi-store email verification — 2026-11-14

The signup application check reserved an email globally even though existing users are
business-scoped. It now accepts another store after verifying an active existing account's
password. The original account and records stay unchanged. Sign-in lists credential-matched
stores when needed; reset email includes a separate single-use link for each store. See
[the API/data contract](../backend/docs/MULTI_STORE_EMAIL_CONTRACT.md).

## Focused results

- All 40 focused Python cases passed in Python 3.12 against a separate disposable
  PostgreSQL 16 instance: same-email registration, original data preservation, invalid and
  inactive credentials, duplicate signup, store choice, session/tenant isolation, Origin,
  independent reset completion, concurrent recovery, mail failure and member security.
- All 38 frontend cases passed across API gate, authentication/session adapter and account
  members. The new adapter case confirms credential verification does not replace the
  selected store. The existing member-render harness was missing its store settings;
  supplying those synthetic settings restored all eight existing behavior cases.
- All 20 Edge authentication browser groups passed with zero unexpected HTTP requests and
  zero page errors. The additional flow tests store-list loading/locks, explicit choice,
  focus, invalidated choices after credentials change, failed reads/retry, mobile fit,
  selected Business ID submission and choice cleanup after sign-out. It caught and fixed
  the initial retained-choice bug. Existing signup, Google setup, recovery, reset,
  invitation, pending-submit, browser-save and 320px layout checks remain passing.

All account identities and outgoing mail in these tests are synthetic. No real store was
created and no real recovery email was sent. PostgreSQL uses an isolated Docker network
and temporary storage, separate from the running application's database.

## Wider-suite limitation

The previously documented product schema mismatch remains separate: product application
code expects `brand`, `model` and `variant`, while migration history does not create them.
A read-only metadata check confirmed that the running local database already has these
columns (and `selling_price`). Fresh isolated schemas therefore differ from that existing
installation. The owner retains database-design authority; this authentication change
does not add a migration, modify product code, or alter the live database schema.

## Build and local runtime

`npm run typecheck`, `npm run lint` and `npm run build` passed. Lint retains the same
three React Refresh warnings and no errors. API and web images built successfully;
only those two local services were replaced. The database and worker were not restarted.
Existing account sessions and business records were retained.

HTTP checks matched build HTML, main authentication JavaScript, Inventory JavaScript
and shared CSS, and API health passed. A read-only OpenAPI check confirmed the running
API exposes the new credential-verified store-selection endpoint. No live authentication
event, account creation or outgoing email was generated for runtime verification.

The complete `python -m pytest backend/tests` run finished with **574 passed, 143 failed,
14 setup errors and 14 passed subtests** in 787.60 seconds (216 warnings). The 157 failing
or error cases reproduce the previously documented product-column migration mismatch;
the earlier context record has the same 143 failures and 14 setup errors. The new account
tests pass. The full suite is therefore not claimed as passing, and the full frontend
suite was not run. The disposable test database and network were removed after completion.
