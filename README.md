# StockCast

Sales Forecasting and Inventory Optimization for Small Retail Businesses Using XGBoost Algorithm.

StockCast uses a React/TypeScript frontend, one Python/FastAPI backend, PostgreSQL, and a separate
Python forecasting worker. The same application runs on a laptop and on a server using Docker
Compose. Normal startup opens an empty business catalog; add products and authorized sales records
through the interface.

## Run on your laptop

One-time prerequisites: Node.js 24 or newer and Docker Desktop with Linux containers running.
Open the repository folder in VS Code, open its terminal, and run:

```bash
npm start
```

You do not need to install Python, PostgreSQL, or frontend packages manually for this startup.
Docker builds the frontend and Python runtime, waits for PostgreSQL, applies migrations, creates
the initial owner, and starts the website, API, and forecast worker. The first build downloads
dependencies and can take several minutes.

Open **http://localhost:8080**. Choose **Create account** for your own empty store, or use the
initial owner account. The first start creates a private `.env` file and prints its setup details:

- Optional Business ID: `00000000-0000-4000-8000-000000000001`
- Email: `owner@example.com`
- Password: the generated `OWNER_PASSWORD` = `92a0ecce9eead6e8ec17abbe9fcd34071d16`

Keep `.env` private and keep a copy of it. To choose your account details before first startup,
run `npm run setup`, edit `.env`, then run `npm start`. Owner creation runs once per account;
restarting the app preserves its existing password.

| Command             | Purpose                                        |
| ------------------- | ---------------------------------------------- |
| `npm start`         | Build and start the complete application       |
| `npm run stop`      | Stop containers; saved database records remain |
| `npm run logs`      | Follow service logs                            |
| `npm run backup`    | Save a PostgreSQL backup under `backups/`      |
| `npm run benchmark` | Measure the read-only API and export JSON      |
| `docker compose ps` | Inspect service status                         |

## Accounts and Google sign-in

**Create account** lets each new user create an owner account and a separate store with an empty
catalog. Enter your name, store name, email, and a 12 to 128 character password, then choose
test-record or authorized-business-record provenance. Registration does not generate inventory,
sales, or research data. Public signup uses a previously unregistered email on this installation.

Existing users sign in with email/password. **Choose a specific business** retains an optional
Business ID for older accounts whose credentials match multiple stores. Active cookie sessions
restore automatically for their lifetime, normally 12 hours.

Google is optional. Configure server-only `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
`GOOGLE_REDIRECT_URI`, and the exact website `CORS_ORIGIN`; the Google button appears only when
the configuration is complete and valid. The default Compose callback is
`http://localhost:8080/api/v1/auth/google/callback`, with
`CORS_ORIGIN=http://localhost:8080`. Hosted callbacks use the real HTTPS origin.

Follow [the manual's Google setup and hosting instructions](docs/USER_GUIDE.md#18-configuration-and-hosting),
including Google Cloud's Web application client, consent/Audience configuration, and current
testing/publishing rules. Google may require account selection or consent. A first Google user
finishes store setup; a connected user signs in to the existing account.

Password users connect Google intentionally from **Inventory > Settings > Your account**.
Matching emails do not automatically connect identities. This preserves the signed-in user's
store and owner/staff permissions.

Password signup does not verify email. Password changes, single-use recovery, and owner-issued
staff invitations are implemented. Configure recovery/invitation email in the private root
`.env` using `SMTP_HOST`, `SMTP_PORT` (default 587), `SMTP_USERNAME`, `SMTP_PASSWORD`,
`SMTP_FROM`, and `SMTP_STARTTLS` (default `true`), as listed in [.env.example](.env.example).
Compose passes these settings to the API only. `PUBLIC_APP_URL` controls the website URL in
email links and defaults to `CORS_ORIGIN`; use the recipient-accessible public HTTPS URL when
hosting. Run `npm start` after changing the configuration and verify actual delivery.
Direct Python development uses [backend/.env.example](backend/.env.example) instead.
Per-process authentication attempt limits are documented in
[the backend README](backend/README.md#authentication-contract); multiple API replicas need shared
gateway limits. Successful live Google OAuth still needs verification with the deployment's
registered credentials. Other people need access to the same running website; a localhost URL
works only on that person's computer.

## Where records are saved

Products, sales, stock movements, imports, settings, accounts, forecast runs, predictions, and
metrics are saved in PostgreSQL. Docker keeps the database in the persistent
`stockcast_postgres_data` volume, including on Windows through Docker Desktop. Official XGBoost
model files are saved in `stockcast_model_data`. Containers can be recreated without clearing
those volumes.

Browser demonstration records use the separate `stockcast-v5` browser storage key. Older SQLite
records remain in their original SQLite files. Import an authorized inventory snapshot and
historical sales explicitly to transfer records to the PostgreSQL application. Historical sales
imports add history; inventory counts are saved as audited stock adjustments.

## Use the system

Open **Strategies > User guide** for the searchable guide covering every current page,
daily workflows, CSV formats, forecasts, restock calculations, setup, backups, hosting, and
troubleshooting. The manual can also be downloaded there and its source is
[the complete user guide](docs/USER_GUIDE.md). **Strategies > Evaluation** restores the earlier
five-criterion rating form. Ratings are browser-saved drafts, separate for each signed-in
business/account; they are not uploaded to the server.

1. Sign in and add products in **Inventory**.
2. Record sales and deliveries. A sale deducts stock; a delivery increases stock.
3. Import inventory or historical sales using the documented CSV columns in the interface.
4. Open **Forecasts → Refresh forecasts**. The Python worker saves the run and its outputs.
5. Review **Restock**. Suggested quantities apply when stock reaches the reorder point.
6. Export sales or stock movements from Inventory, and make database backups.

XGBoost eligibility requires enough _training_ history: eight calendar weeks and 100 nonzero sales
days by default. Short histories still receive a Python Moving Average baseline. Refresh uses
separate chronological training, validation, and final-test periods; fewer than three calendar
days can use the baseline but cannot form all three evaluation periods.

The worker uses the official CPU XGBoost package, selects parameters using the configured
training-only CV folds (default three), then chooses its operating method on later validation.
It evaluates identical final-test dates for all compared methods, then refits for future
operations. Frontend settings saves preserve backend thresholds, timezone, and fold count. Saved runs retain their input snapshot, model parameters, weights, predictions,
and metrics. New records or settings prompt a forecast refresh. See
[backend/README.md](backend/README.md) for the evaluation contract.

## Host online

Use a Linux server/container host that supports Docker Compose and persistent disks. A domain
points visitors to that server; the Python API, worker, and PostgreSQL must run there.

1. Download or clone this version of the repository on the server.
2. Install Docker Compose and Node.js 24 or newer.
3. Run `npm run setup` and edit the private `.env` before starting:
   ```dotenv
   APP_ENV=production
   APP_ADDRESS=stockcast.your-domain.com
   HTTP_PORT=80
   HTTPS_PORT=443
   CORS_ORIGIN=https://stockcast.your-domain.com
   ```
   Set your owner name/email/password and record provenance. Use URL-safe generated database
   passwords. Choose `OWNER_DATA_ORIGIN=partner` only for authorized real business records.
4. Point the domain's DNS A/AAAA records to the server and allow incoming ports 80 and 443.
5. Run **`npm start`**. Caddy obtains and renews HTTPS certificates for the configured public domain.
6. Open your HTTPS URL and sign in with your configured owner credentials or create a separate store account.

PostgreSQL is reachable only inside the Compose network. The application database role has no
superuser, role-creation, or database-creation privileges. Hosting account setup, DNS, disk
allocation, and backup retention are configured on the chosen server.

The local and hosted installations have separate databases. Move records through a deliberate
backup/restore or import when transferring to a host.

## Back up and check recovery

Run `npm run backup`. This produces a PostgreSQL custom-format dump that preserves tables, records,
and migration checksums. Copy the dump and your private configuration to your chosen backup
location. Copy trained model files separately:

```bash
docker compose cp worker:/app/data/models backups/models
```

You can check a dump by restoring it into a separate database. Replace the filename below with
the backup you created:

```bash
docker compose exec database createdb -U stockcast_admin -O stockcast stockcast_restore_check
docker compose cp backups/your-backup.dump database:/tmp/stockcast-backup.dump
docker compose exec database pg_restore -U stockcast -d stockcast_restore_check --exit-on-error /tmp/stockcast-backup.dump
docker compose exec database psql -U stockcast -d stockcast_restore_check -c "SELECT count(*) FROM products;"
```

The CI workflow checks backup restoration and persistence after container recreation. A live
hosting cutover and recovery drill use the deployment's own storage and credentials.

## Development and verification

For frontend hot reload, run `npm ci`, then `npm run dev`. Vite proxies `/api` to the Python API on
port 3001; see [backend/README.md](backend/README.md) for running Python directly with a PostgreSQL
development database.

The old browser prototype is an explicit optional mode: put
`VITE_DATA_MODE=browser-demo` in `.env.local` before `npm run dev`. It keeps synthetic browser data
and its custom boosted-tree demonstrations separate from the Python application. Container builds
use API mode by default.

Checks: `npm run typecheck`, `npm run lint`, `npm run build`, and
`python -m pytest backend/tests`. [.github/workflows/system.yml](.github/workflows/system.yml) runs
the full Compose installation with real PostgreSQL and the Python worker.

Read [AGENTS.md](AGENTS.md), [project context](docs/PROJECT_CONTEXT.md), and
[implementation checklist](docs/COMPLETION_CHECKLIST.md) before code changes. Real partner data,
permission, and research outcomes are documented separately from implementation checks.

## Data quality and performance

**Data quality** lets authenticated users distinguish confirmed zero-sale dates from closures,
incomplete ledgers, and documented full or partial stockouts. Corrections retain an audit trail and
can be exported as CSV. Absent dates are not silently treated as zero demand. See
[the benchmark procedure](docs/PERFORMANCE_BENCHMARK.md) for safe Windows Docker Desktop and Linux
VPS commands. Benchmark output is synthetic operational evidence, not client or research results.
