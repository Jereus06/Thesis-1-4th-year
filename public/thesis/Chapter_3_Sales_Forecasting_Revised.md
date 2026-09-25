# CHAPTER III
# METHODOLOGY

## Research Design

This study uses a developmental and quantitative design. The developmental component covers the design and implementation of StockCast as a complete browser-based decision-support information system for the defined scope. The quantitative component measures forecasting performance and system quality using objective metrics and respondent-based evaluation.

The forecasting layer compares a Moving Average baseline and an in-browser XGBoost-style regression approach. Outputs are evaluated through chronological validation using MAE and RMSE. Forecasts are then translated into reorder recommendations through explicit inventory formulas.

The completed system is evaluated using selected ISO/IEC 25010:2023 characteristics: functional suitability, reliability, interaction capability, performance efficiency, and maintainability.

## Development Approach

The project follows an iterative sequence:

**Planning → Data Preparation → System Design → Model Development → System Development → Testing → Evaluation → Refinement**

1. **Planning**: define partner-business requirements, product scope, sales-data availability, lead-time assumptions, and reorder policy settings.
2. **Data Preparation**: structure and validate historical records for forecasting use.
3. **System Design**: define the presentation layer, logical service layer, client-side persistence layer, data flow, and dashboard interaction flow.
4. **Model Development**: implement Moving Average and XGBoost-style models with chronological validation safeguards.
5. **System Development**: integrate forecasting, inventory calculations, caching, and dashboard reporting.
6. **Testing**: verify functional behavior, forecast output consistency, and interface behavior.
7. **Evaluation**: assess forecasting accuracy and selected ISO/IEC 25010:2023 characteristics.
8. **Refinement**: improve wording, workflow, and parameter settings based on observed results.

## Implemented System Architecture (Study Scope)

StockCast is implemented as a self-contained web application with a deployment architecture suitable for static hosting.

### 1) Presentation Layer

Implemented using React + Vite + TypeScript. This layer provides dashboard views for inventory, forecasts, restock recommendations, and methodology content.

### 2) Logical Service / System Processing Layer (Client-Side)

Implemented in browser-resident TypeScript modules. It handles:

- sales processing and stock updates,
- forecasting pipeline execution,
- model comparison,
- confidence and interval generation,
- reorder-point and reorder-quantity computation,
- input validation and state transitions,
- cache refresh and background training orchestration.

### 3) Client-Side Persistence Layer

Implemented using Zustand state persistence and localStorage for durable browser-side storage of application and forecast cache data.

### 4) Data Acquisition Layer

Data enters through seeded records and CSV import workflows.

### 5) Deployment Architecture

The production system is generated as a static build and can be hosted on standard static web platforms.

> Scope clarification: the current implementation does not include a separate backend API server, remote/cloud database, authentication module, or multi-user access control. These are potential future enhancements, not implemented components.

## Forecasting Methods

### Moving Average Model (Baseline)

The baseline model uses a fixed rolling window of recent observations:

\[
MA_t = \frac{D_{t-1}+D_{t-2}+\cdots+D_{t-n}}{n}
\]

Where:

- \(MA_t\) = forecasted demand at period \(t\)
- \(D\) = observed demand
- \(n\) = number of prior periods

This baseline is retained for comparison and fallback behavior.

### XGBoost-Style Regression Model (In-Browser)

The machine-learning method is a custom in-browser gradient-boosted tree regression implementation. The model uses structured lag, rolling, calendar, and category features to estimate short-term demand.

Input features include, depending on data grain:

- lag demand values,
- rolling means,
- calendar indicators,
- category index,
- holiday and promotion flags.

Product identifiers are **not** used as regressors.

## Model Training, Validation, and Comparison

Because forecasting is time-dependent, model evaluation preserves chronological order.

The implementation uses:

- time-series cross-validation (chronological folds),
- final chronological holdout for reported MAE/RMSE,
- comparable holdout windows across Moving Average, XGBoost-style, and ensemble forecasts.

For limited and irregular datasets, the methodology applies safeguards including conservative model settings, early stopping behavior, and fallback to simpler methods when model instability is detected.

## Ensemble and Confidence Strategy

The operational forecast may combine Moving Average and XGBoost-style outputs through weighted comparison logic. When instability conditions are detected, fallback behavior favors robust baseline output.

Each product forecast includes confidence indicators. Prediction intervals are generated to communicate uncertainty, and the dashboard explicitly states that forecasts support decisions but do not guarantee outcomes.

## Forecasting Evaluation

Forecast accuracy is evaluated with:

### Mean Absolute Error (MAE)

\[
MAE = \frac{1}{n}\sum |y_i - \hat{y}_i|
\]

### Root Mean Squared Error (RMSE)

\[
RMSE = \sqrt{\frac{1}{n}\sum (y_i - \hat{y}_i)^2}
\]

Lower values indicate better fit on the evaluated chronological windows.

## Inventory Optimization

The system converts forecast output into replenishment guidance.

### Reorder Point (When to Order)

\[
ROP = (D_A \times L) + SS
\]

Where:

- \(D_A\) = average forecasted demand per period
- \(L\) = lead time
- \(SS\) = safety stock

### Order-Up-To and Reorder Quantity (How Much to Order)

\[
S = D_A \times (L + C) + SS
\]

\[
Q = \max(0, S - I)
\]

Where:

- \(S\) = target/order-up-to stock level
- \(C\) = coverage period
- \(I\) = current inventory position
- \(Q\) = recommended reorder quantity

## System Evaluation

The developed system is evaluated using selected ISO/IEC 25010:2023 characteristics:

- **Functional Suitability**
- **Reliability**
- **Interaction Capability**
- **Performance Efficiency**
- **Maintainability**

### Evaluation Instrument and Scale

A Likert-scale questionnaire is used for respondent assessment after system use. Weighted mean values are computed per statement and aggregated per characteristic.

\[
WM = \frac{\sum(f \times x)}{n}
\]

Where:

- \(WM\) = weighted mean
- \(f\) = frequency of a given rating
- \(x\) = numeric rating value
- \(n\) = total respondents

Because respondent count is expected to be small, results are interpreted descriptively within the study context.

## Population and Data Collection

Respondents include the partner-business owner and relevant staff who interact with inventory and sales workflows. Total enumeration is used for available respondents in the partner setting.

Primary data sources include historical sales records from partner operations and, when needed for methodological continuity, a comparable fallback retail dataset. Data are handled with confidentiality and used only for approved research purposes.

## Data Preprocessing

Preprocessing includes:

- data cleaning,
- chronological organization,
- appropriate aggregation (daily/weekly),
- product selection for model suitability,
- feature preparation,
- chronological dataset splitting.

## Resources and Implementation Environment

For the implemented prototype/deployable system, the software stack is:

- TypeScript
- React + Vite
- Zustand with localStorage persistence
- in-browser forecasting and inventory modules
- Git/GitHub for version control

Hardware requirements are standard personal computing devices for development and browser execution.

> Future work recommendation: if institutional or organizational deployment later requires centralized user accounts, remote database services, or enterprise integration, those should be developed as a subsequent multi-tier extension and evaluated in a separate implementation phase.
