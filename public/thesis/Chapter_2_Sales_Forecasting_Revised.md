# CHAPTER II

# REVIEW OF RELATED LITERATURE

This chapter presents the related literature and studies used to establish the theoretical and empirical foundation for developing a sales forecasting and inventory optimization system for small retail businesses. It also presents the synthesis, theoretical framework, and conceptual framework that guide the study.

## Related Literature and Studies

### XGBoost for Sales and Demand Forecasting

Extreme Gradient Boosting (XGBoost) is an ensemble learning method that builds decision trees sequentially, where each subsequent tree reduces errors from prior trees. This structure makes it suitable for nonlinear relationships in structured tabular data (Retail Sales Forecasting Using Tree-Based Machine Learning Models, 2025).

Recent studies report competitive XGBoost performance against both classical and machine-learning alternatives. Bai (2024) compared ARIMA and XGBoost in demand forecasting and reported stronger XGBoost performance when nonlinear and multi-factor patterns were present. Fatima and Salam (2025) also reported strong XGBoost results against ARIMA, Prophet, and SVR when contextual variables were included.

Other studies have compared XGBoost with tree-based alternatives such as LightGBM. Findings suggest that relative advantage can depend on the metric and dataset characteristics (Inventory Demand Forecasting Using XGBoost and LightGBM Algorithms, 2025). Related work also indicates that tuned XGBoost can perform well under limited, structured retail data conditions (Optimization of XGBoost Hyperparameters Using Three Dimensional Learning AVOA for Retail Demand Prediction, 2025).

### XGBoost in SME Inventory Contexts

Literature focused on retail SMEs supports XGBoost's relevance to smaller, less voluminous business datasets. A CRISP-DM-based retail SME study found XGBoost among the best-performing models in its tested set (Model to Predict Inventory Demand in Retail SMEs Using CRISP-DM, 2024).

Forecasting literature also emphasizes that predictions become operationally useful only when paired with inventory decision rules (for example, reorder point and safety stock logic) rather than presented as stand-alone model outputs (Optimizing Inventory Management Through Demand Forecasting, 2024).

### Inventory Management Practices in Philippine Small Retail Contexts

Local literature describes sari-sari stores and similar small retailers as economically important but often dependent on manual inventory practices (Balla et al., n.d.). Reported practices include visual checks, memory-based estimates, and handwritten records, which may increase stockout and overstock risk when inconsistently applied.

Some local studies propose inventory-monitoring systems, but predictive forecasting adoption remains limited and uneven. This indicates a gap for practical forecasting-assisted replenishment support tailored to small Philippine retail settings.

## Synthesis

The reviewed literature supports the use of XGBoost as a forecasting approach in retail demand contexts, including SME-like data constraints. At the same time, local studies indicate that many small retailers still rely on manual, non-predictive stock decisions. This study addresses that gap by combining forecasting outputs with concrete reorder calculations in a practical prototype workflow.

## Theoretical Framework

This study is anchored in:

1. **Gradient Boosting Theory** — a strong model can be formed by combining weak learners sequentially, with regularization used to control overfitting.
2. **Inventory Control Theory** — replenishment decisions can be structured through reorder point and safety stock concepts to balance service level and inventory cost.

Together, these foundations support the study's proposition that forecasting-assisted inventory calculations can improve restocking guidance compared with purely intuition-based decisions.

## Conceptual Framework

Using an Input-Process-Output (IPO) perspective:

- **Input**: historical sales data, product data, lead time, safety stock, and coverage settings.
- **Process**: preprocessing, chronological model evaluation (Moving Average, XGBoost-style, and ensemble), and inventory calculation.
- **Output**: demand forecasts, confidence indicators, and reorder recommendations presented in the dashboard.

## References

Bai, Y. (2024). _Machine learning implementation for demand forecasting in supply chain management_. SCITEPRESS.

Balla, S. J., Dalit, D. R., Javillonar, M. E., Orocio, N. L., Ponce, S. T., & Salvatierra, A. S. (n.d.). _Inventory management practices of sari-sari store owners in Vigan City_ [Undergraduate research proposal]. University of Northern Philippines.

Fatima, A., & Salam, M. A. (2025). _A data-driven predictive framework for inventory optimization using context-augmented machine learning models_. arXiv. https://arxiv.org/pdf/2601.05033v1

Ibrahim, A. N., Nada, D. Q., Nurdiansyah, R., & Andoko, A. (2025). Optimization of XGBoost hyperparameters using Three Dimensional Learning AVOA for retail demand prediction. _Jurnal Teknik Industri, 28_(1), 1–12. https://doi.org/10.9744/jti.28.1.1-12

_Inventory demand forecasting using XGBoost and LightGBM algorithms: A case study of Grupo Bimbo_. (2025). Proceedings, SAGE Journals. https://journals.sagepub.com/doi/10.3233/ATDE250516

_Inventory Management: Different practices of sari-sari stores_. (n.d.). College Sidekick. https://www.collegesidekick.com/study-docs/8300316

_Lived challenges of sari-sari store owners in Noveleta, Cavite_. (n.d.). Multi-Research Journal. https://www.multiresearchjournal.com

_Model to predict inventory demand in retail SMEs using CRISP-DM_. (2024). IEEE INTERCON. https://doi.org/10.1109/INTERCON63140.2024.10833461

_Optimizing inventory management through demand forecasting: A data-driven approach for enhanced supply chain efficiency_. (2024). ResearchGate.

Pajo, P. (2025). _Leveraging technology to address challenges in Philippine sari-sari stores: Opportunities and gaps in SaaS_.

_Retail sales forecasting using tree-based machine learning models: A controlled benchmarking evaluation_. (2025). _Applied Sciences, 16_(15), 7556. https://doi.org/10.3390/app16157556

_Study on automated inventory systems for sari-sari stores (Chapter 1)._ (n.d.). Studocu. https://www.studocu.com/ph/document/muzon-harmony-hills-high-school/yes-in-bs-architect/chapter-1/97476419
