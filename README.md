# StockCast

Sales forecasting and inventory optimization for small retail shops. Pure client-side React app — open this folder in VS Code and run it locally.

## Open in VS Code

1. Unzip this folder.
2. File → Open Folder → select `stockcast`.
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
- In-browser XGBoost + moving-average forecast (`src/lib/forecast/`)

No backend, database, or auth. Demo data is seeded in `src/lib/data/seed.ts`.

## Layout

```
src/
  routes/          pages (overview, restock, forecasts, inventory, strategies)
  components/      UI and dialogs
  lib/forecast/    training pipeline, XGBoost, metrics
  lib/inventory/   reorder-point logic
  lib/data/        seed + fallback series
  lib/store.ts     app state
public/thesis/     source documents used by the Strategies page
```
