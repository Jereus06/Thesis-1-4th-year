export type ThesisSection = {
  id: string;
  heading: string;
  placement: string;
  paragraphs: string[];
  bullets?: string[];
  formula?: string;
};

export const THESIS_INTRO_NOTE =
  "Implementation-aligned Chapter 3 text, revised 5 October 2026. Use this copy/Markdown for the current Python system; record research findings only from the cited dataset, measured installation, and collected client responses.";

export const THESIS_SECTIONS: ThesisSection[] = [
  {
    id: "rationale",
    heading: "Two Complementary Strategies for Small-Data Forecasting Systems",
    placement: "Chapter 3: after Model Training and Testing",
    paragraphs: [
      "StockCast implements two complementary strategies: safeguards for forecasting evidence and an architecture for responsive operation. The normal application uses a Python/FastAPI API, an independent Python worker running official XGBoost, and PostgreSQL records. The optional custom TypeScript browser demonstration is separate from this runtime.",
      "Authorized partner records may support forecasting evaluation. If confidentiality or unavailable records prevent their use, a reliable, permitted public retail dataset may be used with its source, units, completeness, and limitations documented. Public-data results describe that source; synthetic fixtures do not constitute empirical client evidence. Client feedback is collected separately from the participating owner/manager and staff.",
    ],
  },
  {
    id: "strategy1",
    heading: "Strategy 1: Five Levels of Accuracy and Reliability",
    placement: "Forecasting safeguards",
    paragraphs: [
      "The five levels address input quality, past-only features, constrained model selection, validation-based ensembles, and qualified uncertainty. Their implementation supports fair evaluation; lower forecast error or business benefits must still be demonstrated with appropriate records.",
    ],
  },
  {
    id: "level1",
    heading: "Level 1 — Data-Level Safeguards",
    placement: "Strategy 1, Level 1",
    paragraphs: [
      "Transactions are aggregated by product/day. Only observed sales and effective confirmed-zero reviews become targets. Product-specific classifications override store-wide reviews. Closures, incomplete records, stockouts, and unclassified absent days are excluded rather than filled with zero. Reviews retain supporting notes and immutable audit history. Positive sales that contradict a zero review retain the observed quantity with a warning.",
      "Refresh freezes targets, provenance, reviews, settings, product scope, and business-day bounds. Default XGBoost gates require a complete daily training sequence, at least eight weeks, and at least 100 nonzero days. Eight weeks alone cannot satisfy the latter gate. Eligible products are ranked using training-period volume only, with a default limit of eight. These are disclosed implementation settings, not universal statistical minima.",
      "The Python path remains daily and does not silently aggregate to weeks or substitute generated demand. A fallback uses the contiguous usable tail and dates forecasts from the product's own latest usable observation. Missing days do not become adjacent daily lags, and another product's newer history cannot move expired advice forward. Products with no usable or current evidence retain unavailable demand.",
    ],
  },
  {
    id: "level2",
    heading: "Level 2 — Feature-Level Safeguards",
    placement: "Strategy 1, Level 2",
    paragraphs: [
      "The official per-product model uses seven features calculated from preceding quantities and the prediction date. Thirty observations provide warm-up for rolling features. Product and category identifiers are not regressors; the model does not pool category behavior. Unrecorded holiday/promotion proxies and weekly features are not production inputs.",
    ],
    bullets: [
      "Lags: 1, 7, and 14 days.",
      "Rolling means: 7 and 30 preceding days.",
      "Calendar: weekday and month.",
      "Future multi-day prediction is recursive; final-test actuals are not fed into earlier predictions.",
    ],
  },
  {
    id: "level3",
    heading: "Level 3 — Model-Level Safeguards",
    placement: "Strategy 1, Level 3",
    paragraphs: [
      "The worker uses official xgboost.XGBRegressor with one training thread, squared-error loss, seed 42, L2 regularization 1.5, and row/column sampling of 0.9. The compact candidates are depth 3/rate 0.05/300 trees, depth 4/rate 0.05/300 trees, and depth 3/rate 0.10/240 trees.",
      "Default parameter selection uses three explicitly constructed expanding chronological folds wholly within training, each with a 14-day check window and at least 45 initial training days. If all requested folds are infeasible, the conservative first candidate and zero effective folds are recorded. No random shuffle is used. Official-library early stopping uses the earlier method-selection validation segment with a patience of 15 rounds. Saved decisions include parameters, estimator count, requested/effective folds, and fallback.",
      "Training, validation, reserved calibration when available, and untouched final testing remain ordered and separate. Normal Refresh can reserve 100/20/14 days at 134 complete daily observations under default gates. Research dataset cutoffs, horizon, exclusions, and eligible products are recorded before interpreting final-test outcomes.",
    ],
  },
  {
    id: "level4",
    heading: "Level 4 — Ensemble-Level Safeguards",
    placement: "Strategy 1, Level 4",
    paragraphs: [
      "The ensemble weights are inversely proportional to Moving Average and XGBoost MAE on the earlier method-selection validation segment. The operating method minimizes validation MAE among the baseline, XGBoost, and ensemble. It is fixed before final testing; a final-test winner does not determine future model choice.",
      "All compared methods predict common final-test dates recursively from the same pre-test cutoff. Dashboard aggregate comparisons use matching eligible products and observations; fallback-only products are identified separately. If a fallback has no usable history at the validation cutoff, its test metrics are unavailable rather than manufactured from an empty-history zero forecast.",
    ],
    formula:
      "w_XGB = (1 / max(MAE_XGB, 1e-9)) / ((1 / max(MAE_XGB, 1e-9)) + (1 / max(MAE_MA, 1e-9))); w_MA = 1 - w_XGB",
  },
  {
    id: "level5",
    heading: "Level 5 — Uncertainty-Level Safeguards",
    placement: "Strategy 1, Level 5",
    paragraphs: [
      "When validation has at least 20 usable observations, its later segment reserves at least ten observations for calibration after method selection. The selected method's 10th and 90th residual quantiles give nominal 80% bounds, clipped at zero. Calibration dates/count, residual offsets, and separately measured untouched final-test coverage are saved and displayed.",
      "Small time-ordered samples and subsequent operational refits do not guarantee future coverage. Products without sufficient calibration evidence show unavailable intervals. Quality labels describe usable, unknown, and excluded history, not a probability of correctness. Browser demonstration bands remain illustrative. Purchasing decisions remain the owner's.",
    ],
  },
  {
    id: "strategy2",
    heading: "Strategy 2: Five Techniques of Speed and Architecture",
    placement: "Separate execution and measured responsiveness",
    paragraphs: [
      "The five techniques separate training from interactive requests, persist results, prioritize eligible products, bound validation cost, and execute queued work independently. Responsiveness is measured on the stated installation, including during confirmed worker activity.",
    ],
  },
  {
    id: "tech1",
    heading: "Technique 1 — Separate Training from Serving",
    placement: "Strategy 2, Technique 1",
    paragraphs: [
      "Dashboard/API reads use saved results or a conservative Python baseline; they do not fit XGBoost. Explicit Refresh queues an immutable run for the separate worker. Offline training means computation outside the dashboard request, not a fixed daily 06:00 retraining schedule.",
    ],
  },
  {
    id: "tech2",
    heading: "Technique 2 — Persist Results",
    placement: "Strategy 2, Technique 2",
    paragraphs: [
      "PostgreSQL stores forecast inputs, predictions, errors, model decisions, interval evidence, and timings. Official model JSON files use a persistent volume. New sales, product/settings changes, and reviewed-day audit revisions make saved results stale. Previous completed evidence remains archived. Dates are not shifted to today, and current advice excludes expired predictions.",
      "Saved baselines from an older calendar policy require Refresh and are not served as current evidence. Ordinary container recreation retains database/model volumes. Database dumps, isolated restoration, and restart checks verify recovery on the tested installation.",
    ],
  },
  {
    id: "tech3",
    heading: "Technique 3 — Prioritize Eligible Products",
    placement: "Strategy 2, Technique 3",
    paragraphs: [
      "Training-only history/completeness and nonzero-day gates are checked before volume ranking. The configurable top-N limit defaults to eight eligible products. Products outside the ML budget remain in inventory and receive a disclosed baseline when usable history exists. Their exclusion does not consume an ML slot or erase their records.",
    ],
  },
  {
    id: "tech4",
    heading: "Technique 4 — Bound Cross-Validation Cost",
    placement: "Strategy 2, Technique 4",
    paragraphs: [
      "The compact three-candidate grid and default three chronological training folds bound the fit count. Requested and effective folds are recorded. Insufficient history triggers a conservative documented selection fallback; final-test errors are not substituted for validation. Every actual fit, including calibration and operational refits, contributes to measured training time.",
    ],
  },
  {
    id: "tech5",
    heading: "Technique 5 — Execute Asynchronously and Measure",
    placement: "Strategy 2, Technique 5",
    paragraphs: [
      "The worker continuously polls queued runs while its service is active. Advisory locks identify interrupted work, and result/status publication prevents a partially completed job from appearing completed. Failed/interrupted publication discards partial results. The UI reports queued, running, failed, stale, and expired evidence as applicable.",
      "Disjoint saved phases measure preparation, training, validation, evaluation, and persistence. Processing total ends after the result transaction commit; queue wait and final timing/status publication are excluded. Unperformed phases remain null. Authenticated API raw samples and actual-browser task/paint measurements separately assess responsiveness; targets are not measurements and synthetic reports are not client findings.",
    ],
  },
  {
    id: "interaction",
    heading: "How the Two Strategies Interact",
    placement: "Connecting the strategies",
    paragraphs: [
      "Eligibility and training-only ranking serve both statistical and compute safeguards. Chronological folds preserve ordering while bounding cost. These shared choices do not establish lower errors or faster response by themselves; each strategy is assessed through its corresponding observations.",
    ],
  },
  {
    id: "evaluation",
    heading: "Implications for Evaluation",
    placement: "Forecast, inventory, client, and engineering evidence",
    paragraphs: [
      "Report MAE/RMSE on common product-date-origin-horizon observations, with dataset provenance, cutoffs, exclusions, and fallback-only products. Public retail benchmarks cannot establish client accuracy or business benefit. Generated demonstration metrics cannot populate empirical forecast-result tables.",
      "Inventory advice uses ROP = D × L + SS and S = D × (L + C) + SS. When on-hand stock H is at or below ROP, Q = max(0, ceil(S - H)); otherwise Q = 0. Unknown or expired demand remains unavailable. Open purchase orders and backorders are not tracked in this basic on-hand rule.",
      "Client survey respondents are the business owner/manager and staff. Twelve versioned statements cover functional suitability, reliability, interaction capability, and perceived performance efficiency on a 1–5 agreement scale. Unanswered and Not applicable entries are excluded; valid rated item responses have equal weight with explicit participant and response denominators. Drafts stay local; final authenticated submissions are immutable PostgreSQL records with owner-only business summaries/CSV. Maintainability and measured performance use separate engineering evidence. Questionnaire approval and actual collected findings remain research activities.",
    ],
  },
];

export function thesisAsPlainText(): string {
  const lines: string[] = [
    "Sales Forecasting and Inventory Optimization for Small Retail Businesses Using XGBoost Algorithm",
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
