# StockCast

Sales forecasting and inventory optimization for small retail businesses. This repository contains
the React demonstration frontend and an in-progress Python/FastAPI/PostgreSQL backend. New coding
sessions should read [AGENTS.md](AGENTS.md), the [project context](docs/PROJECT_CONTEXT.md), and the
[completion checklist](docs/COMPLETION_CHECKLIST.md) first.

## Open in VS Code

1. Clone or download this repository.
2. File → Open Folder → select the repository root.
3. Open the integrated terminal (`Ctrl+\`` / `Cmd+\``).
4. Install dependencies and start the dev server:

```bash
npm install
npm run dev
```

5. Open the URL Vite prints (http://127.0.0.1:5173). The shared host name is intentional so
   SameSite session cookies work with the local API on port 3001.

Recommended extensions (prompted on first open): ESLint, Prettier, Tailwind CSS IntelliSense.

## Scripts

| Command                | What it does                        |
| ---------------------- | ----------------------------------- |
| `npm run dev`          | Dev server with hot reload          |
| `npm run build`        | Typecheck + production build        |
| `npm run preview`      | Serve the production build          |
| `npm run typecheck`    | TypeScript only                     |
| `npm run lint`         | ESLint                              |
| `npm run backend:dev`  | FastAPI backend in reload mode      |
| `npm run backend:test` | Python backend tests                |
| `npm run db:migrate`   | Apply pending PostgreSQL migrations |

## Stack

- Vite + React 19 + TypeScript
- TanStack Router (file routes in `src/routes/`)
- Tailwind CSS v4
- Zustand (`src/lib/store.ts`) — the current frontend demonstration persists in `localStorage`
- Python 3.12, FastAPI, psycopg, and PostgreSQL under `backend/`
- In-browser custom boosted-tree prototype (currently labeled XGBoost in the UI) and moving-average forecast (`src/lib/forecast/`); the model and final evaluation still require validation.

The backend provides PostgreSQL migrations, product/settings/sales/movement APIs, and an
authentication foundation, but the frontend is not yet connected to it and production security is
not complete. Demo products and synthetic sales are seeded in `src/lib/data/seed.ts`; displayed
metrics are not results from a real partner business.

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
backend/           Python API, PostgreSQL migrations, and backend tests
docs/              architecture, project context, thesis mirrors, completion checklist
```
