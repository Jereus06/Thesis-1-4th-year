# Thesis Chapter 2

> Current text mirror of `Chapter_2.docx`, supplied by the project owner on 2026-09-24. This Markdown file is intended for Codex/developer context and source-text searching. Word-specific layout, embedded figures, and pagination may not be reproduced here; preserve the original DOCX for formal submission.

CHAPTER II
REVIEW OF RELATED LITERATURE
This chapter reviews evidence on demand forecasting, small-retail record keeping, and reorder decisions. The reviewed studies motivate a verified XGBoost implementation, a simple Moving Average comparator, and transparent restocking rules. Their results cannot be treated as evidence for the partner business, which has not yet been selected; the study will test its claims on dated records when permission and a sufficient history are available.
Related Literatures and Studies
XGBoost for Sales and Demand Forecasting
XGBoost is a regularized tree-boosting method that adds trees sequentially to improve a prediction objective; its original system design addresses sparse inputs and efficient training (Chen & Guestrin, 2016). A retail benchmarking study shows that preprocessing choices and feature availability affect the performance of tree-based models (Albassam et al., 2026). These findings justify testing XGBoost on dated retail records, but they do not establish that it will outperform a simple baseline on every product in a small business.
Bai (2024) compared ARIMA and XGBoost in a retail supply-chain forecasting study and discussed their different strengths for temporal structure and nonlinear relationships. Fatima and Salam (2026) compared XGBoost, ARIMA, Prophet, and Support Vector Regression for retail and vending-machine demand; XGBoost reported the lowest MAE in their setting when contextual variables were included. Their reported rankings depend on the records and available predictors, so the present study will use its partner's verified data and a common chronological test period rather than transfer those results to a new store.
Nguyen et al. (2025) compared XGBoost with LightGBM on the large Grupo Bimbo Inventory Demand dataset. XGBoost had the better MAE and R-squared value, while LightGBM had the better RMSLE; their dataset contains tens of millions of records and therefore is not evidence that a single small retailer has adequate product history. Ibrahim et al. (2026) evaluated a tuned XGBoost model on 990 publicly available FMCG inventory records. Together, these studies motivate comparison, careful feature preparation, and cautious tuning. Neither establishes how many usable, dated sales observations the proposed partner will have per product.
XGBoost in Small and Medium Enterprise (SME) Inventory Contexts
Torres et al. (2024) used the CRISP-DM process to compare Random Forest, LSTM, XGBoost, and Decision Tree methods using 16,071 records from a Peruvian retail SME. XGBoost best fit their records, with an R-squared value reported as 0.82. This provides a relevant small-business example, but the total record count does not reveal whether each product in the present study will have enough independent time observations for boosted training. Product eligibility and the Moving Average fallback will therefore be stated before final testing.
A demand forecast becomes actionable only when combined with reliable information about stock and replenishment. King (2011) explains safety stock as protection against stockouts arising from uncertain demand and lead time, with a trade-off between service level and inventory held. The present system will use forecast daily demand, supplier lead time, and a business-specified safety-stock buffer to signal a reorder and estimate a target stock level. It will report this as inventory decision support; it cannot claim to minimize total inventory cost without cost measurements or a tested cost objective.
Inventory Management Practices Among Philippine Small and Medium Retail Businesses
Philippine research gives a more specific picture of micro-retail operations than broad claims about every small business. In a qualitative case study in Catanduanes, Custodio (2017) found that store inventory levels were influenced by cash and product availability, and withdrawals for personal use were not always recorded. Interviews with ten sari-sari store owners in Noveleta, Cavite found manual lists, visual checks, and experience-based decisions, together with shortages and slow-moving products (Pallera et al., 2026). The two studies concern particular places and participants; their findings guide questions for the partner interview rather than establish that the selected business has the same practices.
These local findings support examining how the partner records sales, stock receipts, stockouts, and lead times before designing a forecasting workflow. A system that predicts demand without dependable dated sales or stock counts can produce misleading reorder advice. The partner interview and data audit will establish what is actually recorded, whether missing sales represent zero demand or missing transactions, and which products can be evaluated. The literature does not establish that XGBoost has already improved the selected business's inventory outcomes; that is a proposition to test in this study.
Table 1 summarizes how selected sources inform the proposed study and where their results cannot answer a question about the future partner.
Table 1. Comparison of Literature Relevant to the Proposed System
	Source
	Relevant evidence
	Question retained for this study

	Chen & Guestrin (2016)
	Defines the XGBoost method and its system design.
	Verify the actual model implementation and document settings before claiming XGBoost results.

	Torres et al. (2024)
	Reports an XGBoost result for one Peruvian retail SME.
	Test on the partner’s own products; record counts from another store do not prove product-level eligibility.

	Nguyen et al. (2025); Fatima & Salam (2026)
	Compare forecasting methods in other retail or vending data settings.
	Use a common date period and a simple baseline; do not transfer reported model rankings.

	Custodio (2017); Pallera et al. (2026)
	Describe record-keeping and stock decisions in particular Philippine micro-retail settings.
	Interview the partner and audit missing sales, withdrawals, stockouts, and stock receipts.

	King (2011)
	Explains the purpose and trade-offs of safety stock.
	Use a stated reorder rule and avoid an unsupported claim of minimum inventory cost.


Synthesis
The reviewed studies support a like-for-like comparison of a verified XGBoost implementation with a Moving Average baseline. Hyndman and Athanasopoulos (2021) explain why forecast accuracy must be measured on observations that were not used to fit or select a model. Accordingly, this study will use preceding training and validation records for feature and model choices and reserve the most recent suitable period for final MAE and RMSE. The current browser demonstration uses generated sales and a custom boosting module; neither provides partner-business accuracy evidence.
The specific research gap for the selected partner is whether its available product-level records can support a verified XGBoost forecast that improves on a simple baseline, and whether those forecasts lead to understandable reorder advice in its actual stock workflow. Existing studies supply reasons to test those questions, while local inventory research identifies data-quality questions to investigate. A small or sparse partner dataset may leave some products eligible only for a baseline; that finding will be reported rather than concealed. The team will document the backend and record-retention design when their implementation is complete.
Theoretical Framework
The forecasting framework draws on regularized gradient tree boosting (Chen & Guestrin, 2016). Candidate sales lags, rolling summaries, and calendar variables will use only information known when the forecast is produced. A chronological validation period will guide model choices and a later untouched test period will estimate performance on unseen dates (Hyndman & Athanasopoulos, 2021). The exact forecast horizon and feasible split dates will be recorded after the partner-data audit and before the test is opened.
The inventory component draws on safety-stock principles that account for uncertain demand and replenishment (King, 2011). The proposed system will combine a forecast of daily demand with business-supplied lead time, current stock, safety stock, and coverage days to produce a reorder alert and an order-up-to suggestion. It is a decision-support rule. Without measured purchase, holding, and shortage costs, the study will not claim an economically optimal order quantity.
Together these concepts guide the two proposed implementation strategies. Strategy 1 specifies data sufficiency, validation, uncertainty warnings, and baseline fallback. Strategy 2 specifies reuse of valid forecasts and measured dashboard responsiveness. Both remain design requirements until they are implemented and evaluated with the partner business.


Software Quality Framework
ISO/IEC 25010:2023 defines a software product quality model (International Organization for Standardization & International Electrotechnical Commission, 2023). The study will assess five selected characteristics. Business users will assess tasks they actually perform, while qualified technical evaluators will review maintainability and other technical aspects. Survey ratings will describe respondents’ perceptions; task checks, forecast errors, and response-time measurements will provide separate evidence of system behavior.
Conceptual Framework
Figure 1 presents the study's Input-Process-Output framework. Dated sales and product records, stock on hand, lead time, safety stock, and coverage days enter the proposed system. The process checks data quality, compares an eligible XGBoost forecast with the Moving Average baseline, and calculates reorder advice. The outputs are forecasts, stock status, data-quality warnings, and suggested replenishment quantities for review by the owner or staff.

Figure 1. Input-Process-Output Conceptual Framework
The framework describes the proposed workflow rather than completed outcomes. The client and real records are still pending, and backend integration is underway. Model eligibility, the forecast horizon, and the training, validation, and test cutoffs will be documented after the partner-data audit. Generated demonstrations will remain separate, and products with sparse records will display a named baseline or manual rule instead of an unsupported XGBoost result.
References
Albassam, S., Alqahtani, A., & Alazba, A. (2026). Retail sales forecasting using tree-based machine learning models: An empirical study of preprocessing configurations and feature ablation. Applied Sciences, 16(15), 7556. https://doi.org/10.3390/app16157556
Bai, Y. (2024). Machine learning implementation for demand forecasting in supply chain management. In Proceedings of the 1st International Conference on E-commerce and Artificial Intelligence (pp. 77–84). SciTePress. https://www.scitepress.org/PublishedPapers/2024/132069/
Chen, T., & Guestrin, C. (2016). XGBoost: A scalable tree boosting system. In Proceedings of the 22nd ACM SIGKDD International Conference on Knowledge Discovery and Data Mining (pp. 785–794). https://doi.org/10.1145/2939672.2939785
Custodio, L. P. (2017). Qualitative case study of micro-retail (sari-sari) stores in Catanduanes Island, Luzon, Philippines. Asia Pacific Journal of Island Sustainability, 29(2). https://ejournals.ph/article.php?id=14871
Fatima, A., & Salam, M. A. (2026). A data-driven predictive framework for inventory optimization using context-augmented machine learning models [Preprint]. arXiv. https://arxiv.org/abs/2601.05033
Hyndman, R. J., & Athanasopoulos, G. (2021). Forecasting: principles and practice (3rd ed.). OTexts. https://otexts.com/fpp3/
Ibrahim, A. N., Nada, D. Q., Nurdiansyah, R., & Andoko, A. (2026). Optimization of XGBoost hyperparameters using three-dimensional learning AVOA for retail demand prediction. Jurnal Teknik Industri, 28(1), 1–12. https://doi.org/10.9744/jti.28.1.1-12
International Organization for Standardization & International Electrotechnical Commission. (2023). Systems and software engineering — Systems and software Quality Requirements and Evaluation (SQuaRE) — Product quality model (ISO/IEC 25010:2023). https://www.iso.org/standard/78176.html
King, P. L. (2011). Understanding safety stock and mastering its equations. APICS Magazine, July/August, 33–36. https://web.mit.edu/2.810/www/files/readings/King_SafetyStock.pdf
Nguyen, N. P. T., Dang, T. T., & Le, D. D. (2025). Inventory demand forecasting using XGBoost and LightGBM algorithms: A case study of Grupo Bimbo. In Management Science and Industrial Engineering: Proceedings of the 7th International Conference (MSIE 2025). https://doi.org/10.3233/ATDE250516
Pallera, A. C. E., Amagan, R., Carable, C. J. L., Lacabe, P. K. C. E., Ronquillo, R. A., & Gutierrez, P. C. (2026). Sa Likod ng Tindahan: The lived challenges of sari-sari store owners in managing daily inventory in Noveleta, Cavite. International Journal of Advanced Multidisciplinary Research and Studies, 6(2), 1153–1162. https://doi.org/10.62225/2583049X.2026.6.2.6079
Torres, J., Carpio, D., & Parasi, V. (2024). Model to predict inventory demand in retail SMEs using CRISP-DM and machine learning. In 2024 IEEE 31st International Conference on Electronics, Electrical Engineering and Computing (INTERCON). https://doi.org/10.1109/INTERCON63140.2024.10833461
