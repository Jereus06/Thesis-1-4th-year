# StockCast: project context for a new coding session

Last checked against `main`: 2026-09-24. Read this alongside [`../AGENTS.md`](../AGENTS.md) and the current code. This is a status snapshot, not a substitute for inspecting source.

## What the system is for

**Official thesis title:** Sales Forecasting and Inventory Optimization for Small Retail Businesses Using XGBoost Algorithm.

The intended completed system lets a small retail business maintain product and sales records, estimate product demand, evaluate the thesis's XGBoost model against a moving-average baseline, and use forecasts with lead time and safety stock to support restocking decisions. Forecasts support the owner's decision; they do not automatically place orders or guarantee sales.

The study will use real information from a partner business once one is confirmed. As of this snapshot the team is still finding that partner. Do not assume a specific store, collected data, customer interview, sample size, validated accuracy, or deployed service.

## What is actually in GitHub `main`

| Area | Current implementation | What is still open |
| --- | --- | --- |
| Interface | Vite, React 19, TypeScript, TanStack Router, Tailwind. Pages: Overview, Restock, Forecasts, Inventory, Strategies. | Integrate and verify against a real backend when its contract is available. |
| State | Zustand in `src/lib/store.ts` persists products, sales, and settings in browser `localStorage` (`stockcast-v5`). | Server persistence, concurrency, access control, and data migration have not been implemented in this branch. |
| Data | `src/lib/data/seed.ts` generates an example product catalog and synthetic sales dated 2026-03-01 through 2026-09-19; `AS_OF` is 2026-09-20. The example store and its location are placeholders. | Real partner selection, permission, collection, cleaning, units, missing-day meaning, and sufficient sales history. |
| Forecasts | `src/lib/forecast/` implements moving average, a custom TypeScript boosted-tree model labelled XGBoost in the UI, model combination, intervals, and sparse-product fallback. | Confirm the thesis-required XGBoost algorithm/implementation, validate model selection and intervals, and report independent results on real data. |
| Restocking | `src/lib/inventory/reorder.ts` computes daily demand, reorder point, target stock, a suggested quantity, and status. | Agree operational rules and delivery/stock history with the real partner; reconcile suggested quantity with the desired reorder trigger. |
| Thesis content | `docs/thesis/` now contains the current text mirrors of Chapters 1–3 supplied on 2026-09-24. `public/thesis/` still contains older downloadable thesis artifacts used by the Strategies page. | Use `docs/thesis/` for current thesis claims and coding context; refresh the public DOCX downloads separately when a deliberate binary-file update is made. |

### File map

- `src/routes/`: pages and user flows.
- `src/components/`: reusable UI and dialogs.
- `src/lib/types.ts`: current frontend data types, **not** an agreed backend or database contract.
- `src/lib/store.ts`: sales, stock receipt, CSV import, product/settings updates, and local persistence.
- `src/lib/data/seed.ts`, `src/lib/data/fallback.ts`: synthetic/demo records and fallback data.
- `src/lib/forecast/`: data preparation, model training/selection, metrics, cache, and forecasts.
- `src/lib/inventory/reorder.ts`: reorder point and quantity calculations.
- `docs/thesis/`: current Chapters 1–3 text mirrors supplied on 2026-09-24; use these for thesis requirements, methodology, status, and constraints.
- `public/thesis/`: older downloadable files currently used by the Strategies page; do not treat them as newer than `docs/thesis/`.

## Current behavior and integration boundaries

1. Starting with a fresh browser store seeds synthetic products and sales. The default `dataScenario` value is `partner`, but the seed is **not partner data**. A thin-data mode may substitute generated fallback sales. Any real-data mode must clearly show data provenance and avoid silently substituting demo records for research evaluation.
2. `recordSale` appends a sale and decreases on-hand stock. `receiveStock` increases on-hand stock. `importSales` appends historical rows but does not change current stock. Before backend integration, confirm whether imports represent historic sales or new stock movements, how duplicate rows are handled, and the units/date format.
3. The forecast pipeline starts from recorded sale dates and applies separate gates. The general minimum is 8 weeks (`MIN_WEEKS`), but ML eligibility requires at least **100 nonzero days per product** (`MIN_NONZERO_FOR_ML`), and only a limited top-N set qualifies. This matters especially for a new business with limited history: a product can pass the weeks check and still use the baseline/rule path. Zero-sale days and stockouts also require interpretation with the partner.
4. The current reorder point is `dailyDemand × leadTimeDays + safetyStock`; target stock is `dailyDemand × (leadTimeDays + coverDays) + safetyStock`. The current suggested quantity is `max(0, ceil(targetStock − currentStock))` even when on-hand stock is above the reorder point; the status separately flags `reorder` when on-hand is at or below the point. Agree whether quantity should be zero unless the trigger is reached before presenting it as final business logic.
5. The code uses a custom boosted-tree trainer in `src/lib/forecast/xgboost.ts`; equivalence to a standard XGBoost implementation has **not** been established. The displayed holdout is used in model stability/winner logic and interval calibration in `src/lib/forecast/pipeline.ts`, so its displayed error must not be described as an untouched final test. The aggregate model scores can also draw on different sets of products. A defensible real-data evaluation needs a chronological fit/validation/test design and model comparisons on matching observations.

## Academic and delivery context

The teacher's midterm checklist is **Chapters 1–3, technical/research diagrams, a project plan, and working prototype/software**. The team prepared a project schedule, project context diagram, and expanded data flow diagram and replaced wireframes with screenshots of the frontend. The current frontend supports a prototype demonstration; it does **not** establish that real-partner data, backend integration, or a completed study have been delivered.

Current chapter text is now checked into [`docs/thesis/`](./thesis/): [`Chapter_1.md`](./thesis/Chapter_1.md), [`Chapter_2.md`](./thesis/Chapter_2.md), and [`Chapter_3.md`](./thesis/Chapter_3.md). These mirrors came from the DOCX files supplied on 2026-09-24 and explicitly keep partner details and backend status open for later update. Use these files before editing thesis claims or coding against research requirements. The original DOCX files remain the formal-layout source because figures and Word formatting are not fully represented in Markdown.

## Sensible next coding priorities

1. Keep demo versus real-data state visibly distinct, especially on pages with performance metrics or a fallback data set.
2. Identify and implement a real backend boundary once the team's actual API contract is known. The user is designing the database; do not design its schema by assumption.
3. Validate the actual XGBoost implementation and the independent evaluation protocol before making accuracy claims. Compare XGBoost, moving average, and any ensemble on identical product/date test points; track excluded products and fallback reasons.
4. Test the full user flow with real data once the partner exists: sales, inventory receipt, import validation, forecast refresh, restock recommendations, and persistence. The separate draft PR #3 has preliminary build/browser flow checks, which are not yet part of `main`.

Update this document when the partner is confirmed, backend is merged, database contract is shared, or evaluation rules change. Record confirmed facts and source locations instead of filling gaps with plausible examples.
