export const MIN_WEEKS = 8;
export const RELIABLE_MONTHS_MIN = 6;
export const RELIABLE_MONTHS_MAX = 12;
export const SPARSE_ZERO_SHARE = 0.3;
export const MIN_NONZERO_FOR_ML = 100;
export const LOW_CONFIDENCE_OBS = 30;
export const TOP_N_DEFAULT = 8;
export const CV_FOLDS = 3;
export const DISCLAIMER =
  "Forecasts are decision-support only, not guarantees. Final purchasing decisions remain the owner's.";

export const XGB_UNSTABLE_RATIO = 1.75;

export function modelLabel(method: "xgb" | "ma" | "ensemble" | "rule"): string {
  switch (method) {
    case "xgb":
      return "XGBoost";
    case "ma":
      return "Moving Average";
    case "ensemble":
      return "Ensemble";
    case "rule":
      return "Reorder rule";
  }
}

export function confidenceLabel(level: "high" | "medium" | "low"): string {
  switch (level) {
    case "high":
      return "High confidence";
    case "medium":
      return "Medium confidence";
    case "low":
      return "Low confidence";
  }
}
