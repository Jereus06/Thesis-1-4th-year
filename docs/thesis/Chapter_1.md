# Thesis Chapter 1

> Current text mirror of `Chapter_1.docx`, supplied by the project owner on 2026-09-24. This Markdown file is intended for Codex/developer context and source-text searching. Word-specific layout, embedded figures, and pagination may not be reproduced here; preserve the original DOCX for formal submission.

Sales Forecasting and Inventory Optimization for Small Retail Businesses Using
XGBoost Algorithm
CHAPTER I
INTRODUCTION
Project Context
Small retailers must decide what to stock despite limited cash, shelf space, and sales
records. Philippine studies of specific micro-retail settings have documented manual
inventory checks and decisions affected by cash availability, unrecorded withdrawals, and
stock shortages (Custodio, 2017; Pallera et al., 2026). These findings motivate the present
study; the researchers will establish the selected partner business’s actual practices through
an interview and record review rather than assume they are identical.
For a small retailer, a useful forecasting tool must connect its own dated sales
records to decisions about stock. Too much stock can tie up working capital, while too little
can leave demand unmet. Reorder advice also depends on stock on hand, supplier lead
time, and a safety stock buffer (King, 2011). The proposed system will make these inputs
visible so the owner can review a recommendation before purchasing.
XGBoost provides a regularized tree-boosting method for prediction (Chen &
Guestrin, 2016), and a study of a Peruvian retail small business reported useful results with
that method (Torres et al., 2024). Those results cannot establish accuracy for an unselected
Philippine partner or products with short and irregular histories. The present study will
compare a verified XGBoost implementation with a Moving Average baseline on actual
partner records when enough usable data are available.
This study proposes to develop a complete sales forecasting and inventory decision￾support system for a selected small retail business. It will record sales and products, present
forecasts, and recommend when and how much to reorder using forecast demand, stock,
lead time, safety stock, and coverage days. Data-sufficiency rules will route products
without enough usable history to a clearly identified simple estimate. Forecast accuracy
and software quality will be evaluated after the partner, data, and completed system are
available.
Development status. The current React and TypeScript front end demonstrates sales
entry, inventory views, forecasting screens, and restocking recommendations using
generated example data and browser storage. Backend services and persistent business￾data handling are still being developed, and a partner business has not yet been selected.
The custom tree-boosting module is not yet verified as XGBoost. These screens
document prototype progress, not completed business evaluation.
Research Problem and Objectives
Statement of the Problem
This study aims to develop and evaluate a sales forecasting and inventory
optimization system for a small retail business. Specifically, it seeks to answer the
following questions:
What are the demand patterns and inventory management practices currently used by the partner small
retail business?
How accurately does a Moving Average model, used as a statistical baseline, forecast short-term
product demand based on the business's historical sales data?
How accurately does the implemented and verified XGBoost algorithm forecast short-term product
demand, compared with a Moving Average baseline on the same business records?
How do Moving Average, XGBoost, and their optional ensemble compare on the same product-period
observations in an independent chronological test?
How effectively do the data-sufficiency and dashboard-performance strategies support products with
limited sales history and timely use of the completed system?
What reorder points and reorder quantities does the system recommend when forecasted demand,
supplier lead time, a configurable safety stock buffer, and a target coverage period are applied through
the Reorder Point and Order-Up-To formulas?
How do business users and qualified technical evaluators assess the completed system using the
relevant ISO/IEC 25010:2023 characteristics of functional suitability, reliability, interaction
capability, performance efficiency, and maintainability?
Objectives of the Study
General Objective
To develop and evaluate a sales forecasting and inventory decision-support system
for a selected small retail business, with a verified XGBoost method where the records
permit, a Moving Average fallback, and restocking advice reviewed on actual business
data.
Specific Objectives
To document the partner business’s sales and stock practices, obtain permission to use its dated
records, and prepare those records for fair forecasting tests.
To complete the sales, stock, import, and dashboard workflow and integrate the backend and business￾data persistence after their design and testing are finished.
To implement a Moving Average baseline and a verified XGBoost algorithm for eligible products,
with a documented simple fallback for products that lack sufficient usable history.
To compare the baseline, XGBoost, and any justified ensemble on identical product-period
observations using chronological validation and a separate final test period for MAE and RMSE.
To document the data-quality checks, product eligibility rule, treatment of missing dates and
stockouts, and warning shown when forecast evidence is limited.
To measure forecast processing and dashboard response time on the intended device, then use caching
or a background execution path when needed.
To compute transparent reorder alerts and suggested quantities using forecast demand, on-hand stock,
supplier lead time, safety stock, and target coverage days.
To evaluate the completed system with business users and qualified technical evaluators on the
relevant ISO/IEC 25010:2023 product quality characteristics.
Scope and Limitations of the Research
Scope
• The completed system will support forecasting and inventory decision support for a defined
set of products at one selected small retail business. The research question concerns that
partner setting; it does not assume results generalize to all small retailers.
• With the partner’s permission, the study will use verified dated sales, product, and stock
records. Sales entry, product maintenance, stock receipts, and import functions are part of the
planned workflow. Backend integration, durable storage, access controls, and recovery
procedures are in development and will be documented after implementation. Generated
demonstration records will remain separate from business evaluation.
• The forecasting component will implement and verify XGBoost, compare it with a Moving
Average baseline, and use an ensemble only when validation supports it.
• The system will calculate reorder points and order-up-to quantities from daily forecast
demand, lead time, safety stock, target coverage days, and available stock. It will distinguish
a reorder alert from an illustrative target quantity; any outstanding orders or backorders must
be recorded before they can be used in an inventory-position formula.
• The browser dashboard will display product forecasts, data-quality messages, stock status,
and restocking recommendations. The proposed roles of owner and staff will be implemented
only to the extent supported by the completed backend and access-control design.
• The completed system will be evaluated using like-for-like MAE and RMSE on held-out real
sales records and selected ISO/IEC 25010:2023 software quality characteristics.
The performance strategy will reuse valid cached forecasts and limit expensive training to products
with adequate data; training duration and dashboard responsiveness will be measured on the intended
device.
The present prototype checks product history separately, requires at least 100 nonzero daily sales
observations for its boosted method, and can aggregate very sparse daily series to weekly totals. Those
settings are implementation defaults, not a scientifically established universal minimum. The final
eligibility rule and fallback will be fixed after a partner-data audit and before final testing.
Limitations
• Forecast accuracy depends on the length, completeness, and provenance of actual business
records. Eight weeks of overall sales history is a development fallback setting, not enough to
meet the current per-product threshold of 100 nonzero sales days for boosted training. Weekly
aggregation can also leave too few observations. Missing records and stockout days must be
checked before either is treated as zero demand.
• The system does not account for unpredictable external factors, such as sudden local events,
promotions, or supply disruptions, unless such factors are explicitly included as model
features.
• The system is designed to support, not replace, the business owner's judgment; final
purchasing and inventory decisions remain the owner's responsibility.
• A partner business is still being sought; its records, final backend, independent forecast test,
and user survey are pending. Generated demonstration values cannot establish accuracy for a
real shop. The development build also uses its holdout for some model choices; those choices
must instead use an earlier validation period before the final test is reported.
• The inventory optimization component assumes reasonably stable supplier lead times; highly
variable or unreliable supply chains may reduce the accuracy of reorder recommendations.
• Products without sufficient verified history will receive a transparent simple forecast or a
manual restocking rule. Synthetic examples may be used for development demonstrations
only and must never silently replace real business records or be reported as empirical results.
Significance of the Research
This study is deemed beneficial to the following:
Small Retail Business Owners — The proposed system will translate dated sales
records into forecasts and clear restocking advice, supporting more informed cash flow and
stock decisions.
Sales and Inventory Staff — The system will provide a consistent record and
reference for stock monitoring and replenishment decisions.
Future Researchers — The study will document the completed system, its
independently tested forecasts, and the practical limits of forecasting from a small retailer’s
historical records.
The Academic Institution — The study will document the implemented
forecasting method, independent comparison, inventory rule, and limits of the selected
partner dataset for review and further research.
Definition of Terms
Sales Forecasting — The process of predicting future customer demand for products based
on historical sales data.
Inventory Optimization — In this study, using forecasts and stock parameters to
recommend when and how much to reorder. The method will be assessed as decision support; it
does not claim to solve a measured total-cost minimization problem.
Moving Average — A simple statistical forecasting technique that predicts future values
based on the average of a fixed number of recent historical observations.
XGBoost Algorithm — The extreme gradient boosting method intended as the primary
forecasting model. The existing browser code contains a custom gradient-boosted tree module; its
equivalence to XGBoost has not been established and must be verified or the module replaced
before final evaluation.
Reorder Point — The inventory level at which a new order should be placed to replenish
stock before it runs out, calculated based on average demand during the supplier's lead time plus a
safety stock buffer.
Reorder Quantity — A nonnegative quantity intended to bring inventory to a defined
order-up-to level when a reorder is due. The development build calculates the quantity
independently of the reorder alert; this interaction must be reviewed before pilot use.
Order-Up-To Level — The target inventory level that an order is meant to restore,
computed from the average forecasted demand over the supplier's lead time and a target coverage
period, plus a safety stock buffer.
Safety Stock — An additional buffer quantity of inventory kept on hand to reduce the risk
of stockouts caused by demand variability or supply delays.
Lead Time — The amount of time between placing an order with a supplier and receiving
the stock.
Mean Absolute Error (MAE) — An evaluation metric that measures the average
magnitude of errors between predicted and actual values, without considering their direction.
Root Mean Squared Error (RMSE) — An evaluation metric that measures the square
root of the average squared differences between predicted and actual values, penalizing larger
errors more heavily than MAE.
Ensemble Forecast — A combined forecast produced from the XGBoost prediction and Moving
Average prediction for use as an operational forecasting option.
Confidence Indicator — A descriptive signal of data sufficiency. A numerical score will not be
represented as a probability of forecast accuracy without calibration and validation.
Prediction Range — An uncertainty range that requires calibration using validation data and
evaluation on an independent test period before any coverage claim is made.
Strategy 1: Five Levels of Accuracy and Reliability — The study's strategy for improving
forecast trustworthiness through data-level, feature-level, model-level, ensemble-level, and
uncertainty-level controls.
Strategy 2: Five Techniques of Speed and Architecture — The system will cache valid results,
show a quick baseline while updates are computed, restrict expensive training to suitable
products, limit validation folds where appropriate, and measure or improve dashboard
responsiveness.
Top-N Products — The highest-volume eligible products prioritized for the expensive model
under a configurable computing budget; the present development default is eight and its boosted
model additionally requires 100 nonzero daily sales observations.
ISO/IEC 25010:2023 — An international standard that defines a product quality model
for software and ICT products; this study uses five of its characteristics (functional suitability,
reliability, interaction capability, performance efficiency, and maintainability) to evaluate the
developed system.
