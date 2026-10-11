# Two Complementary Strategies for Small-Data Forecasting Systems

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

This section mirrors the 9 October 2026 formal manuscript. See [Chapter III](../../docs/thesis/Chapter_3.md) for the complete methodology and [References](../../docs/thesis/References.md) for source attribution.
