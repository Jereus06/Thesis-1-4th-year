/** sklearn-style TimeSeriesSplit: rotating chronological windows, no shuffle. */
export function timeSeriesSplit(
  n: number,
  nSplits = 3,
): { train: number[]; test: number[] }[] {
  const folds: { train: number[]; test: number[] }[] = [];
  if (nSplits < 2 || n < nSplits * 8) return folds;
  const testSize = Math.max(5, Math.floor(n / (nSplits + 1)));
  for (let i = 0; i < nSplits; i++) {
    const testStart = (i + 1) * testSize;
    const testEnd = i === nSplits - 1 ? n : Math.min(n, testStart + testSize);
    if (testStart >= n) break;
    const trainLen = testStart;
    if (trainLen < 16 || testEnd - testStart < 4) continue;
    folds.push({
      train: range(0, testStart),
      test: range(testStart, testEnd),
    });
  }
  return folds;
}

function range(start: number, end: number): number[] {
  const out: number[] = [];
  for (let i = start; i < end; i++) out.push(i);
  return out;
}
