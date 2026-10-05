# Thesis Chapter 3

> Repository methodology revised on 2026-10-05 against the Python application, seven objectives, and client-only questionnaire. This is an implementation-aligned text companion, not a replacement for the formal manuscript's layout, figures, adviser approval, or collected results. Existing literature attribution is retained; references belong in the manuscript's final reference section.

## CHAPTER III — METHODOLOGY

### Research Design

The study combines system development with quantitative forecast and software evaluation. StockCast integrates a React/TypeScript frontend, a Python/FastAPI API, a separate Python forecast worker, PostgreSQL persistence, and saved model artifacts. Forecast comparisons use Moving Average, official Python XGBoost, and a validation-weighted ensemble on common eligible product-date observations. Inventory advice applies explicit reorder formulas rather than claiming a measured total-cost optimum.

Forecasting data and client evaluation serve different purposes. Authorized partner records may support the forecast experiment; when confidential or unavailable, a documented permitted public retail dataset may be used. Client survey respondents remain the participating business's owner/manager and staff. They can perform controlled tasks without releasing confidential records. Software fixtures, public-data results, and collected client findings retain their separate provenance.

### Development Approach

Development follows requirements review, data preparation, system design, forecast implementation, integration, functional checks, independent evaluation, and refinement. Git versioning and regression checks document changes. Python enforces authenticated business scope and owner/staff permissions; the frontend presents the corresponding actions. PostgreSQL stores operational records, forecast snapshots/results, reviewed-day audit history, and immutable survey submissions. Database dumps and isolated restoration support recovery verification.

The optional browser-demo and SQLite demonstration are separate development paths. Normal `npm start` runs the PostgreSQL/Python application through Docker Compose. Empty normal accounts do not receive generated business records. The custom browser booster is not the official XGBoost runtime used in the forecast experiment.

### Data Collection Procedure

The researchers request only the dated product, sales, stock, and replenishment fields authorized for the study. Participation in the client survey does not require the business to disclose confidential sales records.

If partner exports are unavailable, confidential, incomplete, or too short, the researchers may select reliable public retail transaction or daily-sales records. Before use, they record the original publisher, dataset citation/URL, access date, version or file identity, permitted use, product identifiers, units, date range, and known limitations. Public availability alone does not establish permission or completeness. Public source findings are reported as benchmark findings for that source, not as results for the client business.

| Field | Purpose |
| --- | --- |
| Product/SKU | Stable mapping of records to products; retained as an identifier, not an XGBoost regressor |
| Date | Daily chronological grouping and forecast cutoffs |
| Quantity sold | Observed target quantity in documented product units |
| Source record key, when available | Transaction identity and duplicate-import control |
| Completeness, closure, or stockout information | Reviewed classification of absent or censored observations |
| Stock, lead time, safety stock, coverage | Inventory scenarios or authorized operational settings |
| Unit cost, when available | Inventory display; not a forecasting feature |

Source sales do not establish current stock, supplier lead times, or lost demand. If the public source lacks those fields, inventory checks use explicitly controlled scenarios. Customer-identifying fields are omitted where unnecessary. Authorized partner retention and export arrangements are recorded before importing real business records.

An optional owner interview may clarify workflow and stock settings. Release of confidential records is not a separate required objective. Dataset selection, eligibility, exclusions, horizon, and research cutoffs are documented before final-test outcomes are interpreted.

### Data Preparation and Quality Review

Imports check dates, quantities, SKU mapping, duplicate identity, and transaction integrity. Historical sales imports preserve current stock; manual sales and stock movements follow their separate audited balance rules. Transactions are aggregated to product/day totals without filling absent dates with zero.

The Data quality screen supports store-wide and product-specific confirmed-zero, business-closed, incomplete, full-stockout, and partial-stockout reviews with notes. Product-specific reviews take precedence. Create, update, and delete actions retain immutable previous/current values, responsible user, and database timestamps for audit CSV export.

Only observed sales and effective confirmed-zero dates become targets. Closures, incomplete records, and stockouts remain excluded. Positive sales that contradict a zero review are retained with a warning rather than overwritten. Unknown absent dates remain unknown. A sale quantity on a stockout date is not assumed to equal unconstrained demand.

Refresh captures immutable daily inputs, prepared targets and provenance, classifications, settings, product IDs, and business-day bounds. The worker uses those frozen inputs even if live reviews change later. Later changes mark saved forecasts stale. Classification deletion also invalidates through retained audit history.

### Moving Average Model

The baseline averages a configured recent window, default seven daily observations:

`MA_t = (D_(t-1) + ... + D_(t-n)) / n`

Multiple future days are predicted recursively using preceding predictions, without feeding final-test actuals into earlier steps. For sparse fallback products, the seed is the contiguous usable tail. An unknown or excluded day ends that tail; observations on either side are not compressed into consecutive daily lags.

Final-test fallback predictions require usable history at the fixed validation cutoff. Forecast steps count elapsed calendar days, while only actual observed/confirmed-zero test targets are scored. A missing test target is not zero-filled. If no usable cutoff history exists, test predictions and metrics are unavailable rather than manufactured as zeros.

Operational fallback dates start after each product's own last usable observation. Another product's newer data cannot move an older forecast forward. Current advice excludes elapsed prediction dates and reports expired or unavailable demand. Saved baselines from the earlier calendar policy require Refresh; historical rows remain archived, while current serving uses the conservative preview.

### Official Python XGBoost Model

The worker uses `xgboost.XGBRegressor`, fitted separately for eligible products with `n_jobs=1`, squared-error objective, fixed seed 42, `reg_lambda=1.5`, and row/column sampling of 0.9. Its actual seven features are lag 1, lag 7, lag 14, rolling mean 7, rolling mean 30, weekday, and month. Thirty prior observations provide feature warm-up. Product/category identifiers and unrecorded promotion or holiday proxies are not production model inputs. Weekly aggregation is not enabled in this daily runtime.

Default training gates require a complete observed-or-confirmed-zero daily sequence, at least eight calendar weeks, and at least 100 nonzero days. Eight weeks alone cannot meet 100 nonzero days. These defaults are implementation safeguards, not a universal scientific minimum. Matching complete validation/test calendars are additionally required for XGBoost comparison. Eligible products are ranked by training-period volume only; at most eight train by default, and the remainder receive a disclosed fallback.

The compact candidate grid is:

| Maximum depth | Learning rate | Maximum estimators |
| --- | --- | --- |
| 3 | 0.05 | 300 |
| 4 | 0.05 | 300 |
| 3 | 0.10 | 240 |

Parameter selection uses expanding chronological folds wholly inside training, default three folds with 14-day check windows and at least 45 initial training days. If all configured folds cannot fit, the conservative first candidate is used and zero effective folds plus the reason are saved. The folds are constructed explicitly; the implementation does not claim to call scikit-learn `TimeSeriesSplit`.

Official-library early stopping uses the earlier method-selection validation segment with a patience of 15 rounds. The selected estimator count, parameters, requested/effective folds, and selection fallback are persisted.

### Model Training and Testing

Training precedes validation, and validation precedes the untouched final test. When validation contains at least 20 observations, the later `max(10, floor(validation_count / 3))` observations are reserved for interval calibration after method selection. Earlier validation chooses early stopping, inverse-MAE ensemble weights, and the operating method. Shorter validation leaves interval evidence unavailable.

Normal Refresh reserves up to 14 final-test days and, where training can retain its configured minimum, 20–28 validation days. With complete daily history and default settings, 134 days permit a 100/20/14 split and 142 days permit 100/28/14. These software defaults do not fix a research dataset's cutoffs: the experiment records its dataset, products, dates, horizon, and exclusions before reporting final results (Hyndman & Athanasopoulos, 2021).

After method selection, a refit on preceding training/validation observations predicts all compared final-test dates recursively from one fixed cutoff. No final-test quantity determines parameters, weights, operating method, or calibration residuals. The operating model is then refitted on available observations with the frozen configuration for future serving. Research test predictions and operational future predictions are identified separately.

`w_XGB = (1 / max(MAE_XGB, 1e-9)) / ((1 / max(MAE_XGB, 1e-9)) + (1 / max(MAE_MA, 1e-9)))`

`w_MA = 1 - w_XGB`

The operating method minimizes the earlier validation MAE among Moving Average, XGBoost, and their ensemble. It is not chosen by the final-test winner. Dashboard aggregate comparisons use matching eligible products/date observations; fallback-only products are reported separately.

### Strategy 1 — Five Levels of Accuracy and Reliability

1. **Data:** Validate inputs, review zero/missing/closure/stockout days, freeze preparation, enforce eligibility, and disclose fallback evidence. No generated series silently replaces source records.
2. **Features:** Use the seven past-only daily features; preserve calendar spacing and feature warm-up.
3. **Model:** Fit official regularized XGBoost, use bounded training-only chronological folds, and apply earlier-validation early stopping with saved decisions.
4. **Ensemble:** Compute inverse-MAE weights and select the operating method before the untouched final test. Report the baseline fairly even when it wins.
5. **Uncertainty:** Use reserved calibration residuals for nominal 80% bounds and record final-test coverage separately. Data-sufficiency warnings remain descriptive.

The interval uses the selected method's 10th/90th calibration-residual quantiles, clipped at zero. Saved evidence includes calibration dates/count, residual offsets, nominal coverage, and untouched final-test coverage and denominator. Small time-ordered samples and later refits do not guarantee future coverage. Products without calibration evidence show unavailable intervals; browser demonstration bands remain illustrative.

### Strategy 2 — Five Techniques of Speed and Architecture

1. **Separate training and serving:** The Python worker claims queued runs independently. Dashboard/API reads do not fit XGBoost.
2. **Persist results:** PostgreSQL stores immutable inputs, predictions, metrics, choices, and timings; model JSON files use a persistent volume. Valid saved results remain available during a new run.
3. **Prioritize eligible products:** Training-only ranking and the configurable top-N budget bound expensive work without removing products from stock management.
4. **Bound validation cost:** The compact grid and default three chronological folds control fit count; requested/effective folds and short-history fallback are recorded.
5. **Execute asynchronously and measure:** Explicit Refresh queues work. Advisory locks detect interrupted workers, and failure cleanup prevents partially published results being presented as completed. Authenticated API and actual-browser procedures measure responsiveness during confirmed worker activity.

The worker polls continuously while its service runs; no fixed 06:00 retraining schedule is implemented. Offline means training runs outside a dashboard request, not that the system invents new data or bypasses the database. Actual uptime depends on the deployed installation.

### Forecasting Evaluation

`MAE = sum(abs(y_i - prediction_i)) / n`

`RMSE = sqrt(sum((y_i - prediction_i)^2) / n)`

Report product units, source citation, chronological cutoffs, origins, horizon, common scored observations, eligible/excluded products, and fallback products. Compare all methods on the same observations. Generated test fixtures do not establish empirical forecast accuracy, and public-source results do not establish client business performance.

### Inventory Decision Support

With average current forecast demand per day `D`, lead time `L`, safety stock `SS`, coverage `C`, and on-hand stock `H`:

`ROP = D * L + SS`

`S = D * (L + C) + SS`

`Q = max(0, ceil(S - H)) when H <= ROP; otherwise Q = 0`

For `D=10`, `L=3`, `C=7`, `SS=15`, and `H=40`, `ROP=45`, `S=115`, and `Q=75`. Unknown or expired demand leaves demand-derived fields unavailable rather than substituting zero. A known zero forecast is separately usable. Deliveries remain recordable regardless of suggested quantity. Outstanding purchase orders/backorders are not tracked or silently added to inventory position. The owner reviews advice and confirms stock and supply assumptions.

### Software and Performance Evaluation

Selected ISO/IEC 25010:2023 characteristics organize evaluation (International Organization for Standardization & International Electrotechnical Commission, 2023). Functional checks, persistence/recovery, measured response times, and technical review remain distinct from client ratings and do not confer certification.

Completed runs record disjoint preparation, every model fit, validation, evaluation, and artifact/result persistence phases. Total processing ends after the result transaction commits; queue wait and final timing/status publication are excluded. Unperformed phases remain null, and older uninstrumented phase scopes remain unknown. Detailed timing must not be inferred from total duration.

The authenticated API benchmark exports raw samples, median/p95, environment/hardware, dataset provenance, and worker-boundary checks. The separate browser procedure records actual navigation/actions/paint evidence and task failures. Intended-device or VPS results must identify their environment. Existing controlled synthetic reports in the repository are implementation evidence, not client findings; a target threshold is not a measurement. Procedures are in `docs/PERFORMANCE_BENCHMARK.md` and verification is in `docs/REVIEW_VERIFICATION.md`.

### Client Survey and Statistical Treatment

Respondents are the participating business's owner/manager and staff who perform assigned tasks. Confidential partner transaction data are unnecessary; tasks may use prepared public retail data and controlled inventory scenarios. The versioned questionnaire contains 12 statements, three per characteristic: functional suitability, reliability, interaction capability, and perceived performance efficiency. Maintainability is assessed separately through engineering review, not rated by clients.

| Rating | Response |
| --- | --- |
| 5 | Strongly agree |
| 4 | Agree |
| 3 | Neither agree nor disagree |
| 2 | Disagree |
| 1 | Strongly disagree |

Unanswered and Not applicable are distinct states without numerical ratings. They are excluded from means and valid-response counts. Each item mean is `sum(valid ratings) / valid ratings count`. Characteristic and overall means give each valid rated item response equal weight; they are not averages of category means with different denominators. Report both contributing participants and valid item-response counts. Role breakdowns describe owner/manager and staff responses separately, and small samples are interpreted descriptively.

Drafts stay local. Authenticated final submissions persist immutably in PostgreSQL with questionnaire version/wording, user/role, provenance, and server timestamps. Each account submits once per version; retries with the same submission identity do not duplicate evidence. Owners access their business summary and CSV; staff access their own response. Demo-origin feedback is visibly test feedback. Questionnaire approval, voluntary participation, actual counts, and interpretation are documented when collected; stored feedback is not automatically an approved research result.

### Survey Results

This section provides the reporting structure for collected client responses. Populate it only from administered, approved client feedback. No ratings or respondent counts are invented. A dash denotes an unavailable result, not a zero rating.

**Table 3.12. Client Survey Feedback Reporting Format**

| Quality characteristic | Contributing participants | Valid item responses | Mean rating |
| --- | --- | --- | --- |
| Functional suitability | — | — | — |
| Reliability | — | — | — |
| Interaction capability | — | — | — |
| Perceived performance efficiency | — | — | — |

Record task conditions, response counts, exclusions, role breakdowns, and reported difficulties with the table. Maintainability is not a fifth client rating.

### Forecasting and Software Results

**Table 3.13. Forecasting Performance Reporting Format**

| Forecasting model | Common scored observations | MAE | RMSE |
| --- | --- | --- | --- |
| Moving Average baseline | — | — | — |
| Official Python XGBoost | — | — | — |
| Validation-weighted ensemble | — | — | — |

Identify source, eligible products, origins, dates, cutoffs, horizon, exclusions, and fallback-only products. Synthetic demonstration metrics do not populate the empirical comparison.

**Table 3.14. Software Quality Evidence Reporting Format**

| Characteristic | Evidence | Observed result |
| --- | --- | --- |
| Functional suitability | Task outcomes and expected-result checks | — |
| Reliability | Persistence, error handling, recovery | — |
| Interaction capability | Navigation, explanations, task walkthroughs | — |
| Performance efficiency | Measured API/browser latency and worker phases | — |
| Maintainability | Code, documentation, change and regression review | — |

Client perceptions remain in Table 3.12. Enter measured or reviewed results with their actual installation, version, date, and provenance.

### Resources, Diagrams, and Implementation Procedure

The frontend uses React/Vite/TypeScript, routing, charts, and styling. Python/FastAPI serves the API, PostgreSQL stores durable records, and official Python XGBoost executes in the worker. Docker Compose runs the database, initializer, API, worker, and web service. Model/database volumes survive ordinary container recreation; deliberate volume deletion removes stored data. Device RAM, CPU, Docker allocation, storage, browser, and deployed versions are recorded with performance measurements.

The data-flow design connects owner/staff actions to authenticated Python services, PostgreSQL records, frozen forecast jobs, the independent worker, and saved dashboard outputs. The context diagram retains user-entered supply settings and no automated supplier integration. Use cases distinguish owner management from authorized staff transactions/reviews. Interface screenshots state whether their records are synthetic, public, or authorized partner data.

The supplied academic-year schedule and formal figure artwork remain in the submission manuscript. Proposal calendar dates do not establish software adoption or research completion dates. Diagrams are checked against the implemented architecture before final submission.

For a controlled walkthrough: start the installation, sign in, add products, enter stock/sales, import historical data without changing present stock, review classifications, Refresh forecasts, inspect errors and unavailable evidence, record deliveries/returns/write-offs within role permissions, submit client feedback, and verify export/restart recovery. Record failures and expected outcomes. Operational adoption follows owner review of the installation and evidence; purchasing responsibility remains with the business.

### Appendix A — Client Questionnaire

The authoritative implemented wording is version `stockcast-client-survey-v1` in `backend/app/client_survey_v1.json`. Its 12 client statements and 1–5 agreement scale must remain consistent across the instrument, interface, stored submissions, CSV, and manuscript. Technical maintainability review is a separate instrument. Research administration follows adviser approval and records actual respondents/tasks; the application does not manufacture survey findings.

References remain in the formal manuscript's final reference section.
