# CHAPTER II REVIEW OF RELATED LITERATURE

This chapter reviews studies published from 2023 to 2026 on retail forecasting, small-business inventory practices, and forecast evaluation. The literature supports the selection of XGBoost, a simple statistical comparator, and understandable replenishment rules. It also identifies limits that guide StockCast's treatment of incomplete records, product eligibility, and performance claims. The studies inform the design; accuracy and user assessments for StockCast will be established through the study's own evaluation.

## Related Literature and Studies

### XGBoost for Sales and Demand Forecasting

Andrade and Cunha (2023) propose a gradient boosting approach to disaggregated retail forecasting. Their method addresses the preparation of retail data, including the treatment of stockout effects, before producing forecasts with XGBoost. This connects modeling with the quality of the records available to the model. For StockCast, the implication is to review dated sales observations and inventory conditions before training. A missing entry, a confirmed zero-sale day, and a day affected by unavailable stock must have distinct meanings in the preparation process.

Huan and Sarvghadi (2026) integrate retail demand forecasting with inventory risk assessment using approximately 500,000 product-store-day records from a Chinese e-commerce company. Their comparison covers six forecasting models, and the rankings differ across error measures; no model performs best under every criterion. The study supports connecting predictions to understandable stock information, while showing why a model name alone cannot establish reliability. StockCast will compare methods on the same eligible products, forecast dates, and horizon, using MAE and RMSE rather than transferring another dataset's rankings.

Beck et al. (2025) demonstrate the importance of simple forecasting benchmarks in financial and macroeconomic datasets. Complex methods, including XGBoost, do not consistently beat a naive forecast on highly volatile series. Their setting differs from retail sales, but the evaluation principle supports retaining an inexpensive comparator. Cerqueira et al. (2025) likewise show that aggregate scores can conceal differences across forecasting horizons and data conditions. These findings support StockCast's Moving Average comparison and the reporting of product-level outcomes alongside overall error measures.

### XGBoost in Small and Medium Enterprise (SME) Inventory Contexts

Torres et al. (2024) apply CRISP-DM to inventory demand prediction in a Peruvian retail SME. They compare Random Forest, LSTM, XGBoost, and Decision Tree using 16,071 records and 14 variables, reporting XGBoost as the best-fitting method with an R-squared value of 0.82. This provides a relevant SME application, but the total record count does not establish usable history for each StockCast product. The present study will determine eligibility from each product's dated observations and report a simple fallback when the history is insufficient.

Seyedan et al. (2023) combine ensemble time-series demand forecasting with an order-up-to inventory model. Their work connects forecasts to replenishment decisions under demand uncertainty and lead-time considerations. StockCast uses a simpler, visible replenishment rule: forecast demand and stated inventory settings determine reorder alerts and suggested quantities. The recommendation supports the owner's review. An economic claim of minimum inventory cost would require cost inputs and a separate assessment; the present design evaluates the calculation and its usefulness as decision support.

### Retail Inventory Records and Digital Workflows

Digital stock records provide a basis for identifying products, counting units, and dated transactions. These operational records must be distinguished from a prepared forecast dataset: a saved stock movement does not automatically establish a complete daily sales history. StockCast therefore reviews record meaning and completeness before modeling.

Tanaman et al. (2023) develop a web-based inventory system for a small enterprise in Pagadian City with four branches and a mobile store. The project replaces paper-based recording and report distribution with electronic inventory and sales processing. This is relevant to StockCast's integration of daily business records and dashboard information. The forecasting component adds a separate requirement: imported records must be checked for consistent product identities, dates, quantities, and known interruptions before they are interpreted as evidence of demand.

Table 2.1 connects the reviewed evidence with the design and evaluation questions addressed by StockCast.

**Table 2.1. Comparison of Literature Relevant to the Proposed System**

| **Source** | **Relevant evidence** | **Question retained for this study** |
| --- | --- | --- |
| Andrade and Cunha (2023); Huan and Sarvghadi (2026) | Retail forecasting depends on data preparation and the evaluation measure. | Compare methods on the same products, dates, and horizon. |
| Torres et al. (2024) | XGBoost is applied to inventory demand in a Peruvian retail SME. | Determine usable history for each product and identify fallback products. |
| Beck et al. (2025); Cerqueira et al. (2025) | Simple benchmarks and condition-specific evaluation strengthen model comparison. | Retain a baseline and report product-level as well as overall errors. |
| Tanaman et al. (2023) | A Philippine enterprise implementation illustrates web-based inventory records across outlets. | Maintain identifiable products and transparent stock workflows; evaluate forecasts separately. |
| Seyedan et al. (2023) | Forecasts can inform an order-up-to replenishment policy. | Use visible inventory inputs and assess the stated calculation. |

## Synthesis

The reviewed studies connect retail forecasting with data preparation, product-level evaluation, simple benchmarks, and visible replenishment rules. They do not establish that XGBoost will outperform Moving Average for every StockCast product. The present study retains both methods, documents eligibility and exclusions, and compares their outputs on common chronological test observations.

StockCast combines a business-scoped inventory workflow with reviewed sales data and saved Python forecasts. The research contribution is the implemented decision-support workflow and its documented evaluation, rather than a claim that machine learning universally improves retail outcomes. Client feedback, public-data benchmarks, and controlled software checks remain identifiable evidence sources.

## Theoretical Framework

The forecasting framework combines supervised regression with chronological evaluation. XGBoost represents relationships between past sales features and future product quantities; its retail use is illustrated by Andrade and Cunha (2023). StockCast derives lag, rolling, and calendar features only from information available at each forecast origin. Beck et al. (2025) separate parameter selection from later forecast assessment. Following this principle, the study will define its training, validation, and final-test periods before examining final results, and retain a Moving Average comparator.

The inventory framework links expected demand to replenishment requirements. Seyedan et al. (2023) provide a recent example of forecast-informed order-up-to inventory control. StockCast uses forecast demand, supplier lead time, safety stock, target coverage days, and available stock to calculate reviewable reorder advice. Its safety stock is a configurable buffer; its quantity calculation is a transparent operational rule. The study will assess these stated calculations and avoid treating them as a demonstrated minimum-cost solution.

Strategy 1 addresses forecasting reliability through product-level data sufficiency, chronological comparison, reviewed observations, and a simple fallback. Strategy 2 addresses responsive operation through saved forecasts, a separate training path, and a stated computing budget. Forecast errors and processing times will be measured separately. Cerqueira et al. (2025) support examining performance under distinct conditions; StockCast will identify eligible and fallback products so that a single average does not conceal the limits of the available evidence.

### Implementation Technology

StockCast uses React and TypeScript for the browser interface, FastAPI and Pydantic for Python request handling and validation, psycopg for PostgreSQL transactions, and official Python XGBoost for forecasting. OpenAPI documents the API contract (FastAPI, n.d.), and database transactions keep related stock writes consistent (Psycopg Team, n.d.). The Python estimator interface provides the model used by the separate forecasting worker (XGBoost Developers, n.d.). These implementation references are distinguished from the recent research studies reviewed above.

## Software Quality Framework

ISO/IEC 25010:2023 defines a software product quality model (International Organization for Standardization & International Electrotechnical Commission, 2023). The study will assess five selected characteristics. Business users will assess tasks they actually perform, while qualified technical evaluators will review maintainability and other technical aspects. Survey ratings will describe respondents’ perceptions; task checks, forecast errors, and response-time measurements will provide separate evidence of system behavior.

## Conceptual Framework

Figure 2.1 presents the study's Input-Process-Output framework. Dated sales and product records, stock on hand, lead time, safety stock, and coverage days enter the proposed system. The process checks data quality, compares an eligible XGBoost forecast with the Moving Average baseline, and calculates reorder advice. The outputs are forecasts, stock status, data-quality warnings, and suggested replenishment quantities for review by the owner or staff.

**Figure 2.1. Input-Process-Output Conceptual Framework**

References are listed in [the final reference section](./References.md).
