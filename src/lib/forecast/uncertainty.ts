import type { ConfidenceLevel, ForecastPoint } from "@/lib/types";
import { LOW_CONFIDENCE_OBS, MIN_NONZERO_FOR_ML } from "./constants";
import { quantile } from "./metrics";

export function confidenceFromObs(
  nonzero: number,
  weeksCovered: number,
  minWeeks: number,
): { level: ConfidenceLevel; score: number } {
  let score: number;
  let level: ConfidenceLevel;
  if (nonzero < LOW_CONFIDENCE_OBS) {
    level = "low";
    score = Math.round((nonzero / LOW_CONFIDENCE_OBS) * 40);
  } else if (nonzero < MIN_NONZERO_FOR_ML) {
    level = "medium";
    score = Math.round(40 + ((nonzero - LOW_CONFIDENCE_OBS) / (MIN_NONZERO_FOR_ML - LOW_CONFIDENCE_OBS)) * 35);
  } else {
    level = "high";
    score = Math.round(75 + Math.min(25, ((nonzero - MIN_NONZERO_FOR_ML) / 80) * 25));
  }
  if (weeksCovered < minWeeks) {
    level = "low";
    score = Math.min(score, 38);
  }
  return { level, score: Math.max(0, Math.min(100, score)) };
}

export function residualQuantiles(actual: number[], predicted: number[]): { q10: number; q50: number; q90: number } {
  const residuals: number[] = [];
  const n = Math.min(actual.length, predicted.length);
  for (let i = 0; i < n; i++) {
    const r = actual[i] - predicted[i];
    if (Number.isFinite(r)) residuals.push(r);
  }
  if (residuals.length < 5) {
    return { q10: -1, q50: 0, q90: 1 };
  }
  return {
    q10: quantile(residuals, 0.1),
    q50: quantile(residuals, 0.5),
    q90: quantile(residuals, 0.9),
  };
}

export function withIntervals(
  points: ForecastPoint[],
  q: { q10: number; q50: number; q90: number },
): ForecastPoint[] {
  return points.map((p) => {
    const center = p.ensemble;
    return {
      ...p,
      p10: clip(center + q.q10),
      p50: clip(center + q.q50),
      p90: clip(center + q.q90),
    };
  });
}

function clip(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, value);
}
