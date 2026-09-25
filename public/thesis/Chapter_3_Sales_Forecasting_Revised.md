# CHAPTER III

# METHODOLOGY

## Research Design

This study uses a developmental and quantitative design. The developmental component covers the design and implementation of the StockCast prototype. The quantitative component covers forecast performance evaluation and system-quality evaluation.

Forecasting performance is compared across Moving Average, an in-browser custom XGBoost-style model, and their ensemble using MAE and RMSE on chronological evaluation splits. System quality is evaluated using selected ISO/IEC 25010:2023 characteristics: functional suitability, reliability, interaction capability, performance efficiency, and maintainability.

## Development Approach

The study follows an iterative process:

**Planning → Data Preparation → System Design → Model Development → System Integration → Testing → Evaluation → Refinement**

- **Planning**: define partner context, data availability, and inventory decision needs.
- **Data Preparation**: clean and structure historical sales records for chronological forecasting.
- **System Design**: design client-side architecture, forecast workflow, reorder logic, and dashboard pages.
- **Model Development**: implement Moving Average baseline and XGBoost-style model.
- **System Integration**: connect forecasting outputs to reorder calculations and dashboard presentation.
- **Testing and Evaluation**: assess forecasting metrics and selected ISO/IEC 25010:2023 characteristics.
- **Refinement**: apply revisions based on testing and evaluation findings.

## System Implementation Context

The implemented prototype is a **client-side web application** using React, Vite, and TypeScript. It has **no backend API, no server-side database, and no authentication module**. Application data (products, sales, and settings) is managed through Zustand and persisted in browser localStorage. Sales data can come from seeded demo data or imported records.

## Forecasting Methodology

### Moving Average Baseline

The Moving Average model serves as the statistical baseline:

\[
MA_t = \frac{D_{t-1} + D_{t-2} + \cdots + D_{t-n}}{n}
\]

where \(MA_t\) is forecast demand, \(D\) is observed demand, and \(n\) is the lookback window.

### XGBoost-style Model

The primary machine-learning model is an in-browser custom XGBoost-style regressor. It learns from prepared historical-demand features and predicts short-horizon demand.

Implemented feature categories include:

- lag features (for example, 1, 7, and 14 periods)
- rolling means
- calendar features (day/week and month)
- product category index
- optional holiday/promotion proxy flags supported by available data

To reduce overfitting in small datasets, high-cardinality product identifiers are not used as direct regressors.

### Chronological Training and Testing

The forecasting pipeline keeps temporal order during evaluation:

1. Chronological training and validation windows are used (no random shuffling).
2. Time-series cross-validation is applied using rotating chronological folds.
3. A final chronological holdout period is used for reported MAE/RMSE comparison across models.

### Ensemble and Reliability Handling

The system computes an ensemble forecast and compares model performance per run. Reliability safeguards include fallback behavior for unstable model cases and explicit confidence indicators in output views.

## Safeguards for Small Datasets

The methodology applies safeguards to improve reliability under short or sparse sales histories:

1. Minimum history and data-quality checks before model-heavy processing.
2. Conservative model settings and early stopping in the XGBoost-style training routine.
3. Chronological validation to avoid leakage from future observations.
4. Baseline and ensemble comparison so weaker model runs are not hidden.
5. Confidence indicators and forecast uncertainty messaging for user interpretation.

## Forecasting Evaluation

### Mean Absolute Error (MAE)

\[
MAE = \frac{1}{n} \sum |y_i - \hat{y}_i|
\]

### Root Mean Squared Error (RMSE)

\[
RMSE = \sqrt{\frac{1}{n} \sum (y_i - \hat{y}_i)^2}
\]

Lower MAE and RMSE indicate better holdout performance for the evaluated run.

## Inventory Optimization

The system translates forecast demand into reorder guidance.

### Reorder Point (When to Order)

\[
ROP = (D^A \times L) + SS
\]

where \(D^A\) is average forecast demand, \(L\) is lead time, and \(SS\) is safety stock.

### Reorder Quantity (How Much to Order)

\[
S = D^A \times (L + C) + SS
\]
\[
Q = S - I
\]

where \(S\) is target stock (order-up-to level), \(C\) is coverage period, and \(I\) is inventory position.

This supports practical restocking decisions while allowing owner-configurable lead time, safety stock, and coverage values.

## System Evaluation

The prototype is evaluated using selected ISO/IEC 25010:2023 characteristics:

1. **Functional Suitability**
2. **Reliability**
3. **Interaction Capability**
4. **Performance Efficiency**
5. **Maintainability**

A researcher-prepared Likert-based instrument is used for respondent feedback. Results are interpreted as descriptive statistics appropriate to a small respondent set.

## Population of the Study

The study focuses on one partner small retail context. Respondents include the owner and relevant staff who directly interact with the prototype for evaluation activities. Total enumeration is used due to the small population.

## Data Collection Procedure

Historical sales and inventory-related records are gathered with partner permission. Data fields may include date, product, quantity sold, lead time, current stock, and quantity on order (if available). Records are organized into a consistent chronological dataset before model evaluation.

## Data Preprocessing

Preprocessing includes:

1. data cleaning
2. chronological organization
3. aggregation when needed
4. missing-value handling
5. product selection based on usable history
6. feature preparation
7. chronological split preparation

## Hardware and Software Resources (Implemented Prototype)

- **Hardware**: standard laptop/desktop for development, testing, and demonstration
- **Software stack**: React, Vite, TypeScript, Zustand, Recharts, and browser localStorage
- **Version control**: Git and GitHub
- **Documentation and diagramming tools**: standard office and diagram tools used by the researchers

## Implementation Plan

After development and evaluation, implementation can follow phased rollout:

1. **Pilot Use** with partner data
2. **Owner/Staff Orientation** on dashboard interpretation
3. **Parallel Monitoring** against existing decision habits
4. **Operational Adoption** with ongoing review of forecast and reorder outcomes
