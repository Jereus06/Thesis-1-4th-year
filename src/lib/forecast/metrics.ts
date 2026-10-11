export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function std(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  const variance =
    values.reduce((sum, value) => sum + (value - m) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

export function mae(actual: number[], predicted: number[]): number {
  let sum = 0;
  let n = 0;
  const len = Math.min(actual.length, predicted.length);
  for (let i = 0; i < len; i++) {
    const err = actual[i] - predicted[i];
    if (!Number.isFinite(err)) continue;
    sum += Math.abs(err);
    n += 1;
  }
  return n ? sum / n : Number.NaN;
}

export function rmse(actual: number[], predicted: number[]): number {
  let sum = 0;
  let n = 0;
  const len = Math.min(actual.length, predicted.length);
  for (let i = 0; i < len; i++) {
    const err = actual[i] - predicted[i];
    if (!Number.isFinite(err)) continue;
    sum += err * err;
    n += 1;
  }
  return n ? Math.sqrt(sum / n) : Number.NaN;
}

export function quantile(values: number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const idx = (sorted.length - 1) * Math.min(1, Math.max(0, q));
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] * (hi - idx) + sorted[hi] * (idx - lo);
}
