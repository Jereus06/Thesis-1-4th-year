export type ThesisSection = {
  id: string;
  heading: string;
  placement: string;
  paragraphs: string[];
  bullets?: string[];
  formula?: string;
};

export const THESIS_INTRO_NOTE =
  "Suggested placement: insert as a new section in Chapter 3 (Methodology) after “Model Training and Testing,” replacing the shorter “Safeguards for Small Datasets” subsection. Also revise the XGBoost feature list so that individual product identifiers are not used as model inputs.";

export const THESIS_SECTIONS: ThesisSection[] = [
  {
    id: "rationale",
    heading: "Two Complementary Strategies for Small-Data Forecasting Systems",
    placement: "New section after Model Training and Testing / replacing Safeguards for Small Datasets",
    paragraphs: [
      "The partner setting of this study is a small to medium retail business whose sales history is short, irregular, and uneven across products. Under those conditions, two failures are equally damaging. The first is a statistically weak forecast that the owner cannot trust. The second is a technically correct model that takes so long to train that the dashboard is unusable during opening hours. These are different failure modes, and they require different remedies.",
      "This study therefore implements two separate strategies rather than a single undifferentiated list of “improvements.” Strategy 1 (the five levels) exists to make forecasts more accurate and more trustworthy when data are small. Strategy 2 (the five techniques) exists to keep training off the interactive path so the dashboard remains fast. Strategy 1 does not claim to reduce waiting time. Strategy 2 does not claim to repair a thin time series. Treating them as one bundle would conceal which design decisions protect validity and which protect usability — a distinction that matters both for implementation and for the ISO/IEC 25010:2023 evaluation of reliability versus performance efficiency.",
      "The two strategies are complementary. A reliable model that cannot be served in time is not a decision-support system. A fast dashboard that presents overfitted or un-flagged numbers is not trustworthy. The system therefore applies both, independently, on every forecast run.",
    ],
  },
  {
    id: "strategy1",
    heading: "Strategy 1: Five Levels of Accuracy and Reliability",
    placement: "Replaces “Safeguards for Small Datasets”",
    paragraphs: [
      "Strategy 1 is organized as five successive levels. Each level addresses a different source of error that appears when sales history is short or sparse. The levels are applied in order: data are made usable before features are built; features are constrained before a model is fit; the model is regularized before it is combined with a baseline; and every product forecast is finally accompanied by an explicit statement of uncertainty.",
    ],
  },
  {
    id: "level1",
    heading: "Level 1 — Data-Level Fixes",
    placement: "Strategy 1, Level 1",
    paragraphs: [
      "The first level does not involve machine learning. It specifies the minimum history the system is willing to treat as a modeling problem, and it changes the grain of the series when daily data are too sparse to be informative.",
      "A product catalog is accepted for forecasting only when the available sales window covers at least eight weeks. Six to twelve months of history is treated as the reliable range for the kinds of short-horizon forecasts this study produces. History shorter than the eight-week floor is not forced through XGBoost. If the partner extract is thinner than that floor, the system substitutes a public-style retail fallback series of comparable length so that model development and interface testing can continue, and it records that substitution in the run diagnostics so the result is not presented as a partner-data finding.",
      "Daily series with more than 30 percent zero-sales days are aggregated to weekly totals before modeling. Aggregation reduces the number of structural zeros that would otherwise dominate a daily loss function and produce near-zero forecasts. Product scope is further reduced to the top N products (default eight, configurable toward 20–50) that also have at least 100 non-zero observations. Slow-moving SKUs remain in the catalog and still receive a reorder quantity, but they are served by a simple moving-average or rule-based demand estimate rather than by boosting. This is a data decision as much as a compute decision: a series that rarely sells does not contain enough events for a tree ensemble to generalize.",
    ],
    bullets: [
      "Minimum history: 8 weeks; reliable range: 6–12 months.",
      "Daily series aggregated to weekly when more than 30% of days have zero sales.",
      "Machine-learning training limited to top-N products with at least 100 non-zero observations.",
      "Public retail fallback dataset used when partner history is below the minimum, with the substitution disclosed.",
    ],
  },
  {
    id: "level2",
    heading: "Level 2 — Feature-Level Fixes",
    placement: "Strategy 1, Level 2; also revises the XGBoost feature list in Chapter 3",
    paragraphs: [
      "On a small dataset, a large feature set is a form of overfitting. High-cardinality identifiers are particularly harmful: an individual product ID lets the model memorize SKU-specific noise that will not repeat. The system therefore uses a short, domain-motivated feature set and does not include product identifiers as inputs.",
      "For daily series the features are lag 1, lag 7, lag 14, a 7-day rolling mean, a 30-day rolling mean, day of week, month, and a numeric product-category index. Holiday and promotion flags are added when the calendar supports them (Philippine regular holidays and a simple payday/weekend promotion proxy). Weekly series use the analogous lags and rolling means in week units. Category is encoded as a shared index so that related products can pool a coarse seasonal effect without granting each SKU its own dummy variable.",
      "This specification revises the earlier methodology note that listed “product identifier” among potential inputs. Product identity is retained in the database and on the dashboard; it is not a regressor.",
    ],
    bullets: [
      "lags: 1, 7, 14 (or 1w, 2w, 4w when the grain is weekly)",
      "rolling means: 7 and 30 days (or 4w and 8w)",
      "calendar: day of week or week of year, month",
      "product category index (not product ID)",
      "holiday flag and promotion flag when available",
    ],
  },
  {
    id: "level3",
    heading: "Level 3 — Model-Level Fixes",
    placement: "Strategy 1, Level 3; expands conservative XGBoost settings",
    paragraphs: [
      "XGBoost is used as a regression model with conservative hyperparameters chosen for small, noisy retail series rather than for large-scale competitions. Maximum tree depth is limited to 3 (within the 3–4 range). The learning rate is 0.05 (within 0.05–0.1). The number of trees is capped at 120 (within 100–300), and training stops early when validation root-mean-squared error fails to improve for ten consecutive rounds. L2 regularization (lambda = 1.5) and a positive gamma further discourage splits that only fit residual noise.",
      "Validation is chronological. The training window is evaluated with TimeSeriesSplit using three rotating folds — not a random shuffle, and not a five-fold split that would starve each fold of events on a short series. After cross-validation, a final holdout consisting of the most recent period is reserved for the published MAE and RMSE comparison. The same holdout is used for Moving Average, XGBoost, and the ensemble so that the comparison is fair.",
    ],
    bullets: [
      "max_depth 3–4; learning_rate 0.05–0.1; n_estimators 100–300 with early stopping.",
      "TimeSeriesSplit with three chronological folds, then a final holdout.",
      "No random shuffling of time-ordered rows.",
    ],
  },
  {
    id: "level4",
    heading: "Level 4 — Ensemble-Level Fixes",
    placement: "Strategy 1, Level 4; new relative to the original Chapter 3 safeguards",
    paragraphs: [
      "The study does not assume that XGBoost will outperform a simple baseline on every SKU. On sparse products, a seven-day moving average is often the more stable predictor. The operational forecast is therefore a weighted average of the XGBoost prediction and the Moving Average prediction, with weights inversely proportional to each model’s validation MAE. A product on which XGBoost is unstable — validation error substantially worse than the baseline, explosive predictions, or too few training rows — falls back entirely to Moving Average.",
      "The dashboard reports whichever of Moving Average, XGBoost, or the ensemble records the lower holdout error for that run. If the machine-learning model does not win, that result is treated as a finding, not as a defect to be hidden. This preserves the original objective of the study: a fair comparison, not a demonstration that boosting is universally superior.",
    ],
    formula: "ŵ_XGB = (1 / MAE_XGB) / (1 / MAE_XGB + 1 / MAE_MA),  ŵ_MA = 1 − ŵ_XGB",
  },
  {
    id: "level5",
    heading: "Level 5 — Uncertainty-Level Fixes",
    placement: "Strategy 1, Level 5",
    paragraphs: [
      "A point forecast without a statement of confidence is easy to over-read. Each product therefore carries a confidence score derived from the number of non-zero observations and from whether the history meets the eight-week floor. Products with fewer than 30 non-zero observations are flagged as low confidence. Charts display a prediction interval using the 10th, 50th, and 90th percentiles of holdout residuals around the operational forecast.",
      "The interface also states, in owner language, that forecasts are decision-support only and not guarantees. Final purchasing decisions remain the owner’s. This disclaimer is part of the methodology, not an afterthought on the user interface: the system is designed to support judgment, which is already listed among the limitations of the study.",
    ],
    bullets: [
      "Confidence score from observation count; < 30 non-zero observations → low confidence.",
      "Prediction intervals at the 10th, 50th, and 90th percentiles.",
      "On-screen disclaimer: forecasts are decision-support only, not guarantees.",
    ],
  },
  {
    id: "strategy2",
    heading: "Strategy 2: Five Techniques of Speed and Architecture",
    placement: "New section in Chapter 3, after Strategy 1 and before Inventory Optimization or the Data Flow Diagram",
    paragraphs: [
      "Strategy 2 is the architectural counterpart of Strategy 1. It answers a different question: how can the owner open the dashboard during business hours without waiting for trees to be fit? The five techniques separate training from serving, persist the last successful run, restrict boosting to high-volume products, keep cross-validation cheap, and run remaining training in the background.",
    ],
  },
  {
    id: "tech1",
    heading: "Technique 1 — Separate Training from Serving",
    placement: "Strategy 2, Technique 1",
    paragraphs: [
      "Training and serving are two processes with two triggers and two timeframes. Training is an offline or on-demand job. Serving is the dashboard request: it reads cached forecasts and reorder quantities and never fits an XGBoost model as a side effect of rendering a page. This split is the primary performance decision. It is also a reliability decision, because a failed training job leaves the last good cache in place rather than blanking the briefing.",
    ],
  },
  {
    id: "tech2",
    heading: "Technique 2 — Pre-Train and Cache",
    placement: "Strategy 2, Technique 2",
    paragraphs: [
      "The model is trained once per data version. The resulting forecasts, per-product errors, ensemble weights, and diagnostics are written to an in-memory cache and to local persistent storage (the browser analogue of joblib/pickle serialization used in a Python training script). Subsequent dashboard loads hydrate from that cache in milliseconds. Retraining is never a side effect of opening Overview, Restock, or Forecasts.",
    ],
  },
  {
    id: "tech3",
    heading: "Technique 3 — Train Only on Top N Products",
    placement: "Strategy 2, Technique 3; consistent with Level 1 scope reduction",
    paragraphs: [
      "Boosting is reserved for the top 20–50 products by sales volume, with a default of eight in the prototype so that training remains interactive on a modest device. Slow-moving products are excluded from the machine-learning job and receive a simple reorder rule based on recent average demand. This reduces wall-clock training time and concentrates statistical effort where most of the cash sits. The exclusion is disclosed per SKU so that the owner can see which recommendations come from the ensemble and which come from the rule.",
    ],
  },
  {
    id: "tech4",
    heading: "Technique 4 — Reduce Cross-Validation Folds",
    placement: "Strategy 2, Technique 4",
    paragraphs: [
      "TimeSeriesSplit is run with three folds rather than five. On a short SME series, five folds produce validation windows that are too small to estimate error stably and multiply the cost of fitting trees. Three chronological windows remain sufficient to detect an unstable configuration before the final holdout is scored. The choice is justified by dataset size, not by a desire to skip validation.",
    ],
  },
  {
    id: "tech5",
    heading: "Technique 5 — Train Asynchronously",
    placement: "Strategy 2, Technique 5",
    paragraphs: [
      "When a cache is missing or stale, the dashboard still paints immediately with the serving-path forecast (Moving Average). XGBoost trains in the background, yielding to the user interface between products. When the job finishes, the cache is replaced and the next view — or the same view, if it is still open — picks up the updated ensemble. The owner never waits on a blocking spinner in order to see restock quantities.",
    ],
  },
  {
    id: "interaction",
    heading: "How the Two Strategies Interact",
    placement: "Closing subsection of the two-strategy section",
    paragraphs: [
      "The strategies share a few surfaces without collapsing into each other. Top-N selection appears in both Level 1 (as a data-quality rule) and Technique 3 (as a compute budget). Three-fold TimeSeriesSplit appears in both Level 3 (as a validity rule) and Technique 4 (as a cost rule). In each case the same number is kept for two reasons, and both reasons are documented.",
      "What they do not share is purpose. Adding more features, deeper trees, or a larger catalog would be a Strategy 1 change and would be evaluated with MAE, RMSE, and confidence flags. Moving training into the request that renders the dashboard would be a Strategy 2 regression and would be evaluated with serving latency and with the ISO/IEC 25010:2023 performance-efficiency rating. The methodology therefore reports them as two strategies, and the prototype exposes them as two tabs, so that examiners, the partner owner, and future researchers can see which decisions belong to accuracy and which belong to architecture.",
    ],
  },
  {
    id: "evaluation",
    heading: "Implications for Evaluation",
    placement: "Ties the two strategies back to MAE/RMSE and ISO/IEC 25010:2023",
    paragraphs: [
      "Forecasting accuracy continues to be reported with Mean Absolute Error and Root Mean Squared Error on the chronological holdout, for Moving Average, XGBoost, and the ensemble. The better model on that holdout is the one with the lower error; XGBoost is not declared the winner in advance.",
      "Strategy 1 additionally requires the system to show confidence flags, prediction intervals, and the decision-support disclaimer. A run that omits those outputs has not implemented Level 5, regardless of MAE. Strategy 2 is evaluated by whether the dashboard serves from cache without invoking training, whether only the top-N SKUs enter the boosting job, and whether a data change retrains in the background rather than blocking the first paint. Those observations map onto the ISO/IEC 25010:2023 characteristics of reliability, performance efficiency, and maintainability used in the system evaluation form.",
    ],
  },
];

export function thesisAsPlainText(): string {
  const lines: string[] = [
    "Sales Forecasting and Inventory Optimization for Small and Medium Retail Businesses Using XGBoost Algorithm",
    "",
    "CHAPTER III — METHODOLOGY (insert)",
    "Two Complementary Strategies for Small-Data Forecasting Systems",
    "",
    THESIS_INTRO_NOTE,
    "",
  ];
  for (const section of THESIS_SECTIONS) {
    lines.push(section.heading);
    lines.push("");
    for (const p of section.paragraphs) {
      lines.push(p);
      lines.push("");
    }
    if (section.formula) {
      lines.push(section.formula);
      lines.push("");
    }
    if (section.bullets?.length) {
      for (const b of section.bullets) lines.push(`• ${b}`);
      lines.push("");
    }
  }
  return lines.join("\n").trim() + "\n";
}

export function thesisAsMarkdown(): string {
  const lines: string[] = [
    "# Two Complementary Strategies for Small-Data Forecasting Systems",
    "",
    "> " + THESIS_INTRO_NOTE,
    "",
  ];
  for (const section of THESIS_SECTIONS) {
    const isTop =
      section.id === "rationale" ||
      section.id === "strategy1" ||
      section.id === "strategy2" ||
      section.id === "interaction" ||
      section.id === "evaluation";
    lines.push(isTop ? `## ${section.heading}` : `### ${section.heading}`);
    lines.push("");
    for (const p of section.paragraphs) {
      lines.push(p);
      lines.push("");
    }
    if (section.formula) {
      lines.push("`" + section.formula + "`");
      lines.push("");
    }
    if (section.bullets?.length) {
      for (const b of section.bullets) lines.push(`- ${b}`);
      lines.push("");
    }
  }
  return lines.join("\n");
}
