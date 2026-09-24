# Thesis Chapter 3

> Current text mirror of `Chapter_3.docx`, supplied by the project owner on 2026-09-24. This Markdown file is intended for Codex/developer context and source-text searching. Word-specific layout, embedded figures, and pagination may not be reproduced here; preserve the original DOCX for formal submission.

CHAPTER III
METHODOLOGY
Research Design
The study uses a developmental design to build the proposed system and quantitative measures to test its forecasts. A partner business is still being sought and the backend is being developed. The current browser prototype demonstrates the screens and core workflows with generated records; real-data accuracy, durable record storage, and user evaluation remain future work. The study will report forecast and software-quality results only after those activities are completed.
The completed system will implement the XGBoost algorithm as its primary forecasting model where each product has enough history, and a Moving Average baseline for comparison and sparse products. An ensemble may be used when prior validation shows that it is useful. The existing custom TypeScript booster is a development component; before final evaluation, the researchers must validate its XGBoost equivalence or replace it with a verified XGBoost implementation.
The system will turn estimated daily demand into reorder points and suggested quantities from on-hand stock, lead time, safety stock, and coverage days. These calculations support inventory decisions but are not an optimization of a measured total cost. The business will confirm how outstanding orders and backorders are handled before pilot use.
The developed system will also be evaluated based on selected ISO/IEC 25010:2023 software quality characteristics, specifically functional suitability, reliability, interaction capability, performance efficiency, and maintainability.
Development Approach
The researchers will use an iterative development process. The current GitHub project contains a React, TypeScript, and Vite browser front end with sales and inventory screens, example forecasts, and local browser storage. Backend development is underway. The final implementation will record the backend architecture, database design, access rules, and recovery procedures when those components are built and checked; the browser prototype does not establish that these services or a verified XGBoost implementation are finished.
Planning → Data Audit → System and Backend Design → Forecast Development → Integration → Functional Testing → Independent Evaluation → Refinement
Planning – The researchers will identify the requirements of the partner business, including its current sales and inventory management practices, the products, historical sales records, supplier lead times, and other inventory-related information needed by the system.
Data Preparation – The collected historical sales records will be cleaned, organized, and transformed into a structured dataset for both the Moving Average baseline and the XGBoost model.
System Design – The documented interface, backend, data flow, access rules, forecasting process, inventory calculations, and storage approach will be updated as implementation decisions are completed.
Model Development – A verified XGBoost implementation and Moving Average baseline will be fitted using cleaned, dated business sales records; the existing custom booster will be validated or replaced.
System Development – The team will integrate validated forecasting, sales and stock records, backend persistence, and the dashboard; the underlying database design will be documented by the team when available.
Testing – The system will undergo functional and performance testing to determine whether its components operate according to their intended functions.
Evaluation – The forecasting models will be evaluated using MAE and RMSE, and the completed system will be evaluated using selected ISO/IEC 25010:2023 software quality characteristics.
Refinement – The results from testing and evaluation will be used to identify issues and improve the system before the final implementation.
Moving Average Model
The Moving Average model will be implemented as the statistical baseline of the study. It will forecast future product demand by calculating the average of a fixed number of recent historical observations.
MAₜ = (Dₜ₋₁ + Dₜ₋₂ + ⋯ + Dₜ₋ₙ) / n
Where:
MAₜ = forecasted demand for the current period
D = actual demand
n = number of previous periods included in the calculation
The Moving Average model will provide a baseline against which the performance of the XGBoost model can be compared.
XGBoost Model
The primary machine learning method of the completed system will be Extreme Gradient Boosting (XGBoost), a sequence of regularized decision trees that models nonlinear relations in dated sales features. Its exact implementation and parameters will be documented and tested before it is described as completed.
Products will be modeled separately when enough observations exist; products with insufficient evidence will receive the Moving Average or simple reorder rule. The current browser code uses a custom tree-boosting module, and does not by itself establish that a verified XGBoost model is in place.
The model will use prepared historical sales features as inputs and the corresponding future demand as the target variable.
Candidate predictors will be calculated only from information available before the predicted period, including:
Lagged sales quantities
Rolling averages calculated from past periods only
Calendar features such as day of week or month, where usable
Available holiday or promotion flags known before the forecast date
Other features available in advance and justified by the data
The planned model will use lagged sales, rolling averages, calendar variables, and actual promotion information only where it is available before prediction. The development build currently uses date-based holiday and promotion proxies; these will not be presented as recorded partner promotions.
Model Training and Testing
After a partner is selected, the team will audit the available records and record the modeling unit, forecast horizon, eligible product set, data-quality exclusions, and training, validation, and final test date cutoffs before reviewing final test outcomes. The most recent contiguous eligible period will be held out for final testing and must cover the agreed forecast horizon. The current development code holds out up to 28 daily or four weekly observations, but that implementation setting does not determine the final study split (Hyndman & Athanasopoulos, 2021).
Training dates will precede validation dates, which will precede final test dates. Baseline windows, XGBoost parameters, eligibility thresholds, ensemble weights, and any uncertainty calibration will be selected on training or validation data only. Products must have adequate history before the test period; the report will count included and excluded products, describe stockouts and missing transactions, and state any limitations caused by short records.
Each test forecast will use only sales and features known at its forecast origin. A forecast labeled fourteen days ahead will be scored against the appropriate fourteen-day target, with no actual sales from later in that horizon fed into earlier predictions. The same product-date-horizon observations will be scored for every compared method. The current development build uses its holdout for some model choices, ensemble weights, and displayed ranges; that reuse must be removed before the final independent test is reported.
Two Complementary Strategies for Small-Data Forecasting Systems
Sales history in the selected retail setting may be short or uneven across products. The two strategies address forecast reliability and dashboard response time; their benefits will be assessed rather than assumed.
Strategy 1 defines data, feature, model, fallback, and uncertainty rules for sparse history. Strategy 2 defines training and serving practices intended to keep the dashboard responsive. Forecast errors and measured dashboard behavior will be reported separately.
These strategies form the completion and evaluation plan. Their thresholds, forecast errors, computational cost, and effects on real partner records will be tested before conclusions about business performance are drawn.
Strategy 1: Five Levels of Accuracy and Reliability
Strategy 1 is organized as five successive levels. Each level addresses a different source of error that appears when sales history is short or sparse. The levels are applied in order: data are made usable before features are built; features are constrained before a model is fit; the model is regularized before it is combined with a baseline; and every product forecast is finally accompanied by an explicit statement of uncertainty.
Level 1 - Data-Level Fixes
The first level does not involve machine learning. It specifies the minimum history the system is willing to treat as a modeling problem, and it changes the grain of the series when daily data are too sparse to be informative.
The development build’s eight-week setting checks overall history and can trigger a deterministic synthetic demonstration series when enabled. That generated series is not public or partner data, despite a current interface label. In the completed system, insufficient real history will produce an explicit warning and an eligible baseline, never a silent replacement with generated demand.
In the current development build, products with more than 30 percent zero-sale days are aggregated to weekly totals; boosted training also requires at least 100 nonzero daily observations and prioritizes at most eight products by volume. Eight weeks alone cannot provide 100 distinct nonzero days. These rules will be reviewed on the partner records, including the distinction between zero demand, stockouts, and missing transactions.
Development thresholds: eight weeks for the overall demo-data check; at least 100 nonzero sales days per product for boosted training. The final system will state its chosen thresholds and fallback behavior.
The proposed preprocessing will aggregate sparse series where useful, while checking stockouts and missing observations before treating recorded zero sales as demand.
A top-N computing limit may prioritize eligible high-volume products; every excluded product will retain an explicitly labeled simple estimate or manual reorder rule.
Generated data will be confined to development demonstrations, labeled clearly, and excluded from evaluation and operational forecasts.
Level 2 - Feature-Level Fixes
The final feature set will use values known at the forecast date. The development module trains separately by product; its category index is constant within each product model and cannot provide cross-product learning. Any future pooling would require a new design and validation.
Candidate daily features are lags of one, seven, and fourteen days; seven- and thirty-day rolling means; and relevant calendar variables. Weekly data may use one-, two-, and four-week lags. Promotions will be used only if reliable business records exist before each forecast date.
Lag and rolling features will be computed exclusively from earlier periods. The research report will document the warm-up rows and exclude observations without sufficient prior data when required.
lags: 1, 7, 14 (or 1w, 2w, 4w when the grain is weekly)
rolling means: 7 and 30 days (or 4w and 8w)
calendar: day of week or week of year, month
verified holiday or promotion flags available before the prediction date; omit unavailable partner promotion information
Level 3 - Model-Level Fixes
The completed system will use a documented, validated XGBoost implementation. The development booster currently fixes tree depth at 3, learning rate 0.05, a cap of 120 trees, L2 regularization at 1.5, gamma at 0.3, and early stopping after ten validation rounds. These settings are provisional and cannot substitute for proof that the official algorithm is implemented.
The final model will choose its settings on preceding chronological folds or a separate validation interval and reserve a later interval for final reporting. The size and number of usable folds depend on verified history and the selected horizon. If the partner records cannot support an independent XGBoost evaluation, the result will be reported as infeasible for those products instead of lowering a threshold because of test performance.
Provisional development settings: depth 3, learning rate 0.05, at most 120 trees, regularization, and ten-round early stopping; final settings must be documented after validation.
Up to three chronological validation folds where history permits; one reserved, untouched final test period for comparable model reporting.
No random shuffling of time-ordered rows.
Level 4 - Ensemble-Level Fixes
The ensemble will use weights calculated only from chronological training or validation errors. The development code can substitute holdout MAE and also uses holdout MAE to reject unstable boosted models; both uses must be removed or isolated before the final independent test.
The final dashboard will identify which method produced each forecast and report validation and final test metrics separately. Model choices will be fixed before final testing, rather than selected because they performed best on the test data.
w_XGB = [1/max(0.000001, validation MAE_XGB)] / {[1/max(0.000001, validation MAE_XGB)] + [1/max(0.000001, validation MAE_MA)]}; w_MA = 1 − w_XGB. Test-set MAE will not determine weights.
Level 5 - Uncertainty-Level Fixes
The system may display a descriptive confidence level based on usable observations. A forecast interval or probability will be shown as calibrated only if residuals are estimated using prior validation data and coverage is checked on an independent test period. Otherwise, the interface will use a clear data-sufficiency warning.
The interface also states, in owner language, that forecasts are decision-support only and not guarantees. Final purchasing decisions remain the owner’s. This disclaimer is part of the methodology, not an afterthought on the user interface: the system is designed to support judgment, which is already listed among the limitations of the study.
Flag insufficient product history transparently; a heuristic observation-count score is not a probability of correctness.
Show validation-derived uncertainty ranges only if their coverage is checked separately on the final test period.
On-screen disclaimer: forecasts are decision-support only, not guarantees.
Strategy 2: Five Techniques of Speed and Architecture
The five performance techniques aim to make the complete system usable during normal business operations: show valid cached results or a quick baseline, keep previous successful results, prioritize expensive products, control validation cost, and test responsiveness during training.
Technique 1 - Separate Training from Serving
The present browser prototype computes forecasts on the client and shows a quick baseline during an update. Backend work is underway; where forecast training ultimately runs will be documented after integration. The team will measure interaction time and move blocking computations to a worker or backend process if the completed workflow requires it.
Technique 2 - Pre-Train and Cache
Completed forecasts may be cached against the input records and settings that produced them. The browser demonstration currently uses local storage. The completed system will document cache invalidation, business-data storage, controlled export or backup, and a tested recovery path when backend integration is finished.
Technique 3 - Train Only on Top N Products
The current default selects up to eight high-volume, eligible products for expensive training. The completed system will choose and disclose its budget, report products excluded by the limit, and provide a simple estimate for those products.
Technique 4 - Reduce Cross-Validation Folds
Up to three chronological validation folds may be used when enough history exists. When folds are unavailable, the system will use a simple baseline or a previously justified rule rather than use final test errors to set ensemble weights.
Technique 5 - Train Asynchronously
The system will show valid cached or baseline forecasts during an update and measure dashboard interaction while models train. The present job yields between products but trains each model on the main thread; a worker or alternative design will be implemented if testing shows unacceptable pauses.
How the Two Strategies Interact
The two strategies meet at product eligibility and chronological validation. The same top-N budget limits both which products can use the expensive model and the amount of computation; the number of validation folds affects both model selection and training time. Both choices will be reported with their measured effects.
Strategy 1 will be evaluated through product eligibility, fallback behavior, and MAE and RMSE on verified records. Strategy 2 will be evaluated through training time, cache accuracy, and measured dashboard responsiveness. Values will be reported after the final system is tested.
Implications for Evaluation
The final study will compare Moving Average, XGBoost, and any ensemble on identical eligible product-period observations using an independent chronological test set. The current development dashboard aggregates its baseline across more products than its boosted metric and uses the holdout for some decisions; these discrepancies must be corrected before its figures can be presented as research results.
Data-sufficiency labels and any residual-based range will be qualified until validated. The researchers will measure rather than assume that cached display and forecast training maintain acceptable response times.
Forecasting Evaluation
The forecasting models will be evaluated using Mean Absolute Error (MAE) and Root Mean Squared Error (RMSE), as specified in the objectives of the study.
Mean Absolute Error
MAE measures the average absolute difference between the predicted demand and the actual demand.
MAE = (1/n) Σ |yᵢ − ŷᵢ|
Where:
n = number of observations
yᵢ = actual demand
ŷᵢ = predicted demand
A lower MAE indicates that the model's predictions are closer to the actual demand.
Root Mean Squared Error
RMSE measures the square root of the average squared difference between predicted and actual demand.
RMSE = √[(1/n) Σ (yᵢ − ŷᵢ)²]
A lower RMSE indicates smaller forecast errors and assigns more weight to large errors. MAE and RMSE will be stated in units sold for each product or comparable group. The report will show the eligible product count, the common scored dates, the horizon, and product-level comparisons before presenting any combined result.
MAE and RMSE will be computed for each compared model on the same eligible product-period observations. Products without enough history for XGBoost will be reported separately with their baseline forecasts. The development dashboard’s mixed product aggregates will not be treated as like-for-like final evidence.
Inventory Optimization
The inventory optimization component will convert forecasted product demand into actionable restocking recommendations by determining when to order and how much to order.
Reorder Point (When to Order)
The system will calculate the Reorder Point (ROP) using forecasted demand, supplier lead time, and safety stock.
ROP = (Dᴬ × L) + SS
Where:
ROP = Reorder Point
Dᴬ = average forecast demand per day
L = supplier lead time
SS = safety stock
The final inventory workflow will distinguish on-hand stock, any confirmed open orders, and reorder status where those records are available. The present front end tracks on-hand stock and computes a suggested quantity independently of the alert; its advice must be reviewed with the business before deployment.
Reorder Quantity (How Much to Order)
When a reorder is due, the suggested quantity will raise the selected inventory measure toward an order-up-to level (S) covering forecast demand during lead time and the owner’s target coverage period plus safety stock.
S = Dᴬ × (L + C) + SS
If H ≤ ROP and no outstanding orders or backorders are recorded, Q = max(0, ⌈S − H⌉); otherwise no reorder alert is issued. Any use of inventory position instead of H requires verified open-order and backorder records.
Where:
S = order-up-to level (target inventory level)
C = target coverage period, or the number of periods the order is intended to cover once delivered, set by the business owner
H = stock on hand for the basic single-location rule; open orders and backorders will be included only if reliable records are available
Q = nonnegative whole-unit suggestion when the reorder condition is met; the owner decides the final purchase
Demand, lead time, and coverage will all use day units. For 10 units per day, a 3-day lead time, 7-day coverage, safety stock of 15, and 40 units on hand, ROP = 45, S = 115, and suggested Q = 75 because H ≤ ROP. The current front end can show a quantity even above ROP; the final workflow will separate or reconcile that behavior with the alert.
The system will allow the safety stock, supplier lead time, and target coverage period to be configured according to the available business information. The study assumes reasonably stable supplier lead times because highly variable supply chains can reduce the accuracy of reorder recommendations.
System Evaluation
The completed system will be assessed against selected characteristics of the ISO/IEC 25010:2023 product quality model (International Organization for Standardization & International Electrotechnical Commission, 2023). Task checks, forecast-error measurements, and response-time measurements will complement respondent ratings:
Functional Suitability – Determines whether the system provides the functions necessary to perform sales forecasting, inventory optimization, and restocking recommendations.
Reliability – Determines the system's ability to perform its required functions consistently under specified conditions.
Interaction Capability – Assesses whether owners and staff of a small retail business can understand and use forecasts, stock status, and recommendations. This characteristic was named Usability in the 2011 edition of the standard.
Performance Efficiency – Assesses the system's responsiveness and resource usage while performing its forecasting, inventory optimization, and dashboard functions.
Maintainability – Assesses how easily the system can be analyzed, modified, and maintained when changes or improvements are required.
Evaluation Instrument
The study will prepare a researcher-made, five-point questionnaire based on the five selected ISO/IEC 25010:2023 characteristics. Appendix A provides editable draft items for adviser review. Business owners and staff will rate observable workflows and interaction after using the completed system; qualified technical evaluators will assess maintainability through the implemented code, documentation, and change checks. The adviser and, where available, information technology faculty will review the final wording before voluntary, confidential administration. No respondent counts or ratings are claimed at this stage.
Rating Scale and Interpretation
Respondents will rate each statement using a five-point Likert scale. The mean rating will be interpreted using the following scale:
Table 1. Likert Scale and Interpretation
	Rating
	Mean Range
	Response
	Interpretation

	5
	4.21 – 5.00
	Strongly agree
	Strong positive assessment

	4
	3.41 – 4.20
	Agree
	Positive assessment

	3
	2.61 – 3.40
	Neither agree nor disagree
	Neutral assessment

	2
	1.81 – 2.60
	Disagree
	Negative assessment

	1
	1.00 – 1.80
	Strongly disagree
	Strong negative assessment

Statistical Treatment
The weighted mean will be computed for each statement using the formula below:
WM = Σ(f × x) / n
Where:
WM = weighted mean of the statement
f = number of respondents who gave a particular rating
x = numerical value of the rating (1 to 5)
n = total number of respondents
Each characteristic mean will be the average of its item means for the relevant respondent group. Business-user ratings and technical-evaluator ratings will be identified separately and will not be pooled into an overall score when the groups answer different items. Because the direct-user group is likely small, results will be descriptive and cannot be generalized beyond this partner. Objective task checks and forecast MAE/RMSE will be reported separately from opinions.
Population of the Study
The team is seeking a small retail business willing to participate. Once selected, it will supply, with permission, the historical sales and inventory information used to configure, develop, and test the completed system.
The selected business will be identified based on its suitability for the study, particularly its availability of historical sales records and an existing inventory management process that can be analyzed and improved through the proposed system. The system will focus on a defined set of products handled by the partner business. The study will not attempt to represent all small retail businesses because the scope is limited to a single partner business and defined product category.
The partner will be selected purposively according to consent, access to dated sales records, and a relevant stock workflow. Actual business and respondent details will be documented after recruitment. A product without adequate verified history may still be included in a dashboard demonstration but will not be counted as an eligible XGBoost test product.
The population of this study consists of the individuals directly involved in the use and evaluation of the proposed sales forecasting and inventory optimization system. This includes the owner of the partner small retail business, who is the primary decision-maker for purchasing and inventory decisions, and any sales or inventory staff involved in day-to-day stock monitoring and restocking activities.
Owner and staff respondents will assess features they use, including functional suitability, reliability, interaction capability, and perceived response time. Qualified technical evaluators may review maintainability and implementation aspects. The final instrument will state the respondent group for each item so owner opinions are not presented as a source-code maintainability assessment.
Table 2. Planned Respondent Groups (Counts to Be Confirmed)
	Respondent Group
	Number
	Basis of Selection

	Business Owner / Manager
	To be confirmed
	Primary decision-maker on restocking and purchasing

	Available Sales or Inventory Staff
	To be confirmed
	Direct users of the inventory records and dashboard

	Invited Technical Evaluators
	To be confirmed
	Technical assessment of the developed system

	Actual Total
	To be confirmed

The owner and available staff who will use the system will be invited to evaluate it. Qualified technical evaluators may be purposively invited to assess relevant technical characteristics. Actual counts and response rates will be reported after data collection; no sampling formula is applied to the small direct-user group.
In addition, the historical sales and inventory records of the partner business constitute the data population from which the study's training and testing datasets are drawn.
Data Collection Procedure
The researchers will gather the historical sales records of the partner business with permission from the business owner. The collected data will be used as the primary dataset for developing and evaluating the forecasting models.
The data may include the following information:
Table 3. Data Fields to be Collected
	Data
	Description

	Date
	Date when the product was sold

	Product ID/Name
	Identifier or name of the product

	Quantity Sold
	Number of units sold

	Available Stock
	Available inventory at the time of the transaction, when applicable

	Supplier Lead Time
	Number of days required to receive an order

	Current Stock
	Current quantity of the product in inventory

	Unit Cost (if available)
	Product purchase cost for inventory display; not used in the forecast model

Historical sales may come from an authorized spreadsheet or point-of-sale export and will be checked for consistent dates, product identity, units, duplicates, missing days, and stockout periods. The team will document any digitization needed. Backend data storage and recovery will be specified only after the ongoing backend design has been implemented and reviewed.
Generated sales may be used for interface and functional tests, but will be visibly labeled and excluded from final business accuracy claims. If the partner dataset is too short for XGBoost, the system will use a disclosed baseline and report the insufficient-data limitation.
The study requires basic digital sales records because the forecasting component depends on historical sales information. Businesses that rely entirely on paper-based records would require additional digitization before the system could be used.
The present eight-week overall setting is a demonstration fallback trigger, not proof of enough training history; the current product-level boosted threshold is 100 nonzero daily observations. The completed system will state and justify its final eligibility rule and review stockouts, missing dates, and data provenance.
Before accepting partner files, the team will obtain permission, agree which records may be used and how long they will be retained, and limit collected fields to those needed for the study. Identifying customer information will be removed from research copies where possible. The completed backend must provide appropriate access and a tested backup or export and recovery procedure before real business data are entrusted to it.
Data Preprocessing
Before model development, the collected historical sales data will undergo preprocessing to ensure that the dataset is suitable for forecasting.
The preprocessing procedure will include:
Data Cleaning – identifying missing, duplicated, or invalid records.
Data Organization – arranging sales records chronologically according to their transaction dates.
Data Aggregation – grouping sales transactions according to the selected time interval, such as daily or weekly sales.
Missing Value Handling – identifying missing observations and applying an appropriate treatment based on the characteristics of the dataset.
Product Selection – selecting the products that contain sufficient historical sales information for model development.
Feature Preparation – preparing the historical sales information required by the XGBoost model.
Dataset Splitting – reserving nonoverlapping, date-ordered training, validation, and final test periods; their final dates will be documented before test results are opened.
The preprocessing stage is necessary because the study's forecasting accuracy depends on the length, consistency, and completeness of the available historical sales data.
Interview
An unstructured interview will be conducted with the business owner to determine the current inventory management practices, the typical supplier lead times, and the products that are most affected by overstocking and understocking. The information gathered from the interview will guide the requirements of the system and the configuration of the inventory optimization component.
Partner Details to Confirm
The following decisions will be filled after a business agrees to participate and its records are audited. Dates, counts, software architecture, and performance results are not yet known. The training and test protocol will be recorded before final test outcomes are examined.
Table 4. Partner and Implementation Details Pending Confirmation
	Decision
	Information to enter after confirmation
	Current status

	Partner and permission
	Name, location, permitted records, retention terms, user roles.
	Partner search ongoing.

	Sales and stock history
	Valid date range, product units, missing days, stockouts, nonzero sales days.
	Awaiting real records.

	Forecast test
	Horizon, eligible products, date cutoffs for training, validation, and final test.
	Lock after data audit.

	Replenishment settings
	Lead time, current stock, safety stock, coverage, open orders.
	Validate with partner.

	Backend and data protection
	Database, access rules, export or backup, restore test, deployment device.
	Backend in development.

	Evaluators
	User and technical groups, survey approval, response counts.
	Recruitment pending.


Software Project Schedule
The Gantt chart follows the five Thesis Writing 1 periods in the supplied academic year 2026–2027 timeline. The shaded task rows identify work assigned to each period; the university has not provided separate start and end dates for those tasks.
The approved-title schedule gives November 9, 2026 as the title proposal panel appointment within the finals period. The finals period ends November 22, 2026. These dates concern proposal work and do not establish a completion date for the finished software system.
Chart 1. Thesis Writing 1 Project Schedule Gantt Chart

Note. W1–W18 are weeks beginning July 20, 2026. The darker bars show the five official period dates; pale bars mark only the period assigned to each task. The diamond marks the separate November 9 title proposal panel appointment. Exact task dates and the proposal defense date remain subject to university confirmation.

Hardware and Software Resources
The completed system will build on the existing browser front end. The resources below distinguish current demonstration components from backend and data-persistence work still being implemented. The actual deployment device, backup method, and database platform will be documented after the partner and backend requirements are confirmed.
Hardware
Table 5. Hardware Resources
	Hardware
	Indicative Specification
	Purpose

	Laptop / Desktop
	Modern browser; 8 GB RAM recommended
	Run the system for development, evaluation, and the planned pilot

	Storage
	Browser storage for demonstration; backend storage under development
	Keep real business records only after the final persistence and recovery method is checked

	Printer
	Optional
	Print reports externally if needed

	Internet
	Needed for installation or collaboration
	The locally running app does not require a live supplier feed


Software
Table 6. Software Resources
	Software
	Type
	Use / Completion Work

	Vite / React 19
	Web application
	Browser interface and local development

	TypeScript
	Language
	Forecast, store and inventory logic

	Verified XGBoost model
	Forecasting code
	Primary forecast method to integrate and test; the current custom booster is a development component

	Zustand and localStorage
	Client-side state
	Current browser demonstration state; backend data persistence and recovery are in progress

	TanStack Router
	Routing
	Overview, inventory, restock and forecasting pages

	Recharts / Tailwind CSS
	Interface libraries
	Charts and styling

	VS Code / GitHub
	Development tools
	Source editing and version management

	Backend and business database
	In development
	Authorized business records, access, retention, and tested recovery; final technology to be documented


Data Flow Diagram
Figure 1 is a logical data-flow design for the proposed system. Sales, stock, product settings, data-quality checks, forecasts, and reorder advice are represented whether computation ultimately runs in the browser or the developing backend. D1–D3 are logical stores; their appearance does not mean a production database already exists. The final implementation diagram and stored fields will be checked against the backend and database design once completed.

Figure 1. Data Flow Diagram of the Proposed System
Project Context Diagram
Figure 2 defines the business workflow boundary: the owner supplies product and replenishment settings and reviews advice, while staff may record sales and receipts according to their assigned access. The backend architecture and access rules are in development. Supplier lead time is entered by a user, and the design does not assume an automated supplier integration.

Figure 2. Project Context Diagram
Use Case Diagram
Figure 3 identifies the users and functions within the proposed sales forecasting and inventory application. The owner maintains product information and forecast options, imports historical sales when available, and reviews demand and reorder advice. Sales or inventory staff record transactions and stock receipts and inspect the same operational outputs. The actor labels describe intended work roles; the current browser prototype does not enforce role-based access or provide sign-in.

Figure 3. Use Case Diagram of the Proposed System
The use cases correspond to current browser workflows such as product settings, manual sales, CSV import, forecasts, and receipt entry. In the demonstration, manual sales reduce displayed stock and receipts increase it; importing historical sales adds ledger rows without changing current stock. Role-based access and durable backend storage are still being developed and must be reflected in a revised diagram after implementation.
System Interface Wireframes
Figures 4–8 document the current StockCast browser interface using the team's actual screenshots. The visible products, stock values, forecasts, and error metrics use generated demonstration data. They show implemented screens and sample behavior; they are not measured findings from verified partner business records.

Figure 4. StockCast Overview Dashboard Screen
The overview summarizes stock requiring attention, inventory value, forecast error, and access to the restock queue. Staff can open the sale entry dialog from the main navigation.

Figure 5. StockCast Product and Inventory Screen
The product area displays editable on-hand stock, supplier lead time, safety stock, and cost. Users can add a product or update an existing one.

Figure 6. StockCast Sales Ledger and CSV Import Screen
The sales tab lists dated transactions and accepts CSV rows with Date, Product, and Quantity. The manual sale dialog provides separate product, date, and quantity fields.

Figure 7. StockCast Forecast Evaluation Screen
The forecast view compares moving average, boosted forecasting, and the ensemble. It displays a product-level history and horizon together with data quality and forecast confidence information.

Figure 8. StockCast Restocking Recommendations Screen
The restocking view groups products by urgency and provides a stock-receipt action. The suggested reorder quantity is advice and remains subject to owner review.
Midterm Prototype Demonstration
The current prototype contains an overview, product and sales records, forecast evaluation, and restocking recommendations. The following sequence is a demonstration protocol for the midterm checkpoint. Completion should be recorded only after the application is run and the resulting screen and records are checked. The generated sample data are for workflow demonstration and do not establish forecasting accuracy for a partner business.
Start the local application and confirm that the dashboard loads, displays stock indicators, and opens each navigation page without an error.
In Inventory, add a clearly labeled demonstration product, enter lead time and safety stock, save the product, and confirm that it appears in the catalogue.
Record a sale against an existing demonstration product; check that the new dated sale appears in the ledger and that the product's on-hand quantity decreases.
Import a small, correctly formatted CSV for a matching product and confirm that the accepted rows appear in the sales ledger. Keep the file distinct from real partner records.
Open Forecasts and explain the model comparison, data-quality warning, and fallback for short histories. State clearly when a product was not trained with the boosted method.
Open Restocking, explain the reorder point and suggested quantity, record a stock receipt, and check that the on-hand quantity increases.
Refresh the page and check whether entered records persist in the same browser profile; then repeat critical steps with partner data only after permission, validation, and retention arrangements are confirmed.
Demonstration evidence should include the application version, date, browser, screenshots of completed tasks, and any failures. The screenshots show generated demonstration values. Backend persistence, access rules, real partner integration, and verified XGBoost results will be evidenced separately when those parts are completed.
Survey Results
The survey has not yet been administered. This section records the planned reporting format only; actual responses, respondent counts, and interpretations will be supplied after evaluation.
Table 7 will be populated after a validated XGBoost method and Moving Average baseline have been tested on the same eligible partner products, dates, and forecast horizon. The number of comparable observations and any products restricted to a baseline will be disclosed. Generated demonstration metrics cannot populate this table.
Table 7. Comparison of Forecasting Performance
	Forecasting Model
	MAE
	RMSE

	Moving Average (Baseline)
	Pending evaluation
	Pending evaluation

	XGBoost (after verification)
	Pending evaluation
	Pending evaluation

	Ensemble (XGBoost + Moving Average)
	Pending evaluation
	Pending evaluation


The questionnaire results will be reported by quality characteristic and respondent group using the scale in Table 1. User ratings, technical review, functional checks, and measured response times will be identified as different sources of evidence; they will be collected only after the completed system is used.
Table 8. System Evaluation Results Based on ISO/IEC 25010:2023
	Quality Characteristic
	Weighted Mean
	Verbal Interpretation

	Functional Suitability
	Pending evaluation
	Pending evaluation

	Reliability
	Pending evaluation
	Pending evaluation

	Interaction Capability
	Pending evaluation
	Pending evaluation

	Performance Efficiency
	Pending evaluation
	Pending evaluation

	Maintainability (technical reviewers)
	Pending evaluation
	Pending evaluation


Implementation Plan
After the backend, database design, access rules, data recovery, verified forecasting method, and partner-data tests are completed and the business approves a trial, the system may be introduced in stages:
Phase 1: Pilot Testing — With the partner’s permission, run a controlled trial on approved records. Check import integrity, protected storage and recovery, forecast eligibility, and the arithmetic of reorder alerts before any operational use.
Phase 2: Staff Orientation — The business owner and relevant staff will be given a walkthrough of the dashboard, covering how to interpret demand forecasts, reorder point alerts, and restocking recommendations.
Phase 3: Parallel Monitoring — For an agreed period, the business may keep its existing purchasing process while comparing the dashboard advice with recorded demand, stock, and owner decisions. No reduction in cost or stockouts will be claimed unless those outcomes are measured.
Phase 4: Optional Adoption — The owner may use the dashboard as a decision aid after reviewing pilot results. Forecast errors and data quality will continue to be monitored, and final purchasing decisions remain with the owner.
Appendix A Draft System Evaluation Questionnaire
Draft for adviser review. Respondents will rate only the group of statements relevant to their role after using the completed system. Response options are 1 Strongly disagree, 2 Disagree, 3 Neither agree nor disagree, 4 Agree, and 5 Strongly agree. Record the respondent group and any task failure separately; this form has not yet been administered.
Business owner and staff  Functional suitability
I can record a sale and see the corresponding stock change.
I can review a product’s stock, supplier lead time, and restocking status.
The forecast and reorder pages provide the information I need for a purchasing decision.
Business owner and staff  Reliability
My completed entries remain available after a normal page refresh.
Sales and stock receipts produce the expected inventory changes during the trial.
I can complete routine tasks without an unexpected error or loss of entered information.
Business owner and staff  Interaction capability
I can find the sales, product, forecast, and restock functions without help.
The system clearly distinguishes a boosted forecast from a simple fallback.
I understand the stock alert and suggested quantity shown for a product.
Business owner and staff  Performance efficiency
The dashboard opens within an acceptable wait on the intended device.
Saving a sale or stock receipt responds within an acceptable wait.
I can continue routine tasks while forecasts are updated.
Qualified technical evaluators  Maintainability
The implemented modules have clear responsibilities and documented inputs and outputs.
The data and forecasting logic can be changed without altering unrelated functions.
Available documentation and checks help verify that a change has not broken existing functions.
The final instrument will be revised after the partner workflow and backend are complete. These statements measure respondent assessments and do not by themselves certify ISO compliance, forecast accuracy, backup recovery, or security.
1
