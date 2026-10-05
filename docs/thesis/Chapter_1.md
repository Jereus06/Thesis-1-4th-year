# Thesis Chapter 1

> Repository text revised on 2026-10-05 to reflect the seven objectives, the permitted public-data alternative, and the implemented Python system. The formal manuscript remains the submission source; its layout, figures, and pagination are not reproduced here. Software implementation evidence and collected research findings are identified separately.

**Sales Forecasting and Inventory Optimization for Small Retail Businesses Using XGBoost Algorithm**

## CHAPTER I — INTRODUCTION

### Project Context

Small retailers must decide what to stock despite limited cash, shelf space, and sales records. Philippine studies of specific micro-retail settings have documented manual inventory checks and decisions affected by cash availability, unrecorded withdrawals, and stock shortages (Custodio, 2017; Pallera et al., 2026). These findings motivate this study without establishing the practices of a particular participating business.

A useful forecasting tool connects dated sales records to stock decisions. Too much stock can tie up working capital, while too little can leave demand unmet. Reorder advice also depends on stock on hand, supplier lead time, and a safety stock buffer (King, 2011). StockCast makes these inputs visible so the owner can review a recommendation before purchasing.

XGBoost provides regularized tree boosting for prediction (Chen & Guestrin, 2016), and a study of a Peruvian retail small business reported useful results with the method (Torres et al., 2024). Those results cannot establish accuracy for another business or products with short, irregular histories. This study compares official Python XGBoost with a Moving Average baseline using the same eligible product-date observations and a separate chronological final test.

StockCast integrates a React and TypeScript browser interface with a Python/FastAPI API and forecast worker, PostgreSQL records, and persistent model artifacts. It supports sales, stock movements, historical imports, reviewed day classifications, owner/staff accounts, forecast evaluation, reorder advice, client feedback, and backup/restore procedures. The optional browser demonstration uses generated records and a custom TypeScript booster; it is separate from the normal Python application and is not evidence of official XGBoost performance.

Authorized partner records may support forecasting evaluation when available. If confidentiality, limited history, or unavailable exports prevent their use, the researchers may select reliable, permitted public retail records and document their source and limitations. Public-data forecasting findings describe that dataset. Client survey findings describe participating business users' experience with the system; they do not require confidential sales records. Generated fixtures support software checks and cannot be presented as collected business data.

### Research Problem and Objectives

#### Statement of the Problem

The study develops and evaluates forecasting and inventory decision support for small retail workflows. Specifically, it addresses these questions:

1. How can sales, stock, historical preparation, and dashboard functions be integrated with a Python backend and persistent records?
2. How can Moving Average and official Python XGBoost support eligible products while providing a clear fallback for limited history?
3. How do Moving Average, XGBoost, and a validation-justified ensemble compare on common product-date observations in an independent chronological final test?
4. How do data-quality checks, eligibility, missing-date and stockout handling, and warnings protect forecast interpretation?
5. What forecast processing and dashboard response times are observed on the intended device, including while the separate worker processes a run?
6. What reorder points and suggested quantities follow from demand, stock, supplier lead time, safety stock, and target coverage?
7. How do participating business users and separate technical evaluation assess the relevant ISO/IEC 25010:2023 quality characteristics?

#### General Objective

To develop and evaluate a sales forecasting and inventory decision-support system for small retail workflows using official Python XGBoost for eligible products, a Moving Average baseline and fallback, and transparent restocking advice.

#### Specific Objectives

1. To develop and integrate sales recording, stock management, historical-data preparation, and dashboard functions with a Python backend and persistent business records.
2. To implement a Moving Average baseline and official Python XGBoost for eligible products, with a documented simple fallback for products that lack sufficient usable history.
3. To compare Moving Average, XGBoost, and any justified ensemble on identical product-date observations using chronological validation and a separate final test period for MAE and RMSE.
4. To document and apply data-quality checks, product eligibility, missing-date and stockout treatment, and warnings when forecast evidence is limited.
5. To measure forecast processing and dashboard response time on the intended device, using saved results and separate background execution to support responsive operation.
6. To compute transparent reorder alerts and suggested quantities using forecast demand, on-hand stock, supplier lead time, safety stock, and target coverage days.
7. To evaluate the system with business users and separate technical assessment of the relevant ISO/IEC 25010:2023 product quality characteristics.

The former separate objective requiring the partner to release confidential records is not retained. Dataset preparation remains part of the integrated workflow, and Chapter 3 states the authorized partner/public-data collection procedure.

### Scope and Limitations of the Research

#### Scope

- The application supports product maintenance, dated sales, deliveries, returns, write-offs, audited stock-count corrections, imports, exports, and forecasts. Historical sales imports add ledger records without changing present stock balances.
- Authorized partner records or a documented permitted public retail dataset may support the forecast experiment. Source, units, date coverage, completeness, exclusions, and research cutoffs are recorded before interpreting final-test results.
- Official Python XGBoost models products separately using past sales and calendar features. Moving Average remains the baseline; the operating method and ensemble weight are fixed using preceding validation evidence.
- Reviewed confirmed-zero days are usable targets. Unknown dates, closures, incomplete records, and stockouts are not silently converted to zero demand. Ineligible products receive a named conservative baseline when usable history exists; empty or expired evidence remains unavailable.
- Owner and staff permissions are enforced by the Python API and reflected in the frontend. Each account belongs to its authorized business. Owners manage products, imports, settings, staff, and forecast refresh; authorized staff record operational transactions and reviews.
- Reorder advice uses on-hand stock, daily forecast demand, lead time, safety stock, and target coverage. The system does not maintain a purchase-order/backorder inventory-position model.
- Client feedback is limited to owner/manager and staff respondents. Four characteristics are rated: functional suitability, reliability, interaction capability, and perceived performance efficiency. Maintainability and measured performance use separate engineering evidence.

#### Limitations

- Accuracy depends on the source, length, completeness, and product coverage of the records. Default training gates require a complete daily sequence, at least eight weeks, and at least 100 nonzero days; eight weeks alone cannot satisfy the nonzero-day gate. These are implementation settings, not universal scientific thresholds.
- The Python runtime remains daily. Weekly aggregation, pooled product models, holiday flags, and promotion regressors are not part of its implemented feature set.
- A short contiguous tail can support a low-evidence Moving Average baseline; it does not make missing records known. Dates remain anchored to each product's usable origin and expire without being shifted to today.
- Validation-residual bands have nominal 80% coverage only when a separate calibration segment is available. Saved final-test coverage describes that test; small time-ordered samples and subsequent operational refits do not guarantee future coverage.
- Public-data results cannot establish accuracy or financial benefit for a participating business. Client perceptions cannot certify accuracy, security, recovery, measured latency, or ISO compliance. Findings are reported only from collected measurements and responses.
- Lead times and stock settings are entered by users. Advice assumes reasonably stable lead times and supports the owner's judgment; it is not measured total-cost minimization.
- Local and VPS operation depend on device resources, persistent volumes, service configuration, and tested recovery. Deployed uptime must be observed rather than inferred from code.

### Significance of the Research

**Small Retail Business Owners.** The system connects dated sales to transparent demand and restocking advice, with evidence limits visible before purchasing decisions.

**Sales and Inventory Staff.** Authorized accounts provide consistent transaction records and stock information for routine work.

**Future Researchers.** The study documents source provenance, common-observation comparisons, fallback limits, and reproducible software checks.

**The Academic Institution.** The implemented system and recorded evidence support review of forecasting, inventory rules, software quality, and their practical limits.

### Definition of Terms

- **Sales Forecasting:** Estimating future product demand from dated records.
- **Inventory Optimization:** Forecast-based advice on when and how much to reorder; no measured total-cost optimum is claimed.
- **Moving Average:** A recursive daily baseline using a configured window of recent usable quantities.
- **XGBoost:** Official Python `xgboost.XGBRegressor` in the forecast worker. The custom TypeScript demonstration is separately identified.
- **Reorder Point:** Daily forecast demand multiplied by lead time, plus safety stock.
- **Order-Up-To Level:** Daily demand multiplied by lead time plus target coverage, plus safety stock.
- **Reorder Quantity:** A nonnegative whole-unit suggestion to reach the order-up-to level when stock is at or below the reorder point.
- **Safety Stock / Lead Time:** The configured inventory buffer and days between ordering and receiving stock.
- **MAE / RMSE:** Mean absolute error and root mean squared error on common final-test observations in product units.
- **Ensemble:** XGBoost and Moving Average combined using preceding validation MAE.
- **Data-Sufficiency Indicator:** A descriptive statement about usable history and exclusions, not a probability of correctness.
- **Prediction Interval:** A nominal validation-residual band with calibration evidence and separately measured test coverage.
- **Strategy 1:** Data, feature, model, ensemble, and uncertainty safeguards for reliability.
- **Strategy 2:** Separate training/serving, persisted results, training-only product prioritization, bounded chronological validation, and asynchronous execution with measured responsiveness.
- **Top-N Products:** Eligible products prioritized by training-period sales volume under a configurable budget; default eight.
- **ISO/IEC 25010:2023:** The product quality model organizing selected client perceptions and separate engineering evaluation; its use does not constitute certification.

References remain in the formal manuscript's final reference section. Existing literature citations above retain their manuscript attribution.
