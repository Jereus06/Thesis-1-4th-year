# CHAPTER II
# REVIEW OF RELATED LITERATURE

This chapter reviews the literature and studies that provide the theoretical and empirical foundation for StockCast. It synthesizes evidence on demand forecasting, small-data model behavior, and inventory decision support, then connects those findings to the implemented browser-based system architecture.

## Related Literature and Studies

### XGBoost for Sales and Demand Forecasting

Extreme Gradient Boosting (XGBoost) is a tree-based ensemble algorithm that builds additive models sequentially and is widely used for structured demand-forecasting tasks (Retail Sales Forecasting Using Tree-Based Machine Learning Models, 2025). Prior studies report that XGBoost can model nonlinear interactions effectively and can outperform classical approaches in many forecasting settings.

Bai (2024) compared ARIMA and XGBoost in supply-chain forecasting and found strong performance from XGBoost when nonlinear effects were present. Fatima and Salam (2025) compared XGBoost with ARIMA, Prophet, and SVR and reported competitive to superior accuracy under their tested conditions.

Studies comparing tree ensembles also report that XGBoost can perform strongly under retail demand scenarios, though metric-level differences can vary by dataset and evaluation criterion (Inventory Demand Forecasting Using XGBoost and LightGBM Algorithms, 2025).

### XGBoost in SME Inventory Contexts

Literature focused on small and medium retail enterprises supports the use of XGBoost where data are limited but still structured. A CRISP-DM-based SME study reported XGBoost as the best-fitting model among tested alternatives for inventory demand prediction (Model to Predict Inventory Demand in Retail SMEs Using CRISP-DM, 2024).

Inventory research also emphasizes that forecasting becomes operationally useful only when connected to concrete replenishment rules such as reorder points and safety stock policies (Optimizing Inventory Management Through Demand Forecasting, 2024).

### Inventory Management Practices in Philippine SME Retail

Local literature indicates that many small Philippine retailers still rely on manual stock checking, memory-based estimates, and handwritten records (Balla et al., n.d.; Lived Challenges of Sari-Sari Store Owners in Noveleta, Cavite, n.d.). These practices are associated with recurring stockouts, overstocking, and inconsistent restocking outcomes (Secretario & Naval, as cited in Inventory Management: Different Practices of Sari-Sari Stores, n.d.).

Existing local technology interventions are often focused on basic inventory tracking. Fewer works document integrated predictive forecasting plus replenishment recommendation for this segment, indicating a practical research gap addressed by this study.

## Synthesis

The reviewed literature supports three design decisions implemented in StockCast:

1. using XGBoost as the primary machine-learning forecasting method while retaining a statistical baseline;
2. evaluating forecasts with transparent error metrics and chronological validation;
3. translating forecast output into explicit reorder decisions using inventory formulas.

The synthesis also supports the system's small-data safeguards: controlled model complexity, baseline comparison, confidence signaling, and fallback behavior.

## Theoretical Framework

This study is anchored on:

- **Gradient Boosting Theory**, which supports additive weak-learner modeling with regularization for structured prediction tasks (Retail Sales Forecasting Using Tree-Based Machine Learning Models, 2025);
- **Inventory Control Theory** (including reorder-point and safety-stock principles), which provides the decision framework for when and how much to replenish (Silver et al., as cited in Optimizing Inventory Management Through Demand Forecasting, 2024).

These theories jointly support the system proposition that combining demand forecasting and replenishment logic improves decision quality relative to intuition-only practices.

## Conceptual Framework

The study uses an Input-Process-Output (IPO) framing.

- **Input**: historical sales records, product catalog details, lead times, and safety stock settings.
- **Process**: data preparation, in-browser forecasting (Moving Average and XGBoost-style modeling), comparative evaluation, and inventory computation.
- **Output**: forecast summaries, confidence indicators, and actionable reorder recommendations shown in the web dashboard.

For implementation clarity, the system is organized into a presentation layer, a client-side system processing layer, and a client-side persistence layer (browser storage). This architecture is complete for the study scope and supports deployable static web operation.

## References

Bai, Y. (2024). *Machine learning implementation for demand forecasting in supply chain management*. SCITEPRESS.

Balla, S. J., Dalit, D. R., Javillonar, M. E., Orocio, N. L., Ponce, S. T., & Salvatierra, A. S. (n.d.). *Inventory management practices of sari-sari store owners in Vigan City* [Undergraduate research proposal]. University of Northern Philippines.

Fatima, A., & Salam, M. A. (2025). *A data-driven predictive framework for inventory optimization using context-augmented machine learning models*. arXiv. https://arxiv.org/pdf/2601.05033v1

Ibrahim, A. N., Nada, D. Q., Nurdiansyah, R., & Andoko, A. (2025). Optimization of XGBoost hyperparameters using Three Dimensional Learning AVOA for retail demand prediction. *Jurnal Teknik Industri, 28*(1), 1–12. https://doi.org/10.9744/jti.28.1.1-12

Inventory demand forecasting using XGBoost and LightGBM algorithms: A case study of Grupo Bimbo. (2025). *Proceedings, SAGE Journals*. https://journals.sagepub.com/doi/10.3233/ATDE250516

Inventory Management: Different practices of sari-sari stores. (n.d.). College Sidekick. https://www.collegesidekick.com/study-docs/8300316

Lived challenges of sari-sari store owners in Noveleta, Cavite. (n.d.). Multi-Research Journal. https://www.multiresearchjournal.com

Model to predict inventory demand in retail SMEs using CRISP-DM. (2024). IEEE INTERCON. https://doi.org/10.1109/INTERCON63140.2024.10833461

Optimizing inventory management through demand forecasting: A data-driven approach for enhanced supply chain efficiency. (2024). ResearchGate.

Pajo, P. (2025). *Leveraging technology to address challenges in Philippine sari-sari stores: Opportunities and gaps in SaaS*.

Retail sales forecasting using tree-based machine learning models: A controlled benchmarking evaluation. (2025). *Applied Sciences, 16*(15), 7556. https://doi.org/10.3390/app16157556

Study on automated inventory systems for sari-sari stores (Chapter 1). (n.d.). Studocu. https://www.studocu.com/ph/document/muzon-harmony-hills-high-school/yes-in-bs-architect/chapter-1/97476419
