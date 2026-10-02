export const LEVELS = [
  {
    id: 1,
    title: "Data-level fixes",
    purpose: "Make the history usable before any model is trained.",
    bullets: [
      "Minimum 8 weeks of sales; 6–12 months marked as the reliable range",
      "Daily series aggregated to weekly when more than 30% of days have zero sales",
      "ML training limited to top-N products with at least 100 non-zero observations",
      "Public retail fallback dataset if partner history is shorter than the minimum",
    ],
  },
  {
    id: 2,
    title: "Feature-level fixes",
    purpose: "Use fewer, better features so a small dataset cannot overfit IDs.",
    bullets: [
      "Lags 1 / 7 / 14, rolling means 7 and 30, day of week, month, product category",
      "No high-cardinality product IDs — category is a shared numeric index",
      "Holiday and promotion flags when the calendar supports them",
    ],
  },
  {
    id: 3,
    title: "Model-level fixes",
    purpose: "Keep XGBoost conservative on SME-sized history.",
    bullets: [
      "max_depth 3–4, learning_rate 0.05–0.1, n_estimators 100–300",
      "Early stopping on a chronological validation slice",
      "TimeSeriesSplit with 3 rotating folds, then a final holdout",
      "No random shuffling of time-ordered rows",
    ],
  },
  {
    id: 4,
    title: "Ensemble-level fixes",
    purpose: "Do not assume XGBoost always wins.",
    bullets: [
      "Weighted average of XGBoost and Moving Average from validation MAE",
      "Fallback to Moving Average when XGBoost is unstable on a SKU",
      "Report whichever of MA, XGBoost, or the ensemble has lower holdout error",
    ],
  },
  {
    id: 5,
    title: "Uncertainty-level fixes",
    purpose: "Show how much the forecast can be trusted.",
    bullets: [
      "Confidence score from the number of non-zero observations",
      "Products with fewer than 30 observations flagged as low confidence",
      "Prediction intervals at the 10th, 50th, and 90th percentiles",
      "On-screen disclaimer: decision support only, not a guarantee",
    ],
  },
] as const;

export const TECHNIQUES = [
  {
    id: 1,
    title: "Separate training from serving",
    purpose: "The dashboard never fits trees in the request that paints the screen.",
    bullets: [
      "Training is an offline / on-demand job",
      "Serving only reads cached forecasts and reorder numbers",
      "Two triggers, two timeframes",
    ],
  },
  {
    id: 2,
    title: "Pre-train and cache",
    purpose: "Load milliseconds, not a training loop.",
    bullets: [
      "Fit once, keep persisted forecast artifacts in the cache",
      "Dashboard hydrates from the last successful run",
      "Never retrain as a side effect of opening a page",
    ],
  },
  {
    id: 3,
    title: "Train only on top N products",
    purpose: "Spend compute where volume (and cash) actually sit.",
    bullets: [
      "Default top 8 SKUs by units sold (configurable toward 20–50)",
      "Slow movers use a simple reorder rule, not boosting",
    ],
  },
  {
    id: 4,
    title: "Reduce CV folds",
    purpose: "Three chronological windows are enough on a short series.",
    bullets: [
      "TimeSeriesSplit n_splits = 3 instead of 5",
      "Keeps validation honest without a long wait",
    ],
  },
  {
    id: 5,
    title: "Train asynchronously",
    purpose: "The owner never stares at a spinner for boosting.",
    bullets: [
      "Cached (or Moving Average) numbers appear immediately",
      "XGBoost trains in the background",
      "The next view picks up the updated cache",
    ],
  },
] as const;
