# StockCast

Sales forecasting and inventory optimization for small retail businesses. This repository currently contains a browser-only React prototype with synthetic demonstration data. The backend is under development. New coding sessions should read [AGENTS.md](AGENTS.md) and [project context](docs/PROJECT_CONTEXT.md) first.

## Open in VS Code

1. Clone or download this repository.
2. File → Open Folder → select the repository root.
3. Open the integrated terminal (`Ctrl+\`` / `Cmd+\``).
4. Install dependencies and start the dev server:

```bash
npm install
npm run dev
```

5. Open the URL Vite prints (usually http://localhost:5173).

Recommended extensions (prompted on first open): ESLint, Prettier, Tailwind CSS IntelliSense.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Dev server with hot reload |
| `npm run build` | Typecheck + production build |
| `npm run preview` | Serve the production build |
| `npm run typecheck` | TypeScript only |
| `npm run lint` | ESLint |

## Stack

- Vite + React 19 + TypeScript
- TanStack Router (file routes in `src/routes/`)
- Tailwind CSS v4
- Zustand (`src/lib/store.ts`) — catalog, sales, settings persist in `localStorage`
- In-browser custom boosted-tree prototype (currently labeled XGBoost in the UI) and moving-average forecast (`src/lib/forecast/`); the model and final evaluation still require validation.

The checked-in `main` branch has no backend, database, or auth. Backend development and database design are in progress outside this branch. Demo products and synthetic sales are seeded in `src/lib/data/seed.ts`; displayed metrics are not results from a real partner business.

## Layout

```
src/
  routes/          pages (overview, restock, forecasts, inventory, strategies)
  components/      UI and dialogs
  lib/forecast/    training pipeline, XGBoost, metrics
  lib/inventory/   reorder-point logic
  lib/data/        seed + fallback series
  lib/store.ts     app state
public/thesis/     documents used by the Strategies page (may lag latest drafts)
```
