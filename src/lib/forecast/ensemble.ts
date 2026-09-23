import { XGB_UNSTABLE_RATIO } from "./constants";

export function ensembleWeights(cvMaeXgb: number, cvMaeMa: number): { xgb: number; ma: number } {
  const xgbOk = Number.isFinite(cvMaeXgb) && cvMaeXgb >= 0;
  const maOk = Number.isFinite(cvMaeMa) && cvMaeMa >= 0;
  if (!xgbOk && maOk) return { xgb: 0, ma: 1 };
  if (xgbOk && !maOk) return { xgb: 1, ma: 0 };
  const invX = 1 / Math.max(1e-6, cvMaeXgb);
  const invM = 1 / Math.max(1e-6, cvMaeMa);
  const sum = invX + invM;
  return { xgb: invX / sum, ma: invM / sum };
}

export function mixPreds(xgb: number[], ma: number[], wXgb: number, wMa: number): number[] {
  const n = Math.max(xgb.length, ma.length);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = xgb[i] ?? 0;
    const b = ma[i] ?? 0;
    out.push(wXgb * a + wMa * b);
  }
  return out;
}

export function isXgbUnstable(opts: {
  xgbMae: number;
  maMae: number;
  trainRows: number;
  seriesMean: number;
  preds: number[];
}): boolean {
  if (opts.trainRows < 16) return true;
  if (!Number.isFinite(opts.xgbMae)) return true;
  if (Number.isFinite(opts.maMae) && opts.xgbMae > opts.maMae * XGB_UNSTABLE_RATIO) return true;
  const meanPred =
    opts.preds.length === 0
      ? 0
      : opts.preds.reduce((s, v) => s + v, 0) / opts.preds.length;
  if (opts.seriesMean > 0 && meanPred > opts.seriesMean * 5) return true;
  if (opts.preds.some((v) => !Number.isFinite(v))) return true;
  return false;
}

export function pickWinner(
  maMae: number,
  maRmse: number,
  xgbMae: number,
  xgbRmse: number,
  ensembleMae: number,
  ensembleRmse: number,
  unstable: boolean,
): "xgb" | "ma" | "ensemble" {
  const candidates: { key: "xgb" | "ma" | "ensemble"; mae: number; rmse: number }[] = [
    { key: "ma", mae: maMae, rmse: maRmse },
  ];
  if (!unstable && Number.isFinite(xgbMae)) {
    candidates.push({ key: "xgb", mae: xgbMae, rmse: xgbRmse });
  }
  if (!unstable && Number.isFinite(ensembleMae)) {
    candidates.push({ key: "ensemble", mae: ensembleMae, rmse: ensembleRmse });
  }
  candidates.sort((a, b) => {
    const maeA = Number.isFinite(a.mae) ? a.mae : Infinity;
    const maeB = Number.isFinite(b.mae) ? b.mae : Infinity;
    if (maeA !== maeB) return maeA - maeB;
    const rmseA = Number.isFinite(a.rmse) ? a.rmse : Infinity;
    const rmseB = Number.isFinite(b.rmse) ? b.rmse : Infinity;
    return rmseA - rmseB;
  });
  return candidates[0]?.key ?? "ma";
}
