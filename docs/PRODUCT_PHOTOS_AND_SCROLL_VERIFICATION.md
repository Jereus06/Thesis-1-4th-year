# Forecast display, product photos and scrolling verification

Executed 13 November 2026 with synthetic fixtures. No live store records, sales, photos,
passwords or partner data were changed. Initial verification left running services unchanged;
the later CSS correction's local web rebuild is recorded below.

## Changes

- Forecast chart preferences persist per account/store in this browser, including a 14-day
  displayed horizon across reloads. Defaults remain Daily/30 days with comparison off.
- Monthly view totals available daily points, separates test/future dates, preserves unknown
  observations, labels partial months, and hides daily uncertainty ranges for aggregated views.
  It does not create additional predictions or recalculate MAE/RMSE.
- Sales report filter stacking keeps the product dropdown above summary cards.
- One optional photo per product uses the owner-approved PostgreSQL design, additive migration
  011, authenticated reads, owner/CSRF-protected changes, verified decoding, resizing, metadata
  removal and private WebP responses. See the [contract](../backend/docs/PRODUCT_PHOTOS_CONTRACT.md).
- Inventory provides upload, preview, supported-device camera input, replace and remove.
- Growing record panels have bounded internal scrolling: catalog/categories, daily sales,
  sales ledger, stock movements, low-stock/selling rankings, forecast products/errors, Restock
  groups, staff accounts, reviewed dates and CSV match rows. Existing filters, pagination,
  import limits and record contents are retained. Dialogs fit short viewports.

## Executed checks

| Check                                                                       | Result                                                                                                       |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `npm run typecheck`                                                         | Passed.                                                                                                      |
| `npm run lint`                                                              | Zero errors; three existing React Refresh warnings.                                                          |
| `npm run build`                                                             | Passed.                                                                                                      |
| `node --test scripts/test-forecast-module.mjs`                              | 18 passed, including monthly boundary/unknown-date cases.                                                    |
| `node scripts/verify-forecast-module-browser.mjs`                           | Nine production Edge browser groups passed, including persisted Monthly/14-day choices and unchanged scores. |
| `node scripts/verify-product-photos-scroll-browser.mjs`                     | Six production Edge browser groups passed, with no page exceptions.                                          |
| `python -m pytest backend/tests/test_product_photos.py -q`                  | 14 passed, including two real PostgreSQL integration cases.                                                  |
| Same photo tests in cached Python 3.12.14 Docker runtime with Pillow 13.0.0 | 14 passed, ten dependency warnings. Workspace mounted read-only; separate disposable PostgreSQL 16 database. |
| `python -m app.check_schema` in that Docker runtime                         | Passed: 22 tables.                                                                                           |
| `python -m pytest backend/tests -q` in local isolated Python 3.13.2         | 479 passed, 240 database-dependent cases skipped, 14 subtests passed, three warnings.                        |
| `node --test --test-concurrency=1 scripts/test-*.mjs`                       | 448 passed; 43 existing failures remain.                                                                     |

The wide Python run deliberately had no integration database URL. The two new photo database
cases were run separately against PostgreSQL, applying all migrations in fresh schemas. They
verify persisted bytes/metadata, single-photo replacement, removal/retry, business isolation,
foreign keys/size constraints, cascade cleanup, and unchanged product revisions/stock/forecasts.
Decoder tests cover JPEG/PNG/WebP, corruption, unsupported/animated files, size/pixel limits,
orientation and stripped metadata. Route tests cover owner/staff, business scope and CSRF.

Browser checks use the production build and intercepted synthetic HTTP. They check dropdown
hit-testing above cards; invalid image selection; failed upload then retry; binary/CSRF upload;
reload/replacement/removal; staff viewing without edit controls; keyboard/internal scrolling;
sticky stock-movement headings; preserved pagination; the main long Inventory tables, staff and
review lists; and a 390px mobile layout. Camera capture is an HTML file-input capability check,
not a physical-phone camera test. These browser fixtures do not verify a deployed API.

The 43 broad frontend failures match the failure names reproduced on the archived unchanged
HEAD during the preceding forecast review. They concern existing account-member, daily-sales,
pending-form, settings and stock-maintenance assertions. Local raw logs and the comparison are
in ignored `benchmarks/forecast-module/`; photo/scroll screenshots and report are in ignored
`benchmarks/product-photos-scroll/`.

## Scroll-boundary and heading correction

The same-day follow-up removes `overscroll-behavior: contain` from the shared record panel.
Native scrolling can now continue to the parent/page at either panel edge. Sticky header cells
have an opaque shaded background, covering body rows even where an existing `thead` utility uses
a translucent background. Panel sizes, filters, records and pagination are unchanged.

Typecheck and production build passed; lint retained the three existing warnings. The extended
production Edge verifier passed all seven groups, including real wheel events moving the page
up/down at the low-stock panel edges, opaque cells across the tested tables, and identical header
interior pixels with different underlying rows. Header screenshots exclude the fractional outer
border pixel, which can include the adjacent body row. Reports/screenshots remain synthetic.
No Python/API/database change or full-suite rerun was needed for this CSS correction.

The local `stockcast` web image was then rebuilt and its web container alone recreated using
`--no-deps`. HTTP checks verified that the running app serves the exact corrected CSS from the
tested build and that API health still returns 200. The API, worker and database services were
not recreated. This does not revalidate deployed photo endpoints or the full backend suite.

## Selling-table alignment — 14 November 2026

The Least/Best selling table now has matching heading/body padding, vertically centered column
labels and stable 40/20/20/20 percent columns for product/SKU/quantity/stock. Product names get more
space, the remaining columns are equal, and long names/SKUs wrap. The minimum table width keeps
labels readable on narrow screens; horizontal overflow stays inside the existing scroll panel.
The accessible table name follows Least/Best selection. Ranking, quantities and search are unchanged.

Typecheck, production build and lint passed, with the same three React Refresh warnings. All eight
production Edge browser groups passed. The added checks measure actual heading/value text
alignment, vertically centered headings, stable widths when filtering 120 products down to one,
Least/Best switching, and readable long-name results at 390px without page overflow. Synthetic
screenshots are `least-selling-balanced-desktop.png` and `least-selling-balanced-mobile.png` under
the existing ignored browser output directory. This presentation change did not rerun Python or
the complete frontend suite.

The browser fixture clock remains fixed to 13 November; these layout checks were rerun on
14 November. The local web service was rebuilt/recreated with `--no-deps`, and HTTP checks
confirmed matching build HTML/Inventory assets and healthy API. API, worker, database services
and business records were unchanged.

## Live camera and remaining tables — 14 November 2026

Sales ledger, Product performance, Top products for XGBoost and Past forecast errors now have
matching heading/body padding, stable column widths and consistently aligned numeric titles
and values. Narrow screens scroll inside each table panel. Existing search, pagination, deletion,
ranking, metrics and forecast selection remain available; no recorded quantities were changed.

**Take photo** now opens a live video preview through `getUserMedia`. It does not click a hidden
file input or silently substitute File Manager. It requests video only, prefers a rear camera
without requiring one on desktops, and exposes available camera choices. The video is muted and
inline for mobile playback. Capture makes a JPEG within 960 pixels and returns to the ordinary
preview/explicit Save photo flow. Streams stop on capture/cancel, modal closure, account/device
change and page hiding; late grants are stopped. Choose photo remains a separate upload action.
Failures explain camera permission, missing/busy hardware, unsupported browsers or HTTPS needs.

Typecheck, production build and lint passed, with the same three existing warnings. All 18
forecast-module unit tests passed. The production photo/scroll/camera verifier passed ten browser
groups, and the forecast verifier passed eleven, both with no page exceptions. They use synthetic
HTTP and a fixture clock fixed to 13 November; these checks were executed on 14 November.

Camera checks use Chromium's [official fake-device testing flags](https://webrtc.github.io/webrtc-org/testing/),
not a real webcam. They verify a live video MediaStream with no audio, inline/muted playback,
nonempty JPEG capture, existing binary/CSRF upload, retake/cancel/close cleanup, late permission
response cleanup, actionable permission/no-device/busy errors, simulated insecure-context
messaging, and a 390px preview without document overflow. These do not certify physical phones.

Layout checks measure header/body bounds, text centering, stable widths under filtering,
preserved 40-row ledger pages and reachable final columns at 390px. The first forecast mobile
assertion incorrectly counted a reserved scrollbar gutter as clipped column space. Measured
heading/badge text was fully visible; the corrected verifier checks both padded cell bounds and
actual text-node visibility. This required no further source-table change. Latest reports are
in ignored `benchmarks/product-photos-scroll/report.json` (ten groups) and
`benchmarks/forecast-module/browser/report.json` (eleven groups). The prior broad-suite failures
recorded above were not rerun for these presentation/camera changes. Python was unchanged.

Phone live capture needs a trusted HTTPS address and user permission; desktop localhost is
allowed. Plain-HTTP PC LAN addresses cannot provide the live browser camera API. See
[camera setup](SETUP_AND_OPERATIONS.md#product-camera-on-phones-and-desktops), the
[getUserMedia requirements](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia),
and WebKit's [inline muted video guidance](https://webkit.org/blog/6784/new-video-policies-for-ios/).
Check the intended Android/iPhone devices and real webcam after hosting setup.

The final compact ledger was also checked at 1440px with its Delete buttons visible without
horizontal scrolling beside Import CSV. The ten-group camera/table verifier was rerun after that
adjustment and passed. The final local web image was rebuilt/recreated with `--no-deps`; served
HTML and Inventory/Sales report/Forecasts assets match the tested build, and API health passed.
A read-only OpenAPI check confirmed existing product-photo routes. API, worker and database
services were not restarted, and no live business records or photos were written.

## Remaining deployment and verification

Use normal `npm start` to rebuild services and apply migration 011 before using the feature in
the running installation. The full PostgreSQL suite and rebuilt deployed images were not run
as part of this follow-up. Photo functionality was verified against a disposable database,
not the live store. Check camera behavior on the target phones. Real forecasting accuracy
still requires permitted retail data and the chronological evaluation described in the
[forecast verification record](FORECAST_MODULE_VERIFICATION.md).
