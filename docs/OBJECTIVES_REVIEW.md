# Objectives and strategy review — 5 October 2026

Reviewed source: `main` at `662635749778fc1f9789a6f23b1a61e402ce4c90` (merged PR #18),
including the six uploaded account, forecast, timing, benchmark, and client-survey fixes.
This review applies the seven objectives and the owner's public-data/client-only survey decisions.
It assesses implementation and test evidence, not uncollected client findings or deployed uptime.

## Objective mapping

| Objective | Implemented code and evidence | Research or installation evidence to collect |
| --- | --- | --- |
| 1. Integrated sales, stock, preparation, Python backend, persistence | `backend/app/main.py`, `repository.py`, inventory/import modules, API frontend, Compose; transaction, scope, import, recovery checks | Confirm actual installation and authorized source/import mapping |
| 2. Moving Average, official XGBoost, named fallback | `forecasting.py`, `worker.py`, `dashboard.py`; official package, training-only gates/ranking, explicit fallback | Select/document a permitted source and its eligible products |
| 3. Fair chronological comparison | Training-only folds, earlier method selection, reserved calibration, untouched fixed-origin final-test predictions; matching dashboard comparison observations | Record research cutoffs and report actual common-observation MAE/RMSE |
| 4. Data quality and limited evidence | `data_quality.py`, quality API/UI, immutable audit history, frozen preparation, unavailable/expired evidence; calendar regressions added here | Confirm source completeness, units, and stockout interpretation |
| 5. Processing and response measurements | Disjoint worker phases, authenticated idle/running API benchmark, actual-browser procedure, preserved raw synthetic reports | Measure the intended installation and label environment/provenance; observe VPS uptime separately |
| 6. Transparent restocking | `inventory.py`/dashboard and reorder tests: ROP, order-up-to, gated whole-unit suggestion, unknown-demand handling | Confirm lead time, stock, safety stock, and coverage assumptions |
| 7. Client and engineering evaluation | Canonical 12-item/four-characteristic client questionnaire, private drafts, immutable PostgreSQL submissions, role-aware summary/CSV; separate technical evidence | Questionnaire approval, actual client administration, and recorded technical findings |

All seven have implementation support. Objectives that require measured research outcomes are
fulfilled as research objectives only after those outcomes are collected and reported. Confidential
client sales records are not a prerequisite: permitted public retail records can support the
forecast experiment, while the client survey remains owner/manager and staff only.

## Both strategies

- Strategy 1: reviewed targets; seven past-only daily features; official regularized XGBoost,
  training-only chronological folds and earlier-validation early stopping; validation-weighted
  ensemble/method selection; reserved residual calibration and separate final-test coverage.
- Strategy 2: independent worker and serving API; PostgreSQL results and persistent model artifacts;
  training-only top-N eligibility/ranking; compact grid/default three folds; asynchronous queue,
  interruption handling, and authenticated/API plus browser measurement procedures.

Weekly aggregation, pooled category features, holiday/promotion proxies, a fixed 06:00 training
schedule, and guaranteed future interval coverage are not claimed as implemented features.

## Defects fixed in this review

1. Worker fallbacks used a global newest-product cutoff, moving old products' predictions forward.
   They now use the product's own last usable day; expired demand cannot appear current after Refresh.
2. Fallback windows compressed unknown/excluded dates. They now use the contiguous usable tail,
   preserving confirmed-zero observations without bridging gaps.
3. Sparse test targets consumed consecutive forecast positions instead of elapsed calendar steps.
   Forecasts now retain calendar spacing and score only usable targets.
4. Empty pre-test history manufactured zero predictions and misleading metrics. Test evidence is
   now unavailable without usable history at the validation cutoff.
5. Earlier saved baselines could continue serving the affected results after upgrade. Their rows
   remain archived, but current serving uses the conservative preview and requires Refresh.
6. CI omitted new account, survey, and benchmark regressions. It now runs all `scripts/test-*.mjs`
   sequentially, retaining PostgreSQL, startup, smoke, backup/restore, and restart checks.
7. Chapter mirrors and the paste/download strategy text described an unfinished browser backend,
   old features/splits, and the removed partner-record objective. They now describe the implemented
   Python architecture, seven objectives, permitted public-data procedure, and four-trait client
   survey. The outdated Word insert is no longer offered from the current text panel; archived
   artifacts and the formal external manuscript are preserved.

No existing SQL migrations, business records, or original benchmark reports were rewritten.
The reserved groupmate date helper remains reserved.

## Fresh local verification

- `npm run typecheck`, `npm run build`: passed.
- `npm run lint`: passed with the same three existing Fast Refresh warnings.
- Frontend/Node regressions excluding `test-compose-email.mjs`: **109 passed**.
- Full Python collection/execution: **245 passed, 66 skipped** because no isolated PostgreSQL
  test database or Docker installation is available in this review runner.
- The six focused worker calendar cases failed before the fix, then passed; related dashboard
  and phase-timing checks passed. A real PostgreSQL Refresh/worker/dashboard regression is included
  in the full CI suite.
- Python compilation and `git diff --check`: passed.

All 112 Node checks (including the three Docker configuration checks) and the complete PostgreSQL
suite are required in the pull request's Docker-capable GitHub workflow. Consult its actual check
result before merging. The existing `docs/REVIEW_VERIFICATION.md` and raw benchmark reports describe
earlier independent measurements; they have not been relabeled as measurements from this review.

Actual Hostinger/VPS configuration, live SMTP/Google OAuth, questionnaire approval, public-source
research evaluation, client feedback, and observed uptime remain installation/research activities.
