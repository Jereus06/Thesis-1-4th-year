# Interface refresh — 2026-11-14

## Implementation

- Product search is inside Record a sale's expandable Product picker. Names, SKUs, stock,
  selection checkmarks, bounded results and empty states replace the native selection menu.
  Typing never changes selection; Enter selects without submitting. Escape, outside
  dismissal and focus return work, while Home/End keep native search-input editing.
- Shared surfaces, typography, navigation, buttons, inputs and dialogs use a sage/ivory
  theme. All seven mobile navigation links remain available on one row. Page filters stay
  below the sticky app header.
- Sales report summary cards have equal heights and responsive columns. Quantities remain
  separate by counting unit in a keyboard-scrollable list. Large currency amounts wrap
  within their cards. Sales chart tooltips wrap long labels and are contained after a resize.
- Native CSS gradients and SVG contours provide subtle background motion. A persistent
  pause/resume control, operating-system reduced motion and print handling are included.
  Decoration cannot receive pointer input and is hidden from assistive technology.

## Verification scope

This change is frontend-only. Existing product, sale, stock, forecast, photo, permission
and persistence contracts remain in use. Browser checks use intercepted synthetic HTTP,
not live business-record writes or client research findings. Physical phones and physical
cameras are outside these automated checks. Python tests were not rerun for these changes.

The earlier [record audit](SALES_RECORDS_AND_SEARCH_VERIFICATION.md) remains a dated record
of the supplied simulated import. Its original external-search implementation has been
replaced by the dropdown picker described here.

## Executed checks

- TypeScript typecheck and production build passed. ESLint passed with the same three
  existing React Refresh warnings and no errors.
- All 63 focused cases passed: 13 sale/submission form cases, 13 sales chart/count cases,
  25 forecast module cases and 12 interval-evidence cases. Coverage includes input cursor
  keys, explicit product selection, pending-sale retries, quantities, chart styles and
  unchanged metric observations.
- All 16 production Edge sales/photo/scroll groups passed, including motion preferences,
  print handling, summary heights at 1440/768/390/320px, seven mobile navigation links,
  dropdown keyboard/outside behavior, long names, camera cleanup, opaque headings,
  scroll handoff and owner/staff photo controls. The header pixel comparison crops to the
  visible panel rather than the table's offscreen area/scrollbar gutter. Keyboard-scroll
  checks wait for native scrolling to finish.
- All 15 forecast browser groups passed, preserving existing chart styles, saved display
  preferences, horizons, mobile geometry, historical results and intervals.
- All 19 authentication browser checks passed, including 320px layouts and retry/session
  states, with zero unexpected HTTP requests and zero page errors. Its synthetic fixture
  was updated to return the existing product-photo metadata endpoint.
- All 10 client workflow browser groups passed with zero browser/fixture errors, covering
  forecast selection across refreshes, saved settings, Restock details and password
  controls. Its older harness was updated for existing history/photo/activity reads,
  searchable forecast selection and collapsed Restock groups, retaining its behavior
  assertions and expected mutation list. Total browser coverage for this refresh is
  60 groups across the four verifiers.

The local web image was rebuilt and only the `web` service was replaced. HTTP checks matched
the build HTML, Sales report/Inventory/Forecasts/main JavaScript and shared CSS; API health
passed. API, worker and database services were not restarted. No live records were edited.
The full frontend suite was not rerun.

Synthetic screenshots/reports are local ignored artifacts under
`benchmarks/product-photos-scroll/`, `benchmarks/forecast-module/browser/`,
`benchmarks/client-ui/` and `benchmarks/auth/`.
