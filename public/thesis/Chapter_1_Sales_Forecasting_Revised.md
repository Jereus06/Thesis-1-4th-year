# Sales Forecasting and Inventory Optimization for Small and Medium Retail Businesses Using XGBoost

## CHAPTER I

## INTRODUCTION

### Project Context

Small and medium retail businesses (for example, pharmacies, hardware stores, bakeries, and independently owned specialty shops) commonly make inventory decisions through owner intuition or manual record-keeping rather than data-driven demand forecasting. This often leads to two recurring and costly problems: overstocking, which ties up limited working capital and may increase spoilage risk, and understocking, which causes missed sales and customer dissatisfaction.

These businesses are important contributors to local economies but are often underserved by practical decision-support tools. Unlike large retail chains with dedicated analysts and enterprise systems, small retail shops typically need affordable, easy-to-use tools that convert their own sales records into actionable restocking guidance.

This study develops **StockCast**, a sales forecasting and inventory optimization prototype for small retail shops. The implemented prototype is a **client-side React/Vite/TypeScript application** with **no backend, database, or authentication layer**; data is managed through Zustand state and persisted in browser localStorage. The system uses seeded or imported sales records, compares a Moving Average baseline with an in-browser custom XGBoost-style model, and includes an ensemble forecast option. Forecast outputs are translated into reorder recommendations using lead time, safety stock, and target coverage settings. Results are shown through a dashboard intended for non-technical users.

### Research Problem and Objectives

#### Statement of the Problem

This study aims to develop and evaluate a sales forecasting and inventory optimization system for a small to medium retail setting. Specifically, it seeks to answer the following questions:

1. What demand patterns and inventory practices are observed in the partner small retail context?
2. How accurately does a Moving Average baseline forecast short-term demand using available sales history?
3. How accurately does the XGBoost-style model forecast short-term demand on the same data compared with Moving Average?
4. What reorder points and reorder quantities does the system recommend when forecasted demand, lead time, safety stock, and coverage settings are applied through reorder formulas?
5. How do the owner and relevant staff evaluate the developed system using selected ISO/IEC 25010:2023 characteristics (functional suitability, reliability, interaction capability, performance efficiency, and maintainability)?

#### General Objective

To develop and evaluate a sales forecasting and inventory optimization system that predicts product demand and produces restocking recommendations for a small retail business context.

#### Specific Objectives

1. Organize historical sales records into a usable forecasting dataset.
2. Implement a Moving Average model as a baseline for short-term demand forecasting.
3. Implement an in-browser custom XGBoost-style regression model for short-term demand forecasting.
4. Implement an inventory optimization component that computes reorder point and recommended reorder quantity using forecasted demand, lead time, safety stock, and coverage settings.
5. Present forecasts and restocking guidance through an accessible dashboard interface.
6. Compare model performance using MAE and RMSE.
7. Evaluate the system using selected ISO/IEC 25010:2023 characteristics.

### Scope and Limitations of the Research

#### Scope

1. The system focuses on demand forecasting and inventory optimization for a defined set of products in a selected small retail context.
2. The implementation is a browser-based prototype (React/Vite/TypeScript) that runs client-side and stores data in localStorage.
3. The study compares Moving Average, XGBoost-style forecasting, and an ensemble approach within the same chronological evaluation setup.
4. The system calculates reorder point and reorder quantity from forecasted demand, lead time, safety stock, and target coverage settings.
5. The system presents outputs through dashboard pages for inventory, forecasts, restock guidance, and methodology.

#### Limitations

1. Forecast quality depends on the length and consistency of available historical sales data.
2. The model does not inherently account for all sudden external factors (for example, unexpected events or disruptions) unless represented in available features.
3. The system is decision support only; final inventory decisions remain with the owner.
4. Findings are bounded to the selected business context and product scope.
5. The prototype has no backend, no centralized database, and no user authentication.

### Significance of the Research

This study is beneficial to the following:

- **Small Retail Owners**: It offers practical, data-informed restocking guidance that can reduce overstock and stockout risk.
- **Sales and Inventory Staff**: It provides a structured basis for routine replenishment decisions.
- **Future Researchers**: It documents a small-data forecasting workflow that compares baseline, machine learning, and ensemble strategies.
- **Academic Community**: It contributes an applied case of machine-learning-assisted inventory decision support in a local small-business context.

### Definition of Terms

- **StockCast**: The developed client-side sales forecasting and inventory optimization prototype used in this study.
- **Sales Forecasting**: Estimating future product demand using historical sales data.
- **Inventory Optimization**: Determining replenishment timing and quantity to balance stockout risk and overstock cost.
- **Moving Average**: A baseline forecasting method that averages recent observations.
- **XGBoost-style Model**: The implemented in-browser gradient-boosting-inspired regression model used by the system.
- **Ensemble Forecast**: A combined forecast derived from Moving Average and XGBoost-style outputs.
- **Reorder Point (ROP)**: Inventory threshold at which replenishment should be triggered.
- **Safety Stock**: Buffer inventory to absorb uncertainty in demand or replenishment.
- **Lead Time**: Time from placing an order to receiving stock.
- **MAE**: Mean Absolute Error, the average absolute prediction error.
- **RMSE**: Root Mean Squared Error, which penalizes larger errors more strongly than MAE.
- **ISO/IEC 25010:2023**: Software quality model used for selected system evaluation characteristics in this study.
