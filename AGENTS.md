# StockCast coding guide

Read [`docs/PROJECT_CONTEXT.md`](docs/PROJECT_CONTEXT.md) before changing this project. Treat the source code as the authority on current behavior; update the context document when the implementation or confirmed project facts change.

## Project and current status

- Official thesis title: **Sales Forecasting and Inventory Optimization for Small Retail Businesses Using XGBoost Algorithm**.
- This branch uses a React/TypeScript frontend, Python/FastAPI API and forecasting worker, and PostgreSQL. Normal local/hosted startup is `npm start` through Docker Compose; the browser prototype remains an explicit optional demonstration mode.
- The team is still finding a real partner business. The user owns database design. Preserve the existing API/database contract and migration history; do not invent partner details, collected data, or research results.
- The demo setting `dataScenario: "partner"` does **not** mean the seeded sales came from a partner. The store name and location in `src/lib/data/seed.ts` are placeholders.

## Working on the code

1. Inspect the actual files involved, especially `src/lib/types.ts`, `src/lib/store.ts`, `src/lib/data/seed.ts`, `src/lib/forecast/`, and `src/lib/inventory/reorder.ts` for data or forecast changes.
2. Preserve the usable demo while making changes. Keep synthetic data visibly separate from later real data. Do not silently reset browser data or import sale records as if they were inventory deliveries.
3. Do not describe the current custom TypeScript boosted-tree implementation as a verified XGBoost implementation. Keep the official thesis title, but label implementation and metrics accurately until the algorithm and evaluation are validated.
4. For forecast evaluation, separate chronological training, model selection/validation, and final testing. Compare models on the **same product/date observations**, and do not use the final test period to pick a winner or calibrate its intervals. Data sufficiency checks must be explicit; eight calendar weeks and 100 nonzero sales days are different thresholds.
5. For backend work, confirm the actual API and data contract with the user when required; implement independent frontend work in the meantime. The user owns database design. Avoid hard-coded assumptions about how future persistence, users, or stock transactions work.
6. Run `npm run typecheck`, `npm run lint`, and `npm run build` for code changes. Report failures accurately. For documentation-only edits, check links and facts against source.
7. The backend is Python 3.12 with FastAPI, psycopg, PostgreSQL, and the official Python `xgboost`
   package. Keep existing SQL migration history. Backend application code belongs under
   `backend/app/`; do not add a second TypeScript backend.
8. Run `python -m pytest backend/tests` for Python changes. Do not implement the groupmate-reserved
   `is_valid_iso_date(value: str) -> bool` or its dedicated tests; its contract is documented in
   `backend/docs/RESERVED_DATE_HELPER.md`.

## Documentation

The supplied formal manuscript revised on 9 October 2026 has current text companions under
`docs/thesis/`, with the questionnaire and final reference section. The Word master remains
outside this repository and retains the submission layout and figures. Use those text companions
for the current thesis wording until the owner supplies a newer revision; source code remains the
authority on implemented behavior. The retail research scope excludes sari-sari-store studies.
Authorized client records or a documented permitted public retail dataset may support forecasting;
client survey respondents remain the owner or manager and staff. The strategy Markdown under
`public/thesis/` mirrors the revised methodology; the earlier Word insert remains an archive.
Do not describe dated synthetic verification records as collected client findings or a fresh check
of a later version.

When handing work back, name what was changed, what was verified, and which assumptions still need confirmation from the team or future partner.
