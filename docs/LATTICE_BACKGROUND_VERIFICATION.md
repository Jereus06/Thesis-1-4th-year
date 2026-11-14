# LATTICE background adaptation

Implemented and checked locally on 14 November 2026. The visual reference was the owner's
`files.zip`, containing `lattice-bg.js` and `lattice-bg-demo.html`. No upstream author or
license was supplied or inferred. The archive's standalone global script is not loaded
into StockCast.

## Implementation

- `src/lib/lattice-background.ts` renders a light-green network of drifting depth-projected
  points, curved links, travelling signals, mouse parallax and gentle click ripples.
- `AmbientBackground` owns the canvas through React refs/effects at the existing visible
  background layer, behind the authenticated shell's content. There is no negative-z-index
  insertion, global engine, injected stylesheet, external image or added package.
- The existing Pause/Resume button, browser preference and OS reduced motion remain intact.
  Reduced motion draws a still frame. Hidden tabs and printing stop frame scheduling.
  Context loss pauses rendering; restoration redraws and resumes as appropriate.
- Rendering targets 30 frames/second, at most 110 points (48 on narrow viewports), device
  scale at most 1.5, and roughly 1.6 million canvas pixels. Soft CSS gradients remain as a
  fallback if the canvas context cannot be created.
- Pointer handlers are passive and the decorative layer cannot intercept clicks. Touch
  gestures do not steer the field. Unmounting cancels the animation frame and removes
  observers and input, visibility, print, media-query and canvas-context listeners.
- API contracts, database records, forecast calculations, chart colours and sales controls
  are unchanged.

## Executed verification

`npm run typecheck`, `npm run build`, and `npm run lint` passed. Lint retains the same three
React Refresh warnings with no errors. `git diff --check` passed.

All seven groups in `scripts/verify-ambient-background-browser.mjs` passed against the
production frontend with synthetic intercepted HTTP:

1. Canvas pixels change, resolution stays bounded, and the background is decorative.
2. Pause freezes drawing and pointer effects; preference survives reload; resume works.
3. Reduced-motion changes and simulated tab visibility stop and restore drawing.
4. Printing and simulated context loss/restoration pause and recover cleanly.
5. Sale fields and navigation remain usable; one canvas persists across route changes;
   signing out unmounts it and stops drawing.
6. A 390px viewport at device scale 3 has no document overflow and uses capped canvas scale.
7. Reduced-motion startup keeps a static image; unavailable canvas retains the CSS fallback
   and usable forms without browser errors.

All 15 existing production forecast browser groups also passed, including chart quantities,
model scores, interval endpoints, all chart styles, saved history, per-account preferences,
desktop/mobile table alignment and scrolling. No live account or sales write was made.

Local ignored reports and screenshots are under `benchmarks/lattice-background/` and
`benchmarks/forecast-module/browser/`. Mobile checks use Edge viewport/touch emulation;
physical Android/iPhone hardware and Safari are not certified by these checks. The configured
Playwright WebKit executable was unavailable. Python tests were not rerun for this frontend-only
change.

The local web image was rebuilt and only the web service was recreated. HTTP returned 200;
served HTML matched the verified build, its JavaScript/CSS contain the network canvas, and
API health reported database connected. API, database and worker services were not restarted.
