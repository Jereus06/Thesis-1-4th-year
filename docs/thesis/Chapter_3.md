# CHAPTER III METHODOLOGY

## Research Design

The study uses a developmental research design combined with chronological forecast evaluation. It documents the implemented StockCast workflows and evaluates forecasting, inventory calculations, and selected software quality characteristics using distinct evidence sources.

Forecast testing uses authorized client records when available. If disclosure is restricted or suitable dated records cannot be provided, a reliable public retail dataset is selected, cited, and prepared under the same chronological evaluation rules. Public-data results are identified as benchmark findings for that source.

The client owner or manager and staff evaluate the functions they actually use after assigned tasks. Prepared retail records or clearly identified synthetic task scenarios allow this assessment without confidential client files. Maintainability and measured performance are assessed through separate engineering evidence.

The study reports only completed observations and measurements. Software demonstrations, empirical forecasting results, and client perceptions are analyzed separately; no demonstration value is presented as a collected client finding.

### Development Approach

Development uses iterative planning, implementation, verification, and refinement. React and TypeScript support the interface, Python handles application services and model execution, and PostgreSQL stores business records and saved results. Each documented revision identifies the source version and checks relevant to the changed workflow.

Planning → Data Audit → System and Backend Design → Forecast Development → Integration → Functional Testing → Independent Evaluation → Refinement

**Planning.** Identifies the client’s sales-and-stock tasks and the product fields needed for the system. The forecast dataset is selected from authorized business records or a documented public retail source. Any stock and lead-time settings used in controlled tests are identified explicitly.

**Data preparation.** Reviews dataset provenance, dates, product identifiers, quantities, counting units, duplicate identities, missing dates, and known stockouts. Public sources follow their permitted-use conditions; client files require authorization. Current-stock operations and historical-sales preparation remain separate.

**System design.** The researchers will define the interface, Python API, database relationships, access rules, forecasting process, and inventory decision rules.

**Model development.** Implements Moving Average and official Python XGBoost with training-only eligibility and parameter selection, later method validation and calibration, and an independent chronological test. Products outside the eligible set retain a disclosed baseline or an unavailable-forecast notice.

**System development.** Business records, transactional sales and stock services, and dashboard functions will be connected using the documented client-server data contract.

**Testing.** The system will undergo functional and performance testing to determine whether its components operate according to their intended functions.

**Evaluation.** Compares forecast methods on common held-out observations, checks reorder arithmetic and software workflows, measures performance, and summarizes actual client feedback. Maintainability is assessed through code, documentation, and a representative change review.

**Refinement.** The results from testing and evaluation will be used to identify issues and improve the system before the final implementation.

### Moving Average Model

The Python Moving Average provides the statistical baseline. It averages a configurable window of recent usable daily quantities and forecasts recursively: later horizon values use earlier predictions, rather than sales observed after the forecast origin.

MAₜ = (Dₜ₋₁ + Dₜ₋₂ + ⋯ + Dₜ₋ₙ) / n

In this equation, MAₜ is the next forecast quantity and n is the selected window. D represents earlier observed quantities up to the forecast origin and earlier predictions when extending the same forecast into later days.

The same forecast origin and scored dates are used when comparing Moving Average with XGBoost. A limited-history product uses the available contiguous usable tail; this fallback is identified separately from the eligible-model comparison.

### XGBoost Model

The primary machine learning method is Extreme Gradient Boosting, implemented through the official Python xgboost.XGBRegressor class with the reg:squarederror objective (XGBoost Developers, n.d.). The model combines regularized decision trees to represent relationships between past sales features and product demand. Recent retail applications provide the methodological context for this choice (Andrade & Cunha, 2023; Torres et al., 2024).

Each eligible product is evaluated as a dated series. Product screening checks record completeness, usable history, lag availability, and the observations required for chronological training, validation, and testing. Products with insufficient evidence receive a named Moving Average estimate or a manual restocking rule.

The model uses historical sales and calendar features as inputs and the corresponding product quantity as its target.

The daily feature set contains sales lags of one, seven, and fourteen observations in a regular daily series, rolling means calculated from the preceding seven and thirty daily observations, and day-of-week and month values for the prediction date.

Features start after a thirty-observation warm-up and use prior observations only. XGBoost requires a complete daily sequence so the lag positions retain their calendar meaning. Missing and excluded dates are not filled with zero. Only transaction quantities and explicitly confirmed zero-sale dates become forecast targets.

### Model Training and Testing

Before final-test results are examined, the evaluation record fixes the dataset version, counting unit, product set, horizon, data-quality policy, and chronological cutoffs. Training precedes later validation and final testing. The normal refresh derives date-ordered periods from usable history; the research report records the actual boundaries and any interval that is unavailable.

XGBoost candidates are selected through expanding time-series folds within training records. Later validation selects the forecast method and ensemble weights; when sufficient observations exist, a separate later segment calibrates uncertainty bands. The chosen configuration is refitted on training and validation for final-test forecasts. After final evaluation, an operational refit uses the observed history without changing the frozen selection decisions.

Every compared method uses identical eligible products, forecast origins, horizons, and scored dates. Fixed-origin multi-day forecasts replace unavailable future lag inputs with previous predictions. Observed quantities inside the test horizon are used for scoring, not as inputs for those forecasts. Final-test outcomes do not select parameters or ensemble weights.

### Two Complementary Strategies for Small-Data Forecasting Systems

Sales history in the selected retail setting may be short or uneven across products. The two strategies address forecast reliability and dashboard response time; their benefits will be assessed rather than assumed.

Strategy 1 defines data, feature, model, fallback, and uncertainty rules for sparse history. Strategy 2 defines training and serving practices intended to keep the dashboard responsive. Forecast errors and measured dashboard behavior will be reported separately.

The strategies define the system’s reliability and performance controls. Their settings, eligibility outcomes, forecast errors, and computational costs are recorded for the evaluation dataset and device. Implemented controls do not by themselves establish measured improvements.

### Strategy 1: Five Levels of Accuracy and Reliability

Strategy 1 is organized as five successive levels. Each level addresses a different source of error that appears when sales history is short or sparse. The levels are applied in order: data are made usable before features are built; features are constrained before a model is fit; the model is regularized before it is combined with a baseline; and every product forecast is finally accompanied by an explicit statement of uncertainty.

#### Level 1 - Data-Level Fixes

The first level reviews the meaning and completeness of the daily records before training. It distinguishes an observed sale, a confirmed zero-sale day, an unknown date, a closure, and a stockout, instead of changing or inventing quantities to make a series appear complete.

Only transaction observations and explicitly confirmed zero-sale dates become targets. Reviewed closures, full or partial stockouts, and incomplete records are excluded. Product-specific classifications take precedence over store-wide classifications. Every change retains its responsible user, timestamp, previous value, and supporting note in the audit history.

Training eligibility checks a complete daily sequence, at least eight calendar weeks, and at least 100 nonzero training days. The development budget permits XGBoost for the top eight eligible products ranked by training-period sales. Validation and final-test dates must also be observed or confirmed zero. These configurable gates are practical screening rules, not a universal scientific minimum.

Preparation records the usable dates, excluded dates, and effective classification policy. The implemented model uses daily observations; weekly aggregation is not part of its normal training path. Forecast inputs and reviewed classifications are frozen in the run snapshot so later corrections do not rewrite earlier results.

Other products retain a named Moving Average fallback based on a contiguous usable history, or a clear unavailable-forecast notice. Unknown dates and excluded stockout periods are not silently treated as zero demand. Generated task data and empirical retail records remain separately identified.

#### Level 2 - Feature-Level Fixes

The research model is fitted separately for each eligible product. Features use information available at the forecast origin, and the same input preparation is applied consistently across chronological splits.

The Python daily model uses one-, seven-, and fourteen-day lags; seven- and thirty-day rolling means; day of week; and month. The report will identify the feature grain and any justified change made after the data audit.

Lag and rolling features will be computed exclusively from earlier periods. The research report will document the warm-up rows and exclude observations without sufficient prior data when required.

Calendar completeness is checked before building these daily lags. Quantity units remain consistent with the product catalog. Feature choices and warm-up exclusions are recorded with the run, and additional explanatory variables are not claimed unless they are implemented and available at the forecast origin.

#### Level 3 - Model-Level Fixes

**Table 3.1. XGBoost Candidate Configurations**

| **Maximum depth** | **Learning rate** | **Maximum trees** |
| --- | --- | --- |
| 3 | 0.05 | 300 |
| 4 | 0.05 | 300 |
| 3 | 0.10 | 240 |

The Python worker evaluates three conservative candidates: depth 3 and rate 0.05 with up to 300 trees; depth 4 and rate 0.05 with up to 300 trees; and depth 3 and rate 0.10 with up to 240 trees. Shared settings include L2 regularization of 1.5, row and column subsampling of 0.9, a default seed of 42, and one training thread.

The candidate with the lowest mean MAE across training-only expanding folds is selected. The default uses three fourteen-day check windows with at least forty-five initial fitting observations. If those folds cannot be formed, the saved run records the conservative configuration and fallback reason. A later validation fit uses official-library early stopping with fifteen rounds; its best tree count is fixed for refitting.

Later validation selects between XGBoost, Moving Average, and their ensemble without using final-test outcomes. When the calibration segment is available, it is separate from the observations used to select the method and weights. Saved configuration identifies the package version, candidates, seed, effective fold count, early-stopping outcome, and cutoffs. Rows are never randomly shuffled.

#### Level 4 - Ensemble-Level Fixes

Inverse validation-MAE weighting combines XGBoost and Moving Average using the method-selection observations. A small positive constant prevents division by zero. The weights and operating method are fixed before calibration and final testing; an ensemble is not assumed to be better than either constituent method.

The evaluation report will identify each forecasting method and show validation and final-test metrics separately. The model comparison will include the common scored observations, excluded products, and reasons for fallback.

w_XGB = [1/max(0.000000001, validation MAE_XGB)] / {[1/max(0.000000001, validation MAE_XGB)] + [1/max(0.000000001, validation MAE_MA)]}; w_MA = 1 − w_XGB.

#### Level 5 - Uncertainty-Level Fixes

Usable-history and data-quality labels describe the evidence available for a forecast. Where sufficient validation history exists, the worker reserves a separate calibration segment and estimates the selected method’s residual quantiles. At least twenty validation observations and ten calibration observations are required; otherwise the interval is reported as unavailable.

Forecasts support the owner’s purchasing judgment. The interface and evaluation report will explain the forecast method, data conditions, and recommended inventory action in terms the business users can understand.

The nominal 80% band uses the tenth and ninetieth percentiles of calibration residuals. Coverage is measured separately on the untouched final test and reported with its observation count. The band is an empirical uncertainty estimate; a short calibration period and later operational refitting do not guarantee 80% coverage on future sales. Observation counts are not probabilities of correctness.

### Strategy 2: Five Techniques of Speed and Architecture

The performance strategy separates model work from routine requests, serves saved results, limits expensive training, bounds validation cost, and measures responsiveness while the worker is active. Data-quality warnings and unavailable results remain visible instead of being concealed by a quick invented forecast.

#### Technique 1 - Separate Training from Serving

FastAPI handles routine business requests while a separate Python worker claims queued PostgreSQL forecast runs. It reads a frozen input snapshot, trains the models, and saves predictions and metrics. The worker also checks the daily schedule, which defaults to 00:15 in each business’s time zone using records through the previous completed day. Local refresh requires the services to be running.

#### Technique 2 - Reuse Valid Forecasts

The dashboard reads saved PostgreSQL forecasts and retains the previous successful result while a new run is queued or active. Sales, classifications, products, or settings that change forecast inputs mark earlier results stale. Run dates, policy, configuration, and input snapshots make the displayed results traceable; an expired or unavailable result is identified clearly.

#### Technique 3 - Train Only on Top N Products

A configurable computing budget prioritizes high-volume eligible products for XGBoost training. The development default is eight products. Other products retain a named Moving Average fallback when usable history exists, or a clear unavailable-forecast notice. The eligible set and fallback reasons are saved and disclosed.

#### Technique 4 - Control Validation Cost

A compact three-candidate grid, configurable expanding fold count, and single-threaded XGBoost limit the modeling workload. The default is three training-only folds; insufficient fold history produces a recorded selection fallback. Early stopping uses later method-validation observations, while calibration and final-test outcomes remain outside parameter selection.

#### Technique 5 - Maintain Dashboard Responsiveness

Ordinary navigation reads saved results and does not launch training inside a dashboard request. The browser polls run status and can show the latest completed result while the worker operates. Performance evaluation records authenticated API latency and browser task response separately under idle and active-training conditions.

### How the Two Strategies Interact

The two strategies meet at product eligibility and chronological validation. The same top-N budget limits both which products can use the expensive model and the amount of computation; the number of validation folds affects both model selection and training time. Both choices will be reported with their measured effects.

Strategy 1 is assessed through reviewed classifications, eligibility and fallback behavior, common-date MAE and RMSE, and interval coverage when available. Strategy 2 is assessed through saved-result validity, measured processing phases, and API and browser responsiveness. Queue wait, total processing time, model-fit time, and browser response are reported as distinct measures.

### Implications for Evaluation

The final study will compare Moving Average, XGBoost, and any ensemble on the same eligible product-period observations. Product-level errors, common scored dates, and observation counts will be reported before any aggregate comparison is interpreted.

Data-sufficiency labels follow the audited records. Prediction bands are interpreted with calibration size and observed test coverage. Performance claims use recorded measurements from the stated device and workload; synthetic workloads are identified as software benchmarks.

### Forecasting Evaluation

The forecasting models will be evaluated using Mean Absolute Error (MAE) and Root Mean Squared Error (RMSE), as specified in the objectives of the study.

#### Mean Absolute Error

MAE measures the average absolute difference between predicted and observed product quantities.

MAE = (1/n) Σ |yᵢ − ŷᵢ|

Here, n is the number of common scored observations, yᵢ is the recorded quantity, and ŷᵢ is the predicted quantity in the same counting unit.

A lower MAE indicates smaller average absolute error on the evaluated observations.

#### Root Mean Squared Error

RMSE measures the square root of the mean squared difference between predicted and observed product quantities.

RMSE = √[(1/n) Σ (yᵢ − ŷᵢ)²]

RMSE assigns more weight to large errors. MAE and RMSE are reported per product in its counting unit. A combined result is given only for quantities in comparable units, with the aggregation rule and observation count stated; unrelated units are not pooled into a misleading average.

MAE and RMSE use identical eligible product-period observations for every compared method. Baseline-only products and unavailable forecasts are reported separately with their eligibility reasons, rather than included as fabricated zeros in a common model comparison.

### Inventory Optimization

The inventory optimization component will convert forecasted product demand into actionable restocking recommendations by determining when to order and how much to order.

#### Reorder Point (When to Order)

The system will calculate the Reorder Point (ROP) using forecasted demand, supplier lead time, and safety stock.

ROP = (Dᴬ × L) + SS

In this equation, ROP is the reorder point, Dᴬ is average forecast demand per day, L is supplier lead time, and SS is safety stock.

The implemented alert compares on-hand stock with the reorder point. The calculation does not track stock on purchase orders or backorders. A target-stock gap may be displayed for planning, but the alert identifies whether the on-hand reorder condition has been reached.

#### Reorder Quantity (How Much to Order)

When on-hand stock reaches the reorder point, the suggested quantity raises stock toward the order-up-to level S, covering forecast sales during lead time and the owner’s target coverage period plus safety stock.

S = Dᴬ × (L + C) + SS

If H ≤ ROP, Q = max(0, ⌈S − H⌉); if H > ROP, Q = 0 and no reorder alert is issued.

S is the target stock level; C is the coverage period in days; H is current on-hand stock; and Q is a nonnegative whole-unit suggestion. Purchase orders and backorders are outside this calculation. The owner confirms counting units and decides the final purchase.

Demand, lead time, and coverage use day units. For demand of 10 units per day, a 3-day lead time, 7-day coverage, safety stock of 15, and 40 units on hand, ROP = 45, S = 115, and Q = 75 because H ≤ ROP. A target-stock gap may also be displayed for planning when H exceeds ROP; it does not by itself indicate that an order is due.

The system will allow the safety stock, supplier lead time, and target coverage period to be configured according to the available business information. The study assumes reasonably stable supplier lead times because highly variable supply chains can reduce the accuracy of reorder recommendations.

### System Evaluation

The completed system will be assessed against selected characteristics of the ISO/IEC 25010:2023 product quality model (International Organization for Standardization & International Electrotechnical Commission, 2023). Task checks, forecast-error measurements, and response-time measurements will complement respondent ratings:

Functional suitability describes whether the system provides the functions necessary to perform sales forecasting, inventory optimization, and restocking recommendations.

Reliability describes the system’s ability to perform its required functions consistently under specified conditions.

Interaction capability concerns whether the client owner and staff can navigate the system, complete permitted tasks, and understand forecasts, stock status, and recommendations.

Performance efficiency concerns the system’s responsiveness and resource usage while performing its forecasting, inventory optimization, and dashboard functions.

Maintainability concerns how easily the system can be analyzed, modified, and maintained when changes or improvements are required.

#### Evaluation Instrument

The client questionnaire contains twelve statements across functional suitability, reliability, interaction capability, and perceived performance efficiency. Its wording matches the versioned in-system questionnaire in Appendix A. Client owner or manager and staff responses are voluntary and role-relevant. Maintainability is assessed through a separate engineering review rather than client ratings. The instrument is reviewed for clarity before administration.

#### Rating Scale and Interpretation

Client respondents use the five-point scale below after assigned tasks. They may leave an item unanswered or mark it not applicable when they have not used the relevant function. Only valid ratings enter the corresponding mean.

**Table 3.2. Likert Scale and Interpretation**

| **Rating** | **Mean Range** | **Response** | **Interpretation** |
| --- | --- | --- | --- |
| 5 | 4.21 – 5.00 | Strongly agree | Strong positive assessment |
| 4 | 3.41 – 4.20 | Agree | Positive assessment |
| 3 | 2.61 – 3.40 | Neither agree nor disagree | Neutral assessment |
| 2 | 1.81 – 2.60 | Disagree | Negative assessment |
| 1 | 1.00 – 1.80 | Strongly disagree | Strong negative assessment |

#### Statistical Treatment

The weighted mean will be computed for each statement using the formula below:

WM = Σ(f × x) / n_valid

WM is the item mean, f is the frequency of a rating, x is its value from 1 to 5, and n_valid is the number of valid rated answers for that item. Unanswered and not-applicable answers are excluded and reported separately.

The system’s characteristic mean averages all valid ratings across that characteristic’s three items; its overall mean averages all valid client item ratings. Valid-rating counts and participant counts are reported separately, because one participant may contribute several ratings. Findings are descriptive and apply to the participating client users and completed tasks. Technical-review observations and objective measurements are not pooled into the survey score.

## Population of the Study

Client evaluation focuses on one selected small retail business with a product catalog and a relevant sales-and-stock workflow. Selection depends on suitability and voluntary participation, rather than a requirement to disclose confidential records. The owner or manager and staff evaluate permitted tasks using authorized or prepared records.

The selected business provides the user-evaluation setting. A defined product set and documented retail dataset provide the forecasting-evaluation setting. These settings may use the same authorized records, but a public dataset can support forecast benchmarking when client files cannot be shared. The report distinguishes the dataset’s population from the client respondents.

The client is selected purposively for a relevant retail workflow and willing users. Its actual identity, participant roles, and task context are recorded with appropriate permission. Products lacking adequate history can be used in a clearly identified software demonstration but are excluded from the eligible XGBoost comparison.

The population of this study consists of the individuals directly involved in the use and evaluation of the proposed sales forecasting and inventory optimization system. This includes the owner of the partner small retail business, who is the primary decision-maker for purchasing and inventory decisions, and any sales or inventory staff involved in day-to-day stock monitoring and restocking activities.

The client survey includes only the owner or manager and sales or inventory staff who complete assigned tasks. Qualified reviewers assess source code, documentation, and a representative maintenance change separately; they are not added to the client-survey response count.

**Table 3.3. Respondent Groups and Selection Criteria**

| **Respondent group** | **Participation** | **Selection criterion** |
| --- | --- | --- |
| Business owner or manager | Consenting eligible participant | Purchasing and inventory responsibility |
| Sales or inventory staff | Consenting available staff | Direct use of sales and stock workflows |
| Technical reviewers (separate review) | Qualified invited reviewers; not client-survey respondents | Source-code, documentation, and controlled change review |

The owner or manager and available staff are invited to evaluate the functions they use. Actual counts and response rates are reported after collection; no sampling formula is applied to this small direct-user group. A separate technical-review record identifies reviewer competence, reviewed materials, observations, and checks.

The forecast data population consists of product-date observations in the selected authorized business or public retail dataset. Its source, coverage, exclusions, and final scored observations are recorded independently of the number of survey respondents.

## Data Collection Procedure

The researchers first request only the retail fields needed for forecasting. Authorized client records are used when available. If confidentiality restrictions or unavailable files prevent their use, the researchers select a reliable public retail-sales dataset with a traceable publisher, citation, permitted-use terms, dated product quantities, and adequate history. Client cooperation in the task survey does not require disclosure of confidential files.

The required forecasting fields and additional inventory inputs are distinguished below:

**Table 3.4. Forecasting Fields and Inventory Inputs**

| **Data** | **Description** |
| --- | --- |
| Date | Required: dated product observation; calendar-valid date |
| Product ID/Name | Required: stable product identifier matched to the catalog |
| Quantity Sold | Required: quantity in a consistent product counting unit |
| Available Stock | Optional evidence for stockout review; not required as a forecast feature |
| Supplier Lead Time | Inventory input in days; verified setting or disclosed controlled value |
| Current Stock | Current operational on-hand balance; historical imports do not change it |
| Unit Cost (if available) | Inventory display input; not a forecasting feature; never invented from sales totals |

The source file, dataset version, access date, permitted use, product mapping, counting units, date interpretation, and exclusions are recorded. Client files are collected only with authorization and omit unnecessary customer identifiers. The public-data source is cited and retained according to its permitted-use terms. Historical imports are checked separately from current transactions so they do not change opening stock.

Synthetic records support software checks and are clearly identified; they are excluded from empirical forecasting findings. Public retail records support benchmark findings for their source. If usable product history is insufficient for XGBoost or an interval, the baseline or unavailable-result outcome is reported instead of altering the eligibility rule after seeing test errors.

The forecast workflow requires dated digital records with identifiable products and consistent quantity units. Paper records require documented digitization. If a public dataset lacks on-hand stock or supplier lead time, verified client settings or explicitly stated controlled values may support reorder-arithmetic checks; those values are not presented as observed stock conditions in that dataset.

Data sufficiency is checked per product after preparation. Calendar completeness, nonzero training days, feature warm-up, and validation and test observations are reported separately. Thresholds, selection rules, calibration requirements, and final cutoffs are fixed before the independent test is examined.

Access and retention follow the chosen source’s authorization or licence. Business-scoped accounts and role checks control operational records, while versioned dataset copies and run snapshots support research traceability. Backup and recovery are checked separately from forecast accuracy. Unavailable client records are disclosed as a source limitation, without preventing a documented public-data benchmark.

### Data Preprocessing

The selected retail observations are prepared under a documented daily data-quality policy before model evaluation.

The CSV importer recognizes known column names, proposes the required mappings, and ignores extra source columns. The user checks the preview before confirming. Ambiguous dates, quantities, or product matches require a short confirmation; invalid required values block submission and appear in a downloadable error report. Product details are not invented, and new sales products are created in the catalog before importing their history.

Validated sales are aggregated by product and day. Duplicate source identities, inconsistent units, invalid dates, and known returns or corrections are reviewed according to the source’s meaning. Missing days remain unknown unless explicitly confirmed as zero sales. Closure, stockout, and incomplete-record classifications remain auditable exclusions.

Daily features use earlier quantities only. Complete eligible histories are divided into training, later method-validation and calibration observations where available, and an untouched final test. Cutoffs and usable counts are recorded with the input snapshot. Baseline-only products and excluded observations are reported separately.

The preprocessing stage is necessary because the study's forecasting accuracy depends on the length, consistency, and completeness of the available historical sales data.

### Interview

A focused consultation with the client owner or manager establishes the tasks to be assessed, product counting units, purchasing responsibilities, and the meaning of reorder settings. Confidential transaction files are not required for this consultation. Information actually supplied is recorded, while missing inventory parameters are handled through disclosed controlled scenarios for functional checks.

### Research and Implementation Controls

The following records support reproducibility and configuration. Dataset provenance, chronological cutoffs, and selection rules are documented before final-test outcomes are examined. Client task participation and technical verification remain separate from empirical forecast observations.

**Table 3.5. Research and Implementation Controls**

| **Area** | **Required record** | **Procedure** |
| --- | --- | --- |
| Dataset source and client tasks | Source citation, version, permitted use; client task consent | Use authorized client data or a documented public retail source |
| Sales and stock data | Dates, units, missing days, stockouts, usable counts | Audit records before modeling |
| Forecast evaluation | Products, horizon, training folds, selection, calibration and test cutoffs | Freeze choices before final-test outcomes are examined |
| Replenishment | On-hand stock, units, lead time, safety stock and coverage | Identify verified settings or controlled arithmetic-test values |
| Backend and recovery | Python API, PostgreSQL profile, permissions and backups | Record transaction and restore checks |
| Evaluators | Client roles, versioned questionnaire and separate technical review | Report actual participants and ratings; retain engineering evidence separately |

## Software Project Schedule

The Gantt chart follows the five Thesis Writing 1 periods in the supplied academic year 2026–2027 timeline. The shaded task rows identify work assigned to each period; the university has not provided separate start and end dates for those tasks.

The approved-title schedule gives November 9, 2026 as the title proposal panel appointment within the finals period. The finals period ends November 22, 2026. These dates concern proposal work and do not establish a completion date for the finished software system.

**Chart 3.1. Thesis Writing 1 Project Schedule Gantt Chart**

Note. W1–W18 are weeks beginning July 20, 2026. The darker bars show the five official period dates; pale bars mark only the period assigned to each task. The diamond marks the separate November 9 title proposal panel appointment. Exact task dates and the proposal defense date remain subject to university confirmation.

## Hardware and Software Resources

The resource record identifies the actual evaluation device, browser, software versions, database configuration, and workload. The specifications below are planning references; they are not measured performance findings.

### Hardware

**Table 3.6. Hardware Resources**

| **Hardware** | **Indicative specification** | **Purpose** |
| --- | --- | --- |
| Laptop or desktop | Modern CPU and browser; 8 GB RAM recommended | Development, local API, model evaluation and trial tasks |
| Storage | Local disk for database files, research records and backups | Retain versioned data and verify recovery |
| Printer | Optional | Print records or evaluation materials when required |
| Internet | Installation and collaboration; online access for a hosted trial | Install dependencies and reach hosted application services |

### Software

**Table 3.7. Software Resources**

| **Software** | **Type** | **Use** |
| --- | --- | --- |
| React 19 / Vite / TypeScript | Frontend | Browser interface and client interaction |
| Python 3.12 | Backend language | Application services and separate forecasting worker |
| FastAPI / Uvicorn | API framework and server | Versioned JSON routes and application runtime |
| Pydantic | Validation | Typed input and field constraints |
| PostgreSQL / psycopg | Database and driver | Business records and transactional stock operations |
| XGBoost / NumPy | Forecasting libraries | Official Python XGBoost and numerical preparation |
| pytest / HTTPX | Test tools | Backend and API verification |
| Docker Compose | Runtime orchestration | Frontend, Python API, worker and persistent PostgreSQL services |
| Zustand / localStorage | Client state | Client state and unfinished local survey drafts; not operational database storage |
| TanStack Router | Routing | Navigation among business workflows and evaluation pages |
| Recharts / Tailwind CSS | Interface libraries | Charts and styling |
| VS Code / GitHub | Development tools | Source editing and version management |

## System Architecture

The React and TypeScript browser sends JSON requests to the Python/FastAPI service. Pydantic validates fields, account and role checks restrict business access, and psycopg performs PostgreSQL transactions. Forecast refresh queues an immutable input snapshot; a separate Python worker processes the run and persists predictions and metrics. OpenAPI describes the request contract (FastAPI, n.d.).

**Figure 3.1. Application and Forecasting Architecture**

The API saves queued runs in PostgreSQL, and the worker reads their frozen inputs independently of ordinary dashboard requests. Forecasts, metrics, timing metadata, and classifications remain associated with the originating business and run. Model artifacts use persistent storage. The dashboard reads saved results; the optional legacy browser demonstration is not the source of normal Python/API-mode forecasts.

### Authentication and Access Control

Client owner registration creates a separate business account with an empty catalog. The owner invites staff, who accept an invitation and set their password; email delivery requires configured SMTP. The Python service stores salted scrypt password hashes and hashed session tokens. HTTP-only session cookies and CSRF checks protect authenticated writes. Every business request checks tenant scope, with separate owner authorization for management actions.

**Table 3.8. Backend Role Permissions**

| **API action** | **Owner** | **Staff** |
| --- | --- | --- |
| View products, settings, sales and movements | Allowed | Allowed |
| Record a sale | Allowed | Allowed |
| Record a receipt or customer return | Allowed | Allowed |
| Create, edit or archive products | Allowed | Denied |
| Change business settings | Allowed | Denied |
| Record adjustments or write-offs | Allowed | Denied |
| Import current inventory or historical sales | Allowed | Denied |
| Manage staff invitations and membership | Allowed | Denied |
| Request manual forecast refresh | Allowed | Denied |
| View saved forecasts and recommendations | Allowed | Allowed |
| Submit own client questionnaire | Allowed | Allowed |
| View business survey summary and export | Allowed | Denied |

## Database Design

PostgreSQL is the primary business database. UUID keys identify records, foreign keys preserve relationships, and quantity constraints prevent invalid balances. Sale and stock operations lock the affected product and execute within a transaction. A sale creates a sales row and a linked negative movement together with the updated balance; a receipt creates a positive movement. Transaction boundaries preserve consistency when an operation fails (Psycopg Team, n.d.).

**Figure 3.2. Core Business Record Relationships**

**Table 3.9. Core Database Entities and Fields**

| **Entity** | **Key fields** | **Purpose** |
| --- | --- | --- |
| businesses | id; name; data_origin | Business identity and record provenance |
| users | id; business_id; email; role; password_hash | Business membership and account permissions |
| sessions | id; user_id; token_hash; csrf_token_hash; expires_at | Authenticated session records |
| products | id; business_id; sku; current_stock | Product identity, stock and replenishment parameters |
| sales | id; product_id; sale_date; quantity; recorded_by | Dated sales linked to a business and product |
| inventory_movements | id; product_id; quantity_delta; balance_after | Stock history and linked sale movements |
| business_settings | business_id; horizon; history gates; top-N; CV folds; timezone | Forecast, scheduling time-zone, and reorder configuration |

Additional entities store source-file provenance, reviewed data classifications and immutable audit history, forecast runs and frozen snapshots, predictions and metrics, recommendation snapshots, retry keys, account invitations, and versioned client survey submissions. Figure 3.2 shows the core sales-and-stock relationships rather than every database table.

The normal local and hosted stack both use PostgreSQL. Persistent database and model volumes retain saved information across service restarts; independent backups support recovery. Browser storage is limited to client-side state such as an unfinished survey draft and does not replace the operational database. Additive SQL migrations retain the schema history and checksums.

### API Data Contract

The API prefix is /api/v1. Business resources use /businesses/{business_id}; the table omits that shared prefix for readability. Dates use YYYY-MM-DD, and stored decimal quantities retain the API’s validation rules. Authentication, permission, validation, and stock-conflict failures use distinct HTTP statuses. Import previews simplify column mapping, while Python validation remains authoritative for saved records.

**Table 3.10. Operational Python API Functions**

| **Method** | **Resource** | **Function** |
| --- | --- | --- |
| GET | /health | Check database connectivity |
| POST | /auth/sign-in; /auth/sign-out | Create or end a session |
| GET | /auth/me | Read the authenticated account |
| GET / POST | /products | List or create products |
| PATCH | /products/{id} | Update product metadata |
| GET / PUT | /settings | Read or replace business settings |
| GET / POST | /sales | Read or record sales |
| GET / POST | /inventory-movements | Read or record stock movements |
| POST | /inventory-imports; /data-imports | Import stock counts or historical sales with distinct stock effects |
| GET / PUT / DELETE | /data-quality | Review and audit dated classifications |
| POST / GET | /forecast-refresh; /forecast-dashboard | Queue an owner refresh or read saved forecasts |
| GET | /forecast-runs/{id}/metrics | Read saved run measurements and comparison metrics |

## Data Flow Diagram

Figure 3.3 describes the logical movement of business inputs, dated records, forecasts, and reorder advice. D1 corresponds to sales history, D2 to product and stock records, and D3 to forecast results. The diagram defines the decision-support workflow; the application architecture and database design describe the implementation boundaries separately.

**Figure 3.3. Data Flow Diagram of the Proposed System**

## Project Context Diagram

Figure 3.4 defines the business workflow boundary. The owner supplies product and replenishment settings and reviews advice. Staff record sales and permitted stock movements and inspect operational outputs. The Python API enforces the documented business and role checks. Supplier lead time is entered by an authorized user.

**Figure 3.4. Project Context Diagram**

## Use Case Diagram

Figure 3.5 identifies the core owner and staff use cases. Both actors sign in, record permitted sales and stock movements, and inspect authorized outputs. The owner manages products, settings, invitations, and historical imports and may request manual forecast refresh. Staff can view automatically updated results and submit their own client evaluation. The permission matrix governs each action.

**Figure 3.5. Use Case Diagram of the Proposed System**

A current sale decreases stock and creates a linked movement; a receipt increases stock and creates its movement. A historical-sales import adds dated history without changing the current balance. Owner authorization is required for product management, settings, inventory imports, adjustments, and write-offs.

## System Interface Wireframes

Figures 3.6–3.10 are early prototype interface illustrations for the main user tasks. Their sample records and displayed errors illustrate layout and do not constitute collected client findings or current-version verification evidence. Recorded task checks and current evaluation screenshots are identified separately by version and data source.

**Figure 3.6. StockCast Overview Dashboard Screen**

The prototype overview illustrates stock status, saved forecast comparisons, and access to routine tasks. Its displayed quantities and error values are demonstration values.

**Figure 3.7. StockCast Product and Inventory Screen**

The product illustration shows catalog and stock fields. In the operational workflow, an authorized owner manages product details, while permitted staff inspect records and enter allowed transactions.

**Figure 3.8. StockCast Sales Ledger and CSV Import Screen**

The historical-sales illustration shows dated product quantities. The current importer recognizes known columns, ignores extras, and asks for confirmation only when required fields are ambiguous; historical imports preserve current stock.

**Figure 3.9. StockCast Forecast Evaluation Screen**

The forecast illustration shows product-level predictions and method comparison. Operational Python results identify the selected method, eligible history, fallback reason, and uncertainty-band availability.

**Figure 3.10. StockCast Restocking Recommendations Screen**

The restock illustration shows stock status and an order suggestion. The implemented calculation uses forecast daily quantities and on-hand stock with the configured lead time, safety stock, and coverage period.

## System Demonstration and Verification

Verification follows a recorded procedure covering accounts, products, current sales, stock movements, imports, data-quality review, saved forecasts, and the client survey. Each run identifies the source version, device, browser, data provenance, and database configuration. Synthetic records support software checks; empirical forecast comparison uses the documented retail dataset.

1. Start the normal Docker Compose stack with its Python API, PostgreSQL database, and worker. Register a separate owner account or use the configured local verification account, then confirm the correct business and an empty or identified test catalog.

2. As an owner, add a labelled demonstration product with stock, lead time, and safety stock, then verify the saved record.

3. Record a sale, verify its dated ledger entry and linked stock movement, and check the resulting balance. Submit an insufficient-stock request and verify that the balance is preserved.

4. Import a labelled historical file with extra columns, confirm the required mappings, and verify saved dates, quantities, and product identities. Check that an invalid required value blocks confirmation and that historical records preserve current stock.

5. Review confirmed zero-sale and excluded dates, request an owner refresh, and verify the queued run, frozen snapshot, saved method, eligibility, timings, and metrics. Distinguish final-test forecasts from the later operational forecast and report unavailable intervals explicitly.

6. Record a stock receipt, verify the movement entry and new balance, and explain the reorder alert and target-stock gap.

7. Submit a labelled verification survey response and check role-scoped reads and owner export. Refresh and restart the services to check persistence, then perform a controlled backup and restore. Verify that staff cannot invoke owner-only writes and that another business’s records are inaccessible.

Evidence records the application version, date, device, data provenance, screenshots, expected and observed results, and any failed task. Software checks, empirical forecast outputs, and actual client questionnaire responses remain separate. A passing synthetic check is not a client finding.

### Backend Verification Procedure

Backend verification will use pytest and HTTPX alongside a recorded business workflow. The report will identify the application version, database profile, test inputs, expected behavior, observed behavior, and result for each check. PostgreSQL transaction and recovery checks will be performed using the trial deployment configuration.

**Table 3.11. Backend Verification Cases**

| **Check** | **Input or condition** | **Expected behavior** |
| --- | --- | --- |
| Authentication | Valid, invalid or expired credentials | Access is limited to a valid active session |
| Authorization | Staff request to an owner-only action | Permission denial without a record change |
| Business isolation | Request for another business’s records | Access denial |
| Request validation | Invalid date, quantity or required field | Validation response and preserved records |
| Stock integrity | Sale exceeds current balance | Conflict response with no partial sale or movement |
| Transaction consistency | Sale or receipt; competing stock writes | Consistent sale, movement and resulting balance |
| Persistence and recovery | Application restart; controlled restoration | Records and balances are verified against the saved dataset |

### Deployment Procedure

Local evaluation uses the normal Docker Compose stack for the frontend, Python API, worker, initializer, and PostgreSQL database. The installation record identifies the source version, configured accounts, schema migrations, persistent database and model volumes, and application address. Private environment settings are kept outside the distributed source package. Group members’ separate local installations do not automatically share saved records.

An online installation uses persistent server storage, the Python services and worker, PostgreSQL, HTTPS, and private application and email settings. A domain supplies the address rather than the runtime. The deployment record identifies service restart policies, database backup location and retention, and a controlled restoration check. Continuous availability is reported only from observed operation; it is not guaranteed by a domain or hosting subscription.

## Survey Results

The survey evaluates StockCast through feedback from the owner or manager and the sales or inventory staff of the client business after they complete assigned system tasks. Participation is voluntary, and respondents assess only the functions relevant to their roles and actual use.

The survey focuses on functional suitability, reliability, interaction capability, and perceived performance efficiency. Prepared retail data and controlled inventory scenarios may be used during the evaluation, allowing the client to assess the system without disclosing confidential business records.

### Survey Feedback

Survey reporting identifies actual client participants, valid item ratings, unanswered or not-applicable counts, characteristic means, and task difficulties. The characteristic mean uses all valid ratings across its three items, matching the in-system summary. Participant counts and rating counts are reported separately; owner or manager and staff roles are retained for descriptive review.

Table 3.12 provides the summary format. Appendix A contains the client evaluation questionnaire, while Table 3.2 provides the interpretation of the ratings. Only actual recorded responses are used to produce survey findings.

**Table 3.12. Survey Feedback Reporting Format**

| **Quality characteristic** | **Valid ratings** | **Mean rating** |
| --- | --- | --- |
| Functional suitability | — | — |
| Reliability | — | — |
| Interaction capability | — | — |
| Perceived performance efficiency | — | — |

A dash marks an unreported value, not a zero rating. Survey findings describe only actual client respondents and completed tasks. Forecast errors, measured response times, and technical-review observations are reported separately; the client survey does not assess source-code maintainability.

### Forecasting and Software Evaluation

Forecasting accuracy is evaluated separately from the client survey using documented retail-sales records obtained from an authorized business source or a reliable public repository. Table 3.13 compares Moving Average, official Python XGBoost, and any ensemble supported by validation on identical eligible products, forecast origins, dates, and forecasting horizons.

The evaluation records the source citation and version, training-only selection rules, method-selection and calibration cutoffs, final-test dates, common scored observations, and fallback products. Synthetic demonstration records are excluded from empirical forecast comparison. Public-data results are benchmark findings for that source, and do not establish client sales improvements or stockout reductions.

**Table 3.13. Forecasting Performance Reporting Format**

| **Forecasting model** | **MAE** | **RMSE** |
| --- | --- | --- |
| Moving Average baseline | — | — |
| Official Python XGBoost | — | — |
| Ensemble | — | — |

Table 3.14 records software checks and measurements from the project’s isolated local review on 5 October 2026 (StockCast Project Team, 2026). The source record retains the synthetic workloads, device details, raw observations, and verification procedures. These dated observations remain separate from client feedback and empirical forecasting results.

Maintainability is assessed through source-code and documentation review rather than through client survey ratings. Client feedback remains separately identified in Table 3.12.

**Table 3.14. Recorded Software Verification**

| **Quality characteristic** | **Evidence recorded** | **Observed result** |
| --- | --- | --- |
| Functional suitability | Seven recorded browser workflow checks | All seven passed in the synthetic trial. |
| Reliability | Recorded dump/restore, service restart and access checks | Saved records, timestamps and 40 model artifacts were preserved. |
| Interaction capability | 63 recorded Edge actions using an empty catalog | All actions completed, including retry after an injected network failure. |
| Performance efficiency | Dashboard API; 30 accepted samples per phase; 8 products, 180 days | Median/p95 (ms): idle 205.32/367.03; worker running 274.87/598.31. |
| Maintainability | Separate source, documentation and regression review | Review evidence documented; controlled-change assessment unreported. |

These records describe the stated synthetic installation and review date. They do not establish client ratings, public-data forecast accuracy, or verification of the latest source version. The controlled maintenance-change assessment and collected client findings are reported through their separate procedures.

## Implementation Plan

System introduction covers installation, prepared data, user orientation, and monitored tasks. The trial can use public retail data without confidential client files.

**Phase 1: Pilot Testing —** Configure accounts, verify imports and transactions, check recovery, and confirm reorder arithmetic on identified records.

**Phase 2: Staff Orientation —** Walk through products, sales, stock movements, forecast warnings, and restocking advice using role-permitted tasks.

**Phase 3: Parallel Monitoring —** Compare advice with the existing purchasing workflow. Report business outcomes only when corresponding observations are collected.

**Phase 4: Optional Adoption —** The owner decides whether to adopt the system after reviewing pilot evidence. Final purchasing decisions remain with the owner.

References are listed in [the final reference section](./References.md).
