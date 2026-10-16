# CHAPTER I INTRODUCTION

## Project Context

Small retail businesses must coordinate product records, sales transactions, and replenishment decisions. Philippine work on a web-based inventory system illustrates how digital records can support stock information across business outlets (Tanaman et al., 2023). StockCast addresses a retail setting with identifiable products and usable dated records. The selected client’s workflow will be described through consultation, without assuming that another business’s practices apply to it.

A useful forecasting tool connects dated sales records to stock decisions. Excess stock can tie up working capital, while shortages can leave customer demand unmet. Seyedan et al. (2023) connect demand forecasts with an order-up-to policy that considers replenishment conditions and inventory costs. StockCast applies a transparent rule using available stock, supplier lead time, safety stock, and coverage days so that the owner can review the suggested quantity before purchasing.

Recent retail studies provide a basis for examining XGBoost as a demand forecasting method. Andrade and Cunha (2023) use gradient boosting for disaggregated retail forecasts, while Torres et al. (2024) examine XGBoost in a Peruvian retail SME. These applications motivate a product-level comparison rather than establish accuracy for the present business. The study will compare the official Python XGBoost implementation with a Moving Average baseline under stated data-sufficiency and chronological evaluation rules.

StockCast connects product and sales records with forecasts and restocking advice for a defined retail workflow. Product eligibility rules assign limited or incomplete histories to a disclosed simple estimate. Forecast evaluation will use authorized business records when available; otherwise, a reliable public retail dataset will provide a documented benchmark. Client task feedback remains a separate evaluation and does not require disclosure of confidential sales or stock records.

The React and TypeScript frontend communicates with a Python/FastAPI backend that enforces account, business, and role permissions. PostgreSQL stores operational records, reviewed data classifications, and forecast results. A separate Python worker trains the official XGBoost model and saves predictions for the dashboard. Generated records support controlled software checks; empirical forecasting results require documented retail observations, and survey findings require actual client responses.

## Research Problem and Objectives

### Statement of the Problem

This study develops and evaluates a sales forecasting and inventory decision-support system for a selected small retail business. It addresses the following questions:

How can product, sales, stock, historical-data import, and dashboard workflows be integrated through a Python backend with persistent and business-scoped records?

How can a Moving Average baseline, official Python XGBoost model, and disclosed fallback serve products with different amounts of usable sales history?

How do Moving Average, XGBoost, and a validation-supported ensemble compare in MAE and RMSE on identical product-period observations in an independent chronological test?

How do record validation, reviewed missing dates and stockouts, and product eligibility rules prevent unsupported forecast inputs and communicate limited evidence?

What forecast-processing times and dashboard response times are observed on the evaluation device while routine operations and background training are performed?

What reorder points and reorder quantities does the system recommend when forecasted demand, supplier lead time, a configurable safety stock buffer, and a target coverage period are applied through the Reorder Point and Order-Up-To formulas?

How do the client owner or manager and staff assess functional suitability, reliability, interaction capability, and perceived performance efficiency, and what separate technical evidence supports maintainability and the measured quality characteristics?

### Objectives of the Study

#### General Objective

To develop and evaluate a sales forecasting and inventory decision-support system for a selected small retail business, using official Python XGBoost where the records permit, a Moving Average fallback, and transparent restocking advice, with a documented retail dataset for forecast testing and client feedback for user evaluation.

#### Specific Objectives

To develop and integrate the sales, stock, historical-data preparation, and dashboard workflows with a Python backend and persistent business records.

To implement a Moving Average baseline and the official Python XGBoost algorithm for eligible products, with a documented simple fallback for products that lack sufficient usable history.

To compare the baseline, XGBoost, and any justified ensemble on identical product-period observations using chronological validation and a separate final test period for MAE and RMSE.

To document the data-quality checks, product eligibility rule, treatment of missing dates and stockouts, and warning shown when forecast evidence is limited.

To measure forecast-processing phases and dashboard response times on the evaluation device, using saved forecast results and a separate Python worker to support routine business tasks.

To compute transparent reorder alerts and suggested quantities using forecast demand, on-hand stock, supplier lead time, safety stock, and target coverage days.

To evaluate client experience through four selected ISO/IEC 25010:2023 characteristics and assess maintainability separately through source-code, documentation, and controlled change review.

## Scope and Limitations of the Research

### Scope

StockCast supports a defined product catalog and sales-and-stock workflow for a selected small retail business. Client task evaluation concerns that setting. Forecast benchmarks concern the chosen dataset, products, and dates; neither form of evidence is assumed to represent all retailers.

The system covers product maintenance, sales entry, receipts, returns, owner-authorized adjustments and write-offs, current-inventory imports, historical-sales imports, and data-quality review. Python/FastAPI handles authenticated business-scoped operations, while PostgreSQL maintains persistent records. Historical imports preserve current stock. Forecast testing uses authorized business records or a documented public retail source when client records are unavailable or confidential; generated task data are identified separately.

The separate Python worker runs official XGBoost, a Moving Average baseline, and a validation-supported ensemble. Model selection, calibration, final testing, and operational refitting have distinct roles. Dashboard reads use saved results rather than retraining models during ordinary navigation.

Reorder points and order-up-to suggestions use average forecast daily sales, on-hand stock, supplier lead time, safety stock, and coverage days. The implemented single-location calculation uses on-hand stock; purchase orders in transit and backorders are outside its inventory measure. The owner reviews the suggestion before purchasing.

The browser dashboard presents product forecasts, data-quality messages, stock status, and restocking recommendations. The backend defines owner and staff roles: both may record sales and permitted stock movements, while product maintenance, business settings, adjustments, and write-offs require owner authorization.

Forecast evaluation uses MAE and RMSE on common held-out retail observations. Software evaluation combines recorded task outcomes, persistence and recovery checks, response-time measurements, client ratings, and a separate maintainability review. Results from public records are reported as dataset benchmarks.

The performance strategy separates Python model execution from API requests, reuses saved forecasts, and limits XGBoost to eligible products within a configurable budget. Daily refresh defaults to 00:15 in the business time zone and uses records through the previous completed day while the worker is running. The owner may also request a manual refresh; staff can view the saved results.

Product eligibility uses training-period records only: a complete daily sequence, at least eight weeks of history, at least 100 nonzero days, and a top-N budget with a development default of eight eligible products. Validation and test calendars must also be complete for XGBoost evaluation. The eight-week and 100-day requirements are simultaneous gates, so eight weeks alone is insufficient. Research settings are fixed before the independent test is examined.

### Limitations

Forecast accuracy depends on the length, completeness, units, and provenance of the selected records. A date without a transaction is not automatically a zero-sale day. Known closures, stockouts, and incomplete records are excluded under the reviewed policy. Without reliable stock-availability information, recorded sales cannot establish total unconstrained customer demand.

The system does not account for unpredictable external factors, such as sudden local events, promotions, or supply disruptions, unless such factors are explicitly included as model features.

The system is designed to support, not replace, the business owner's judgment; final purchasing and inventory decisions remain the owner's responsibility.

Client feedback applies to the participating owner or manager, staff, and completed tasks. Forecast findings apply to the selected dataset and eligible product-date observations. Model configuration, ensemble weights, and interval calibration use earlier records; the final test is reserved for reporting. Synthetic records verify software behavior and are excluded from empirical forecast-accuracy findings.

The inventory optimization component assumes reasonably stable supplier lead times; highly variable or unreliable supply chains may reduce the accuracy of reorder recommendations.

Products that lack sufficient usable history receive a disclosed Moving Average estimate when possible. If a forecast is unavailable, the system explains the limitation and leaves the decision to the owner instead of inventing a prediction. Public-data benchmarks do not demonstrate stockout reduction or financial benefit for the client business.

## Significance of the Research

This study is deemed beneficial to the following:

**Small Retail Business Owners —** The proposed system will translate dated sales records into forecasts and clear restocking advice, supporting more informed cash flow and stock decisions.

**Sales and Inventory Staff —** The system will provide a consistent record and reference for stock monitoring and replenishment decisions.

**Future Researchers —** The study will document the implemented forecasting workflow, chronological comparisons, data-quality policy, and limits of the selected retail dataset.

**The Academic Institution —** The study will provide a reproducible account of the implemented software, evaluation design, inventory rule, and evidence supporting the reported findings.

## Definition of Terms

**Sales Forecasting —** Estimating future product quantities from dated sales records. In this study, recorded sales are distinguished from unobserved customer demand during stockouts.

**Inventory Optimization —** In this study, using forecasts and stock parameters to recommend when and how much to reorder. The method will be assessed as decision support; it does not claim to solve a measured total-cost minimization problem.

**Moving Average —** A simple statistical forecasting technique that predicts future values based on the average of a fixed number of recent historical observations.

**XGBoost Algorithm —** Extreme Gradient Boosting, used through the official Python xgboost.XGBRegressor implementation in the system’s separate forecasting worker.

**Reorder Point —** The inventory level at which a new order should be placed to replenish stock before it runs out, calculated based on average demand during the supplier's lead time plus a safety stock buffer.

**Reorder Quantity —** A nonnegative whole-unit quantity intended to restore stock toward an order-up-to level when a reorder is due. A displayed target-stock gap may also support planning; the reorder alert identifies whether the ordering condition has been reached.

**Order-Up-To Level —** The target inventory level that an order is meant to restore, computed from the average forecasted demand over the supplier's lead time and a target coverage period, plus a safety stock buffer.

**Safety Stock —** An additional buffer quantity of inventory kept on hand to reduce the risk of stockouts caused by demand variability or supply delays.

**Lead Time —** The amount of time between placing an order with a supplier and receiving the stock.

**Mean Absolute Error (MAE) —** An evaluation metric that measures the average magnitude of errors between predicted and actual values, without considering their direction.

**Root Mean Squared Error (RMSE) —** An evaluation metric that measures the square root of the average squared differences between predicted and actual values, penalizing larger errors more heavily than MAE.

**Ensemble Forecast —** A combined forecast produced from the XGBoost prediction and Moving Average prediction for use as an operational forecasting option.

**Data-Sufficiency Indicator —** A description of usable history, exclusions, and forecast eligibility. It is not a probability that a prediction will be correct.

**Prediction Range —** A residual-based uncertainty band calibrated on observations separate from method selection and checked on the final test. Nominal coverage does not guarantee future coverage.

**Strategy 1 Five Levels of Accuracy and Reliability —** The study’s controls for data quality, features, model selection, ensemble weighting, and uncertainty communication.

**Strategy 2 Five Techniques of Speed and Architecture —** The study’s approach to separate model execution from routine tasks, reuse valid results, prioritize eligible products, control validation cost, and measure dashboard responsiveness.

**Top-N Products —** Eligible products ranked by sales volume within the training period and prioritized for XGBoost under a configurable computing budget. The development default is eight products; later test sales do not determine the ranking.

**ISO/IEC 25010:2023 —** An international standard that defines a product quality model for software and ICT products; this study uses five of its characteristics (functional suitability, reliability, interaction capability, performance efficiency, and maintainability) to evaluate the developed system.

References are listed in [the final reference section](./References.md).
