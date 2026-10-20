# Logic audit — 20 October 2026

Six additional issues were reproduced during a read-only audit, then addressed one by one.
The reproduction paragraphs below describe the original failures; each implemented fix describes
the current source. All verification writes used intercepted synthetic responses or disposable
PostgreSQL/SQLite databases; no live business records or credentials were changed.

| Priority | Confirmed issue                                                    | Main consequence                                                  |
| -------- | ------------------------------------------------------------------ | ----------------------------------------------------------------- |
| High     | Stock-count correction retries reapply an old absolute count       | An intervening sale can be undone in saved stock                  |
| High     | Retrying automatic-SKU product creation creates another product    | Duplicate catalog entries and opening stock                       |
| Medium   | Cross-client catalog/settings updates do not refresh browser state | Inconsistent stock advice and unintended settings overwrites      |
| Medium   | A delayed product PATCH response replaces newer cached stock       | Displayed stock moves backward while database stock stays correct |
| Medium   | Mutable product/date checks block saved-submission retries         | The backend cannot confirm an already saved sale or movement      |
| Medium   | An import/snapshot race misses forecast invalidation               | An outdated forecast can remain current with High confidence      |

## 1. Stock-count correction retry

The count form calls an absolute product PATCH without retaining a submission identity. The
backend applies that PATCH again instead of replaying the first saved result. Synthetic
frontend execution reproduced **20 → 8** for the saved correction, a lost response, a sale
**8 → 7**, and then **7 → 8** when the unchanged correction was retried. Both PATCH requests
had no idempotency key. The simulated audit deltas were **−12, −1, +1**.

Sources: [count submission](../src/components/products-panel.tsx),
[PATCH adapter](../src/lib/api.ts), [PATCH route](../backend/app/main.py), and
[absolute update and adjustment](../backend/app/repository.py).

Implemented fix: the count form retains its normalized payload and request key. Product PATCH
uses the existing PostgreSQL replay mechanism before applying the correction. Confirmation reads
current catalog stock, so the saved correction to **8** does not undo an intervening sale to **7**.
An acknowledged save stays successful if the following read fails. Optional SQLite supports the
same request cache atomically, including durable replay and rollback of rejected attempts.

## 2. Automatic-SKU product creation retry

After a failed response, the unchanged product form calls `addProduct` again. With SKU left
blank, each call generates another SKU, while the API adapter also generates another request
key. The existing backend replay protection therefore receives a new submission. The synthetic
probe committed **two products**, each with opening stock **20**, while the browser catalog
contained only the second acknowledged product.

Sources: [product form](../src/components/products-panel.tsx),
[automatic SKU generation](../src/lib/store.ts),
[creation request identity](../src/lib/api.ts), and
[existing backend replay support](../backend/app/main.py).

Implemented fix: automatic SKU and request key are generated once per submitted form payload.
An unchanged retry retains both, including when the saved product has already loaded into the
catalog. Changed fields start a new submission. Confirmation reads the current catalog instead
of appending the creation response's historical stock. PostgreSQL and SQLite verification assert
one product and one opening movement for the retried submission.

## 3. Cross-client catalog and settings state

Revision polling reloads the forecast dashboard, while catalog and settings state remain from
the earlier authenticated load. Recommendation rows do not carry current stock; the adapter
attaches the browser's cached product. A synthetic adapter probe displayed stock **20** beside
a suggested order **25**, target **30**, and stock cover calculated from current server stock
**5**.

A separate browser reproduction exercised the actual UI and API-mode startup:

1. Browser A loads the saved Moving Average window **7**.
2. Another client's synthetic update saves **14** and completes a forecast using **14**.
3. A polls the new dashboard, but does not reread settings; its setting and saved-window label
   remain **7**.
4. A edits only the store name. Save settings sends the complete old draft, including window
   **7**, and overwrites the other client's **14**.
5. A full reload reads **14** in the control case, and a name-only save then preserves **14**.

All three browser probes completed without browser errors. Reloading is a temporary workaround,
not concurrency protection.

Sources: [dashboard-only polling](../src/lib/use-api-forecast.ts),
[cached product adapter](../src/lib/api-forecast.ts),
[initial catalog/settings load](../src/lib/store.ts),
[initial form draft](../src/routes/inventory.tsx), and
[whole-draft save](../src/routes/inventory.tsx).

Implemented fix: dashboard responses include the full catalog and canonical settings used for
advice. Polling publishes those inputs together, preserves references when values are unchanged,
and rejects responses overtaken by a local write or account change. Profile changes also alter
the polling revision. Older dashboard responses retain a guarded three-read compatibility path.

The settings form retains only edited fields over current canonical settings, including invalid
cover-days text. Settings responses add canonical profile fields and an opaque version. Optional
`expectedVersion` is checked under business/settings locks before any save; a conflict returns
409 without writing. The frontend reloads saved settings, preserves edits, and requires deliberate
resubmission. A name-only save therefore preserves another client's window **14**. Existing clients
without a version remain accepted; PostgreSQL business tables and migrations are unchanged.

## 4. Delayed product response overwrites newer displayed stock

`updateProduct` replaces the entire cached product with the PATCH response, even when stock
changed while that request was in flight. The actual-store synthetic probe held a metadata
response containing stock **20**, completed a newer delivery/catalog read showing **30**, and
then released the earlier response. Displayed stock returned to **20**; simulated database
stock remained **30**.

Source: [unconditional product replacement](../src/lib/store.ts).

Implemented fix: a metadata acknowledgment updates only the unchanged submitted product object
and preserves its known stock. A guarded catalog read reconciles current values. An older PATCH
balance **20** cannot replace a newer delivery balance **30**, including if that following read
fails. The form still reports the acknowledged save and displays a refresh notice.

## 5. Saved retries blocked by changed product/date state

The store requires an active product before recognizing a pending submission. An already saved
sale or movement with a lost response therefore cannot reach backend replay after the product
is deactivated. Synthetic probes observed only the first POST; retries failed locally with
“Choose an active product.” A saved sale retry was likewise blocked when a timezone change made
its original sale date appear future-dated. The existing stock-negative retry fixes do not
bypass these earlier guards.

Sources: [sale validation order](../src/lib/store.ts),
[movement validation order](../src/lib/store.ts),
[sale product selection](../src/components/record-sale-dialog.tsx), and
[backend replay](../backend/app/repository.py).

Implemented fix: the store matches the pending key and complete normalized payload within the
exact submitting session before mutable activity/date/stock checks. Forms retain the original
product and session; they do not switch to a different active product or unmount a pending delivery
when its Inventory/Restock row disappears. Original delivery dates remain stable across retries.
The initial-empty-catalog sale path also retains its submitted product after later deactivation.

Quantity, sign, date format, note, and role checks still apply. New/edited attempts keep ordinary
activity/date/stock validation. PostgreSQL and SQLite confirm saved requests before mutable rules;
if the first attempt never saved, current backend validation can still reject the retry. A voided
sale cannot be revived from cache. Pending form identities do not survive page reloads.

## 6. Concurrent import can leave a forecast incorrectly current

PostgreSQL `now()` is fixed at transaction start. Imported sales omit an explicit `created_at`,
so a transaction started before a forecast snapshot can wait on its business lock and insert
after capture with timestamps older than the snapshot. Dashboard stale detection compares those
timestamps with `capturedAt`; sales imports do not explicitly invalidate saved runs.

An isolated PostgreSQL reproduction used the actual repository, frozen snapshot, worker, and
dashboard. The importer began at **08:02:14.884928 UTC**, the snapshot captured **100 sales** at
**08:02:14.980272 UTC**, and the importer acquired the lock at **08:02:15.136530 UTC** before
committing at **08:02:16.037190 UTC**. The added sale kept the earlier transaction-start timestamp.
Live synthetic history then contained **101 sales**, but the completed forecast retained
`stale=false` and High confidence. Its status revision changed, so ordinary polling did not
correct the stale flag. Saved test counts and errors remained historical, as expected for an
immutable snapshot; the error was the missing stale warning.

Sources: [sales timestamp default](../backend/db/migrations/001_initial_schema.up.sql),
[import lock](../backend/app/repository.py),
[import insert](../backend/app/repository.py),
[snapshot capture](../backend/app/repository.py), and
[stale query](../backend/app/dashboard.py).

Implemented fix: imports capture one database `clock_timestamp()` after acquiring the business
lock and explicitly use it as every accepted sale's `created_at`. A transaction that began before
capture therefore cannot hide a later committed sale behind its earlier start time. No migration
or saved forecast rewrite is required.

The deterministic [PostgreSQL concurrency regression](../backend/tests/test_import_snapshot_concurrency.py)
confirms the importer waits on the real lock and preserves **100 frozen / 101 live sales**. It
checks the changed status revision, stale warning and withheld confidence while keeping the
saved test observations/errors intact. Its pre-fix baseline reproduced `stale=false` again.
Similar timestamps in other write paths need separate reproduction before claiming the same failure.

## Verification and limits

The original audit used seven synthetic store/adapter probes, three focused browser probes and
an isolated PostgreSQL concurrency reproduction. Follow-up fixes passed all **393 frontend unit
tests**, including **37 stock-maintenance**, **12 shared-state** and **8 pending-form** checks.
Typecheck and production build passed; global lint has zero errors and the three existing React
Refresh warnings. All **41 transaction browser** and **8 shared-state browser** checks passed.
The shared-state verifier's initial route-module fetch failure was rerun with isolated Vite cache
and explicit route prewarming; its original HTTP cause was not established.

Focused Python checks passed **130 settings/dashboard-related**, **14 compatibility**, and
**59 saved-submission/date-related** and **27 import/concurrency** cases. The full current-source
Python suite passed **636 tests and 14 subtests**, with **zero failures or skips**, in **665.00s**
using Python **3.12.14**, PostgreSQL **16.15** and disposable SQLite fixtures. Pytest reported
249 dependency warnings. The database harness used temporary storage, disabled external
networking and no existing application volumes. Its test containers were removed after confirming
zero remaining client connections or test schemas; cleanup was verified.

Workflow YAML and step-order checks passed. GitHub Actions now runs transaction and shared-state
browser verification after Playwright installation; a local passing run does not claim a hosted
workflow or deployment result. Normal application rebuild is required for existing running images.

Local ignored evidence is under `benchmarks/logic-audit-2026-10-20/`,
`benchmarks/audit-client-state/`, `benchmarks/forecast-staleness-audit/`,
`benchmarks/transaction-retries/`, `benchmarks/shared-state/`, and `benchmarks/logic-fixes/`;
these are engineering diagnostics, not client or thesis
accuracy findings. The temporary browser/server processes were stopped. This is a targeted
logic review, not a claim that every path or deployment configuration has been validated.
