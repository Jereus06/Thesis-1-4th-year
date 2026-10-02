# Sales Forecasting and Inventory Optimization for Small and Medium Retail Businesses Using an XGBoost-Based Approach

## CHAPTER I
## INTRODUCTION

### Project Context

Small and medium retail businesses commonly make restocking decisions through intuition, manual logs, or delayed spreadsheet review. These practices frequently produce overstocking and understocking. Overstocking ties up limited capital and raises spoilage risk for sensitive items, while understocking causes missed sales and weakens customer trust.

This study addresses that operational gap through **StockCast**, a complete web-based decision-support system for the scope of the study. The implemented system provides an integrated workflow for sales recording, demand forecasting, inventory calculation, and reorder recommendation generation.

Within the implemented scope, StockCast operates as a self-contained browser-based application with:

- a React + Vite + TypeScript presentation layer;
- a client-side system processing layer for validation, sales processing, forecasting, inventory logic, and state updates;
- persistent browser storage through Zustand with localStorage;
- seeded sample data and CSV import for data acquisition;
- deployable static production build output.

Forecasting combines Moving Average and an in-browser XGBoost-style regression pipeline, with ensemble comparison, chronological holdout evaluation, time-series cross-validation, and confidence indicators. Forecast outputs are translated into reorder-point and reorder-quantity recommendations using lead time, safety stock, and target coverage parameters.

The system is complete for its defined academic and partner-business scope. It does **not** require a separate backend server, cloud database, authentication module, or external API to execute the implemented workflow.

### Research Problem and Objectives

#### Statement of the Problem

This study develops and evaluates a web-based sales forecasting and inventory optimization system for a selected small to medium retail business. Specifically, it answers the following questions:

1. What demand patterns and inventory management practices are currently used by the partner business?
2. How accurately does a Moving Average baseline forecast short-term product demand from available historical sales records?
3. How accurately does an XGBoost-based model forecast short-term product demand on the same dataset, relative to the Moving Average baseline?
4. What reorder points and reorder quantities are recommended when forecasted demand, lead time, safety stock, and target coverage are applied through the implemented inventory formulas?
5. How do respondents evaluate the developed system in terms of ISO/IEC 25010:2023 characteristics: functional suitability, reliability, interaction capability, performance efficiency, and maintainability?

#### Objectives of the Study

##### General Objective

To develop and evaluate a complete, deployable web-based decision-support system that forecasts product demand and generates restocking recommendations for a small to medium retail business.

##### Specific Objectives

1. To prepare and structure partner-business sales data for forecasting using the system's in-browser processing workflow.
2. To implement a Moving Average model as the statistical baseline for short-term demand forecasting.
3. To implement and evaluate an XGBoost-style regression model in the browser for short-term demand forecasting.
4. To implement reorder-point and order-up-to calculations that generate reorder recommendations from forecasted demand, lead time, safety stock, and coverage settings.
5. To provide a dashboard interface that presents forecasts, confidence indicators, and restocking recommendations in user-friendly form.
6. To compare Moving Average, XGBoost-style, and ensemble outputs using MAE and RMSE under chronological validation.
7. To evaluate the completed system using selected ISO/IEC 25010:2023 quality characteristics.

### Scope and Limitations of the Research

#### Scope

The study covers the design, implementation, and evaluation of StockCast as a browser-based decision-support information system for a defined product set in a selected small to medium retail context.

Within scope, the implemented system:

- processes historical sales records in daily or weekly form;
- acquires data from seeded sample records and CSV-imported sales rows;
- compares Moving Average and XGBoost-style forecasts, including ensemble output;
- evaluates model behavior using chronological holdout and time-series cross-validation;
- computes reorder point, target stock, and reorder quantity using configurable inventory parameters;
- presents outputs through an interactive web dashboard;
- persists application and forecast data in browser storage for continued use;
- is deployable as a static web build.

#### Limitations

1. Forecast reliability depends on data quality, coverage, and regularity.
2. External shocks (for example, sudden disruptions not represented in the dataset) can reduce forecast reliability.
3. The system is decision-support software; final purchasing decisions remain with the owner or manager.
4. Findings are scoped to one partner context and selected products, so broad generalization is limited.
5. Lead-time variability beyond configured assumptions may reduce reorder precision.
6. The current implemented architecture is single-application and browser-resident; multi-user, cloud-hosted, or integrated enterprise deployment is outside the present implementation and is recommended as future work.

### Significance of the Research

This study is significant to:

- **Small and Medium Business Owners**: It provides actionable, data-driven restocking guidance in a complete and practical web tool.
- **Sales and Inventory Staff**: It offers a consistent reference for sales recording and reorder decisions.
- **Future Researchers**: It contributes an evidence-based small-data forecasting design that compares statistical and machine-learning methods under constrained conditions.
- **Academic Institutions**: It demonstrates an applied, community-relevant information system that integrates analytics and operational decision support.

### Definition of Terms

- **Sales Forecasting**: Estimating future product demand from historical sales observations.
- **Inventory Optimization**: Determining when and how much to replenish while balancing stockout and overstock risk.
- **Moving Average**: A statistical baseline that uses recent historical averages to estimate future demand.
- **XGBoost-Style Regression (In-Browser)**: A browser-executed gradient-boosted tree approach used for demand prediction in this implementation.
- **Reorder Point (ROP)**: Stock threshold that triggers replenishment, typically based on expected lead-time demand plus safety stock.
- **Reorder Quantity**: Quantity recommended to restore inventory toward the target stock level.
- **Order-Up-To / Target Stock Level**: Desired post-order stock level based on lead time, coverage period, and safety stock.
- **Safety Stock**: Buffer inventory kept to reduce stockout risk.
- **Lead Time**: Time interval between ordering and receiving stock.
- **Mean Absolute Error (MAE)**: Average absolute prediction error.
- **Root Mean Squared Error (RMSE)**: Square root of average squared prediction error.
- **ISO/IEC 25010:2023**: Software quality model used in this study for selected quality characteristic evaluation.
