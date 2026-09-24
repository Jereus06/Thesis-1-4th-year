# StockCast coding guide

Read [`docs/PROJECT_CONTEXT.md`](docs/PROJECT_CONTEXT.md) before changing this project. Treat the source code as the authority on current behavior; update the context document when the implementation or confirmed project facts change.

## Project and current status

- Official thesis title: **Sales Forecasting and Inventory Optimization for Small Retail Businesses Using XGBoost Algorithm**.
- This repository's `main` branch is a working **React frontend prototype** with generated demonstration sales, local browser storage, forecast demonstrations, and restock screens. It does not contain a production backend, a database, or an authentication service.
- The team is still finding a real partner business and building the backend. The user is handling database design. Do not invent a partner's identity, data, database schema, backend routes, authentication model, or research results.
- The demo setting `dataScenario: "partner"` does **not** mean the seeded sales came from a partner. The store name and location in `src/lib/data/seed.ts` are placeholders.

## Working on the code

1. Inspect the actual files involved, especially `src/lib/types.ts`, `src/lib/store.ts`, `src/lib/data/seed.ts`, `src/lib/forecast/`, and `src/lib/inventory/reorder.ts` for data or forecast changes.
2. Preserve the usable demo while making changes. Keep synthetic data visibly separate from later real data. Do not silently reset browser data or import sale records as if they were inventory deliveries.
3. Do not describe the current custom TypeScript boosted-tree implementation as a verified XGBoost implementation. Keep the official thesis title, but label implementation and metrics accurately until the algorithm and evaluation are validated.
4. For forecast evaluation, separate chronological training, model selection/validation, and final testing. Compare models on the **same product/date observations**, and do not use the final test period to pick a winner or calibrate its intervals. Data sufficiency checks must be explicit; eight calendar weeks and 100 nonzero sales days are different thresholds.
5. For backend work, confirm the actual API and data contract with the user when required; implement independent frontend work in the meantime. The user owns database design. Avoid hard-coded assumptions about how future persistence, users, or stock transactions work.
6. Run `npm run typecheck`, `npm run lint`, and `npm run build` for code changes. Report failures accurately. For documentation-only edits, check links and facts against source.

## Documentation

The latest revised thesis Chapters 1–3 are maintained outside this repository. Files under `public/thesis/` support the Strategies page but can lag the latest approved working drafts. Ask for the latest chapters when a coding task depends on the thesis wording; do not silently treat those checked-in files as the final manuscript.

When handing work back, name what was changed, what was verified, and which assumptions still need confirmation from the team or future partner.
