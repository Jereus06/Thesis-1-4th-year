type Node =
  | {
      isLeaf: true;
      weight: number;
    }
  | {
      isLeaf: false;
      feature: number;
      threshold: number;
      left: Node;
      right: Node;
    };

export type XgbParams = {
  maxDepth: number;
  learningRate: number;
  nEstimators: number;
  minChildWeight: number;
  lambda: number;
  gamma: number;
  subsample: number;
  nBins: number;
  earlyStoppingRounds: number;
  seed: number;
};

export const DEFAULT_XGB: XgbParams = {
  maxDepth: 3,
  learningRate: 0.05,
  nEstimators: 120,
  minChildWeight: 4,
  lambda: 1.5,
  gamma: 0.3,
  subsample: 0.9,
  nBins: 12,
  earlyStoppingRounds: 10,
  seed: 42,
};

export type BoostedModel = {
  baseScore: number;
  trees: Node[];
  learningRate: number;
  treesUsed: number;
};

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function leafWeight(g: number, h: number, lambda: number): number {
  return -g / (h + lambda);
}

function score(g: number, h: number, lambda: number): number {
  return (g * g) / (h + lambda);
}

function subsampleIndices(n: number, ratio: number, rand: () => number): number[] {
  if (ratio >= 0.999) return Array.from({ length: n }, (_, i) => i);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    if (rand() <= ratio) out.push(i);
  }
  return out.length > 8 ? out : Array.from({ length: n }, (_, i) => i);
}

function bestSplit(
  X: number[][],
  g: Float64Array,
  h: Float64Array,
  indices: number[],
  params: XgbParams,
): { feature: number; threshold: number; gain: number } | null {
  let bestGain = 0;
  let bestFeature = 0;
  let bestThreshold = 0;
  const nFeat = X[0]?.length ?? 0;
  if (nFeat === 0 || indices.length < 4) return null;

  let gTotal = 0;
  let hTotal = 0;
  for (const i of indices) {
    gTotal += g[i];
    hTotal += h[i];
  }

  for (let f = 0; f < nFeat; f++) {
    let min = Infinity;
    let max = -Infinity;
    for (const i of indices) {
      const v = X[i][f];
      if (v < min) min = v;
      if (v > max) max = v;
    }
    if (!(max > min)) continue;

    const bins = params.nBins;
    const binG = new Float64Array(bins);
    const binH = new Float64Array(bins);
    const width = (max - min) / bins;
    for (const i of indices) {
      let b = Math.floor((X[i][f] - min) / width);
      if (b >= bins) b = bins - 1;
      if (b < 0) b = 0;
      binG[b] += g[i];
      binH[b] += h[i];
    }

    let gL = 0;
    let hL = 0;
    for (let b = 0; b < bins - 1; b++) {
      gL += binG[b];
      hL += binH[b];
      const gR = gTotal - gL;
      const hR = hTotal - hL;
      if (hL < params.minChildWeight || hR < params.minChildWeight) continue;
      const gain =
        0.5 *
          (score(gL, hL, params.lambda) +
            score(gR, hR, params.lambda) -
            score(gTotal, hTotal, params.lambda)) -
        params.gamma;
      if (gain > bestGain) {
        bestGain = gain;
        bestFeature = f;
        bestThreshold = min + (b + 1) * width;
      }
    }
  }

  if (bestGain <= 1e-8) return null;
  return { feature: bestFeature, threshold: bestThreshold, gain: bestGain };
}

function buildTree(
  X: number[][],
  g: Float64Array,
  h: Float64Array,
  indices: number[],
  depth: number,
  params: XgbParams,
): Node {
  let gSum = 0;
  let hSum = 0;
  for (const i of indices) {
    gSum += g[i];
    hSum += h[i];
  }
  if (depth >= params.maxDepth || indices.length < 4) {
    return { isLeaf: true, weight: leafWeight(gSum, hSum, params.lambda) };
  }
  const split = bestSplit(X, g, h, indices, params);
  if (!split) {
    return { isLeaf: true, weight: leafWeight(gSum, hSum, params.lambda) };
  }
  const leftIdx: number[] = [];
  const rightIdx: number[] = [];
  for (const i of indices) {
    if (X[i][split.feature] <= split.threshold) leftIdx.push(i);
    else rightIdx.push(i);
  }
  if (leftIdx.length === 0 || rightIdx.length === 0) {
    return { isLeaf: true, weight: leafWeight(gSum, hSum, params.lambda) };
  }
  return {
    isLeaf: false,
    feature: split.feature,
    threshold: split.threshold,
    left: buildTree(X, g, h, leftIdx, depth + 1, params),
    right: buildTree(X, g, h, rightIdx, depth + 1, params),
  };
}

function predictTree(node: Node, x: number[]): number {
  if (node.isLeaf) return node.weight;
  return x[node.feature] <= node.threshold
    ? predictTree(node.left, x)
    : predictTree(node.right, x);
}

export function predictXgb(model: BoostedModel, x: number[]): number {
  let pred = model.baseScore;
  for (const tree of model.trees) {
    pred += model.learningRate * predictTree(tree, x);
  }
  return pred;
}

export function trainXgb(
  X: number[][],
  y: number[],
  Xval: number[][] | null,
  yval: number[] | null,
  params: XgbParams = DEFAULT_XGB,
): BoostedModel {
  const n = y.length;
  const baseScore = y.reduce((s, v) => s + v, 0) / Math.max(1, n);
  const pred = new Float64Array(n);
  pred.fill(baseScore);
  const g = new Float64Array(n);
  const h = new Float64Array(n);
  const trees: Node[] = [];
  const rand = rng(params.seed);

  let bestVal = Infinity;
  let bestTrees = 0;
  let wait = 0;
  let valPred: Float64Array | null = null;
  if (Xval && yval && yval.length > 0) {
    valPred = new Float64Array(yval.length);
    valPred.fill(baseScore);
  }

  const maxTrees = params.nEstimators;
  for (let t = 0; t < maxTrees; t++) {
    for (let i = 0; i < n; i++) {
      g[i] = pred[i] - y[i];
      h[i] = 1;
    }
    const idx = subsampleIndices(n, params.subsample, rand);
    const tree = buildTree(X, g, h, idx, 0, params);
    trees.push(tree);
    for (let i = 0; i < n; i++) {
      pred[i] += params.learningRate * predictTree(tree, X[i]);
    }
    if (valPred && Xval && yval) {
      let sse = 0;
      for (let i = 0; i < yval.length; i++) {
        valPred[i] += params.learningRate * predictTree(tree, Xval[i]);
        const err = yval[i] - valPred[i];
        sse += err * err;
      }
      const valRmse = Math.sqrt(sse / yval.length);
      if (valRmse + 1e-6 < bestVal) {
        bestVal = valRmse;
        bestTrees = trees.length;
        wait = 0;
      } else {
        wait += 1;
        if (wait >= params.earlyStoppingRounds) break;
      }
    } else {
      bestTrees = trees.length;
    }
  }

  if (bestTrees > 0 && bestTrees < trees.length) {
    trees.length = bestTrees;
  }

  return {
    baseScore,
    trees,
    learningRate: params.learningRate,
    treesUsed: trees.length,
  };
}
