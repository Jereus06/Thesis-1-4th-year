# StockCast Setup and Operations

This reference is for the person installing, maintaining, backing up, or hosting StockCast. It contains the technical setup and service commands. For screen-by-screen instructions for owners and staff, use [How to use StockCast](USER_GUIDE.md), also available through the application's User guide button.

The operational procedures below are retained from the existing manual and separated from the everyday task guide. Check the installation's actual configuration before running administrative commands.

## Quick start

### What you need

Use Node.js **24 or newer** and Docker Desktop with its Linux container engine running.
Open a terminal in the StockCast project folder. Normal startup installs the application
dependencies inside Docker; you do not need to install Python or PostgreSQL on the laptop.

### First installation

1. Start Docker Desktop and wait for its engine to be ready.
2. To choose initial account details, run `npm run setup`, then edit the generated private `.env` file before the first startup. This step is optional.
3. Run `npm start`. The first build downloads dependencies and can take several minutes.
4. Wait for the terminal to print `StockCast is running:` and its address.
5. Open `http://localhost:8080` with the default local settings.
6. Sign in using your email and initial owner password, or choose **Create account** to create your own store.
7. Open **Inventory** and add products, then record or explicitly import authorized sales history.

If `.env` does not exist, setup/startup creates it with random database and owner passwords.
The default Business ID is `00000000-0000-4000-8000-000000000001`, and the default email is
`owner@example.com`. The generated password is the `OWNER_PASSWORD` value in your private
configuration. A customized Business ID or email takes precedence over those defaults. Business ID is now optional during sign-in; use **Choose a specific business** if your credentials match multiple older stores.

A fresh normal installation creates the business, settings, and owner account with an empty
catalog. There are no generated products or sales in the PostgreSQL application.

### Returning to the system

1. Start Docker Desktop.
2. Run `npm start` from the same project folder.
3. Open the address printed by startup. An active cookie session restores automatically; otherwise, sign in.
4. To stop the application, run `npm run stop`. Saved records remain in the database volume.

Keep `.env` private and retain a protected copy. Restarting preserves an existing account's
password; changing `OWNER_PASSWORD` in `.env` does not reset an account already in the database.

## How the parts work together

The website sends requests to the Python API. The API checks the signed-in user's business and
permissions, reads or changes PostgreSQL records, and returns results to the screen. Forecast
training runs in a separate worker so ordinary inventory and sales actions can continue.

| Part                          | What it does                                                                                | What you normally see                      |
| ----------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------ |
| React website                 | Displays pages, forms, charts, and validation messages                                      | The StockCast interface in your browser    |
| Caddy / web service           | Serves the built website and forwards API requests; manages hosted HTTPS                    | The website address                        |
| Python / api service          | Checks sessions and permissions; handles business actions and reads saved forecasts         | Success messages, records, and errors      |
| PostgreSQL / database service | Stores accounts, products, sales, stock movements, settings, jobs, predictions, and metrics | Records persist after an ordinary restart  |
| initialize service            | Applies existing migrations and creates missing initial business/account records            | It normally finishes with exit code 0      |
| Python / worker service       | Processes queued forecast jobs using the official Python XGBoost package                    | A queued/running/completed forecast status |
| Docker Compose                | Builds images, connects the services, checks readiness, and keeps persistent volumes        | Startup/build output in the terminal       |

A forecast refresh creates a job with a snapshot of its input records and settings. The worker
processes that snapshot, saves predictions and evaluation results to PostgreSQL, and stores
trained model JSON files in the model volume. Pages use saved results while a new run is pending.
The worker also queues a daily run automatically, normally at 00:15 in the store's saved timezone.
Staff receive its saved outputs without pressing Refresh; the worker service must remain running.

## Where records live and how devices share them

Normal-mode records live in PostgreSQL, not only in your browser. Different authorized users
connecting to the **same server** access that server's business records.

Separate laptop installations and a hosted installation have separate databases; they do not
synchronize automatically. Transfer authorized records deliberately through imports or a planned
backup/restore.

| Storage                                             | What it contains                                                                     |
| --------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `stockcast_postgres_data`                           | PostgreSQL records, accounts, settings, forecast jobs/results, and migration history |
| `stockcast_model_data`                              | Official trained XGBoost model JSON files                                            |
| `stockcast_caddy_data` and `stockcast_caddy_config` | Web server certificate/configuration data                                            |
| Browser demo's `stockcast-v5` storage               | Separate synthetic demonstration catalog, sales, and settings                        |
| Older SQLite files                                  | Older optional adapter records; not automatically migrated                           |

Those are the default volume names for the current Compose project. Ordinary container
recreation and `npm run stop` preserve named volumes. Removing volumes or using Docker's data
reset can erase stored records.

Forecast status/dashboard data are polled, but another browser's product/sales edits are not a
complete live refresh of your local catalog/ledger. Reload the application when you need to
see another user's latest catalog/ledger changes.

The sidebar label **Test records** or **Partner records** describes configured record provenance.
Setting `OWNER_DATA_ORIGIN=partner` does not prove that records came from a partner; use it only
for authorized actual business data. Browser-demo seeds remain synthetic regardless of their
older scenario label.

## Start, stop, logs, and service health

Run these commands from the project folder.

| Command                                         | Purpose                                                                    |
| ----------------------------------------------- | -------------------------------------------------------------------------- |
| `npm run setup`                                 | Create a missing private configuration without starting services           |
| `npm start`                                     | Build/start the complete Compose application and wait for readiness        |
| `npm run stop`                                  | Stop/remove application containers and network while keeping named volumes |
| `npm run logs`                                  | Follow recent service logs                                                 |
| `docker compose ps -a`                          | List running and exited services                                           |
| `docker compose logs --tail 100 worker`         | Inspect recent worker messages                                             |
| `docker compose logs --tail 100 api initialize` | Inspect API/initialization errors                                          |
| `npm run backup`                                | Create a timestamped PostgreSQL backup                                     |

`npm run logs` stays open; Ctrl+C stops following the logs. The services started by
`npm start` run detached, so closing that terminal does not stop them.

A healthy installation normally has database and api running/healthy, web and worker running,
and initialize exited with code 0. Initialize is a one-time successful step, not a service
that must stay running.

Compose publishes web HTTP/HTTPS ports. PostgreSQL and the API remain inside its network.
Changing the 180-second container-readiness wait is different from fixing a failed image build.

## Backups and a safe recovery check

### Create and retain a backup

1. Make sure the database service is running.
2. Run `npm run backup`.
3. Confirm the command succeeds and note the timestamped `.dump` file under `backups/`.
4. Copy that dump to your chosen protected backup location.
5. Keep a protected copy of your private configuration and copy trained model files separately.

```powershell
npm run backup
docker compose cp worker:/app/data/models backups/models
```

The backup is a PostgreSQL custom-format dump containing database tables, records, and migration
checksums. A failed backup command removes its incomplete dump.

| Included in the database dump                 | Saved separately                                                      |
| --------------------------------------------- | --------------------------------------------------------------------- |
| Products, sales, stock movements, imports     | Private `.env` configuration and access credentials                   |
| Business settings and account password hashes | Trained files from the model volume                                   |
| Forecast jobs, saved predictions, and metrics | Caddy certificate/configuration volumes if required by the deployment |
| Database migration history                    | Source/configuration needed to recreate the installation              |
| Submitted client surveys and their item responses | Browser storage, including evaluation drafts, and older SQLite files |

The database dump and separately copied model files are not one atomic snapshot. For
recovery-sensitive copies, arrange a quiet period without a running forecast job.
A restored database preserves existing account password hashes; restoring is not a password
reset.

### Test a dump without replacing the live database

The following example restores into a **new, separate** database. Replace
`backups/your-backup.dump` with the file you created. The check-database name must not already
exist. An installation administrator should run this check.

```powershell
docker compose exec database createdb -U stockcast_admin -O stockcast stockcast_restore_check
docker compose cp backups/your-backup.dump database:/tmp/stockcast-backup.dump
docker compose exec database pg_restore -U stockcast -d stockcast_restore_check --exit-on-error /tmp/stockcast-backup.dump
docker compose exec database psql -U stockcast -d stockcast_restore_check -c "SELECT count(*) FROM products;"
```

Successful restoration and a product count provide a basic recovery check. Compare expected
records and exercise the restored application's workflows in an isolated environment for a
full drill. Live cutover requires a planned transfer of database, model files, configuration,
and credentials, with team-approved record validation. These commands do not replace the
running business database.

Choose backup frequency, retention, destination, and responsibility with the team/business.

## Configuration and hosting

Installation administrators manage root `.env`. The website's Settings screen manages the
business/forecast fields described earlier.

| Environment value                      | What it controls                                                            |
| -------------------------------------- | --------------------------------------------------------------------------- |
| `POSTGRES_PASSWORD`                    | Initial database administrator password                                     |
| `APP_DB_PASSWORD`                      | Initial restricted application database-role password                       |
| `OWNER_PASSWORD`                       | Initial owner's password, at least 12 characters                            |
| `OWNER_BUSINESS_ID`                    | Initial business UUID                                                       |
| `OWNER_BUSINESS_NAME`                  | Initial business name                                                       |
| `OWNER_DISPLAY_NAME` and `OWNER_EMAIL` | Initial account identity                                                    |
| `OWNER_DATA_ORIGIN`                    | `demo` or `partner` record provenance                                       |
| `APP_ENV`                              | Development or production behavior, including secure cookies                |
| `APP_ADDRESS`                          | `:80` for local HTTP, or a public hostname for HTTPS                        |
| `HTTP_PORT` and `HTTPS_PORT`           | Published host ports; local defaults 8080 and 8443                          |
| `CORS_ORIGIN`                          | Allowed frontend origin; Compose defaults to `http://localhost:8080`        |
| `PUBLIC_APP_URL`                       | Website URL in recovery/invitation email; Compose defaults to `CORS_ORIGIN` |
| `SMTP_HOST` and `SMTP_PORT`            | Optional mail server and port; default port 587                             |
| `SMTP_USERNAME` and `SMTP_PASSWORD`    | Private mail-server credentials                                             |
| `SMTP_FROM`                            | Sender address for recovery/invitation email                                |
| `SMTP_STARTTLS`                        | Upgrade the SMTP connection with STARTTLS; defaults to `true`               |
| `GOOGLE_CLIENT_ID`                     | Optional Google Web application OAuth client ID                             |
| `GOOGLE_CLIENT_SECRET`                 | Optional private server-only Google OAuth secret                            |
| `GOOGLE_REDIRECT_URI`                  | Optional registered callback at the exact website origin                    |

Use URL-safe generated database passwords, such as hex values. Changing environment database
passwords after PostgreSQL's persistent volume exists does not rotate the existing role
passwords. The database administrator must coordinate actual credential changes.

### Hosted installation

1. Prepare a persistent server with Docker Compose and Node.js 24 or newer.
2. Run `npm run setup` and configure private credentials before its first initialization.
3. Set the real domain and production values. The example below is a placeholder, not a deployed StockCast domain.
4. Point the domain's DNS to the server and allow incoming HTTP/HTTPS ports 80 and 443.
5. Run `npm start`. Caddy manages HTTPS certificates for the configured public domain.
6. Open the HTTPS address, sign in, and verify the actual installation and recovery plan.

```dotenv
APP_ENV=production
APP_ADDRESS=stockcast.your-domain.com
HTTP_PORT=80
HTTPS_PORT=443
CORS_ORIGIN=https://stockcast.your-domain.com
```

Production cookies require HTTPS. Keep the configuration, server access, storage, and backup
retention under the deployment administrator's control. A laptop and the server do not
automatically share existing records.

### Recovery and staff-invitation email

Set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_FROM`, and
`SMTP_STARTTLS` in the private root `.env` for Docker Compose. The API receives these
variables; the worker and initializer do not. For direct Python development, use
`backend/.env` instead. Both environment examples list the settings.

Compose defaults `PUBLIC_APP_URL` to `CORS_ORIGIN`. Set it explicitly if email links need
another recipient-accessible website URL; hosted links must use the public HTTPS website.
Run `npm start` to recreate the API with changed configuration. Verify recovery and invitation
delivery on the configured installation; automated tests use a mock mail transport.

### Optional Google setup

Google is optional; email/password registration and sign-in work without its credentials.
The administrator configures the server's private environment. Keep the Google client secret
out of source control, screenshots, browser code, and any variable starting with `VITE_`.

1. Create/select a Google Cloud project and configure Google Auth Platform **Branding**, support/contact details, and **Audience** for the people who will use the installation. See [Google's Auth Platform setup](https://support.google.com/cloud/answer/15544987?hl=en).
2. Under **Clients**, create a **Web application** OAuth client. Register the exact callback from the table below as an **Authorized redirect URI**. Scheme, host, port, and path must match. See [Google's web-server OAuth setup](https://developers.google.com/identity/protocols/oauth2/web-server).
3. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REDIRECT_URI` in the appropriate private server configuration. Set `CORS_ORIGIN` to the exact website origin, with no API path. Compose uses the root `.env`; direct Python development uses `backend/.env`.
4. Review Audience/test users and publishing status before rollout. Google documents an exception to the usual Testing user-list/seven-day limits for the basic `openid email profile` scopes StockCast requests. Other scopes or organizational restrictions can change availability. Follow [Google's current Audience rules](https://support.google.com/cloud/answer/15549945?hl=en).
5. Run `npm start` to rebuild/recreate Compose with the new configuration, or restart the direct development API. Reopen the matching website origin.
6. Verify real Google sign-in, first-account setup, and intentional account connection on that installation. Keep a record of the actual result; code and mocked-provider tests do not establish successful live OAuth.

| Installation                       | `CORS_ORIGIN` / website origin      | `GOOGLE_REDIRECT_URI` / registered callback                     |
| ---------------------------------- | ----------------------------------- | --------------------------------------------------------------- |
| Default local Compose              | `http://localhost:8080`             | `http://localhost:8080/api/v1/auth/google/callback`             |
| Vite with direct Python API        | `http://localhost:5173`             | `http://localhost:5173/api/v1/auth/google/callback`             |
| Hosted example, replace the domain | `https://stockcast.your-domain.com` | `https://stockcast.your-domain.com/api/v1/auth/google/callback` |

Hosted callbacks require HTTPS. The callback must use the same origin as `CORS_ORIGIN` and
the exact path `/api/v1/auth/google/callback`, with no trailing slash, query, or fragment.
Register a changed host/port in Google too. Use the same hostname throughout a flow; localhost
and 127.0.0.1 have different cookies.

### Authentication attempt limits

The API limits registration attempts to **five per hour per client IP**, password sign-in to
**ten per minute per client IP and email**, and throttled authentication writes to a shared
**120 per minute per client IP**. Google flow starts also have ten attempts per minute per IP.
An HTTP 429 response means wait for the stated retry interval.

These counters are held in each API process. A deployment with multiple processes/replicas
needs coordinated limits at its gateway or another shared limiter; process-local limits alone
do not enforce a single installation-wide quota.

## Optional browser demonstration

The browser demonstration is an explicit development mode for synthetic examples. It bypasses
sign-in, stores records locally in that browser, and uses custom TypeScript boosted trees.
That prototype is not the official Python XGBoost implementation and does not establish
validated research accuracy.

For developers, install frontend dependencies, set this in `.env.local`, and start Vite:

```dotenv
VITE_DATA_MODE=browser-demo
```

```powershell
npm ci
npm run dev
```

Restart Vite after changing mode. Normal container builds use API mode by default.

### Differences to expect

- The seed catalog/store/location and generated sales are synthetic placeholders, even if an older scenario setting says `partner`.
- Data stay in this browser's `stockcast-v5` storage; another browser/device has separate demo data.
- The demo display date is fixed rather than the normal live header date.
- Prototype forecast training can be triggered in the background after data changes; its caches/illustrative intervals are distinct from Python saved runs.
- The demo Watch band is a fixed ten days of cover; normal Python mode uses lead time plus configured cover days.
- API CSV export controls are not part of this browser-only persistence workflow.
- **Reset demo data** immediately replaces local demo products, sales, and settings with the seed data. Export/save anything you need before using it.

### Extra prototype Strategies tools

The browser Strategies page has **Accuracy**, **Speed**, **Thesis text**, **Models**,
**User guide**, and **Evaluation** tabs. Accuracy/Speed describe prototype reliability levels and architecture
techniques; Speed has **Retrain models**. Models shows prototype parameters, errors, and
inventory mathematics.

Evaluation uses the same four-characteristic client questionnaire as normal mode, with its own
browser-demo draft. **Save draft** preserves answers locally; browser demonstration mode cannot
submit them to the server. Unanswered and Not applicable items remain unscored, and earlier demo
ratings remain a read-only archive. The User guide tab provides the separate searchable task guide in [USER_GUIDE.md](USER_GUIDE.md). Synthetic demo behavior and draft ratings do not establish client findings, research
results, or standards compliance.

Older SQLite adapter commands are a separate optional legacy demonstration. They are not the
normal PostgreSQL startup and do not automatically migrate into it.

## Installation troubleshooting

### Startup/build problems

| Message or symptom                                       | Meaning and next step                                                                                                                            |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Start Docker Desktop first                               | Start its Linux engine; check `docker info`, then retry `npm start`                                                                              |
| Replace the password placeholders                        | Replace remaining `replace_with_` values in the private configuration                                                                            |
| `python:3.12-slim ... TLS handshake timeout`             | Docker timed out on a secure registry request; restart Desktop, try `docker pull python:3.12-slim`, then retry startup                           |
| `rpc error ... EOF` during export                        | The build-status connection closed; the message alone does not establish why. Restart Docker Desktop and inspect its build details if it repeats |
| `DONE`, `CACHED`, pip root warning, or pip update notice | Ordinary build status/notices; find the later actual failing step                                                                                |
| Startup failed                                           | The wrapper reports a failed Compose command; inspect the preceding error                                                                        |
| initialize exited 0                                      | Normal completion of the initialization step                                                                                                     |
| Website cannot be reached                                | Check `docker compose ps -a`, configured web port, and service logs                                                                              |

For a registry timeout, run the pull separately to check whether the required base image can
be retrieved:

```powershell
docker pull python:3.12-slim
npm start
```

If the pull fails, check connectivity and any VPN/proxy configuration. A timeout does not prove
which network component caused it. Docker's [troubleshooting guide](https://docs.docker.com/desktop/troubleshoot-and-support/troubleshoot/)
covers restarting Desktop; its [settings documentation](https://docs.docker.com/desktop/settings-and-maintenance/settings/)
covers proxies.

Build failures occur before application containers run, so `npm run logs` may have no relevant
container messages. Use the earlier build output and Docker Desktop's linked build details.
Increasing the container-readiness timeout does not repair registry TLS failures or build EOF.

## Development and implementation reference

This section is for the team maintaining the installation. Ordinary business use starts with
`npm start`; the commands here serve development.

`npm ci` installs the locked frontend packages. `npm run dev` provides frontend hot reload,
normally on port 5173. Its default API proxy points to `http://127.0.0.1:3001`. Compose does
not publish that API port, so unmodified Vite development needs a directly running Python API
or an intentionally configured alternative proxy.

Use Python 3.12 and a dedicated PostgreSQL development database. Configure the private
`backend/.env` from `backend/.env.example`; this is separate from Compose's root `.env`.
The backend README contains the database and owner setup details.

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install -r backend/requirements-lock.txt
python -m pip install --no-deps -e "./backend[forecast,test]"
python -m backend.app.initialize
python -m uvicorn backend.app.main:app --host 127.0.0.1 --port 3001 --reload
```

Run the worker in a second activated terminal with the same development configuration:

```powershell
python -m backend.app.worker
```

The direct API documentation is available at `http://127.0.0.1:3001/docs`. Inspect the actual
schema and authentication requirements before administrative API actions. This is the direct
development address, not a published Compose port.

| Files                                                       | Responsibility                                                  |
| ----------------------------------------------------------- | --------------------------------------------------------------- |
| `scripts/start.mjs`, `compose.yaml`, Dockerfiles, `deploy/` | Setup, service orchestration, builds, and web serving           |
| `scripts/backup.mjs`                                        | PostgreSQL dump creation                                        |
| `backend/app/main.py`, schemas, security, repository        | Python API contract, authorization, and database operations     |
| `backend/app/auth_routes.py`, auth_repository, google_auth  | Registration, Google identity, and existing session integration |
| `backend/app/forecasting.py`, worker, dashboard, inventory  | Model jobs, saved outputs, and reorder calculations             |
| `backend/db/`                                               | Existing SQL migration history                                  |
| `src/routes/`, `src/components/`                            | Website pages and user controls                                 |
| `src/lib/api.ts`, store, API forecast hook                  | Normal-mode frontend/API integration                            |
| `src/lib/forecast/`                                         | Separate browser demonstration forecasting                      |
| `docs/USER_GUIDE.md`                                        | Everyday task guide used by the website and manual download         |
| `docs/PROJECT_CONTEXT.md`                                   | Confirmed implementation/project facts                          |

### Verification commands

```powershell
npm run typecheck
npm run lint
npm run build
python -m pytest backend/tests
```

The system CI also checks Compose startup, worker/API behavior, backup restoration, and
persistence. Local checks do not prove a successful hosted deployment or validated forecast
accuracy. Preserve the existing database contract/migration history and the groupmate-reserved
date helper described in `backend/docs/RESERVED_DATE_HELPER.md`.

## Glossary and decisions still needed

| Term                     | Meaning                                                                            |
| ------------------------ | ---------------------------------------------------------------------------------- |
| SKU                      | Stable catalog identifier for a product                                            |
| On hand                  | Current stock balance in the product's counting unit                               |
| Lead time                | Expected days from ordering to receipt                                             |
| Safety stock             | Additional units held as a buffer                                                  |
| Reorder point / ROP      | Stock threshold that triggers a suggested replenishment                            |
| Cover days               | Estimated days the stock can support demand, or configured coverage after delivery |
| Horizon                  | Number of future dates predicted                                                   |
| Nonzero sales day        | A distinct date with positive total sales                                          |
| Moving Average / MA      | Baseline based on recent daily sales                                               |
| XGBoost                  | Official Python boosted-tree model in normal mode                                  |
| Ensemble                 | Weighted combination of MA and XGBoost                                             |
| Validation               | Later dates used for method/weight selection and separate interval calibration     |
| Holdout / final test     | Later date range used to measure the frozen selection                              |
| MAE / RMSE               | Error measures in product units; lower means smaller evaluated error               |
| Snapshot                 | Captured input/counts at a particular point                                        |
| Provenance / data origin | Whether records are test data or authorized business data                          |
| Volume                   | Docker's persistent storage kept separately from containers                        |

The team/future partner still needs to confirm the real catalog and units, supplier policies,
ledger completeness, treatment of missing days and stockouts, correction/void procedures,
authorized data collection/import mapping, backup retention, deployment settings, and independent
research evaluation cutoffs. The guide does not invent those decisions or claim an approved
manuscript, completed partner evaluation, or certified model accuracy.
