import { mean } from "./metrics";

export function movingAverage(history: number[], window: number): number {
  if (history.length === 0) return 0;
  const slice = history.slice(-Math.max(1, window));
  return mean(slice);
}

export function rollingMovingAverage(
  series: number[],
  startIndex: number,
  endIndex: number,
  window: number,
): number[] {
  const preds: number[] = [];
  for (let t = startIndex; t < endIndex; t++) {
    const from = Math.max(0, t - window);
    preds.push(mean(series.slice(from, t)));
  }
  return preds;
}
