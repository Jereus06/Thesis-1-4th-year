export type Product = {
  id: string;
  sku: string;
  name: string;
  category: string;
  unit: string;
  currentStock: number;
  leadTimeDays: number;
  safetyStock: number;
  unitCost: number;
};

export type Sale = {
  id: string;
  productId: string;
  date: string;
  qty: number;
};

export type DataScenario = "partner" | "thin";

export type Settings = {
  storeName: string;
  storeLocation: string;
  maWindow: number;
  forecastHorizon: number;
  holdoutDays: number;
  coverDays: number;
  topNProducts: number;
  minWeeks: number;
  cvFolds: number;
  useFallbackIfThin: boolean;
  dataScenario: DataScenario;
};

export type ForecastMethod = "xgb" | "ma" | "ensemble" | "rule";
export type ConfidenceLevel = "high" | "medium" | "low";
export type Grain = "daily" | "weekly";

export type ForecastPoint = {
  date: string;
  actual: number | null;
  ma: number;
  xgb: number;
  ensemble: number;
  p10: number;
  p50: number;
  p90: number;
};

export type DataQuality = {
  weeksCovered: number;
  minWeeksRequired: number;
  meetsMinimum: boolean;
  reliableRange: boolean;
  zeroSalesShare: number;
  grain: Grain;
  usedFallbackDataset: boolean;
  observationCount: number;
  nonzeroCount: number;
  sparse: boolean;
};

export type ProductForecast = {
  productId: string;
  maMae: number;
  maRmse: number;
  xgbMae: number;
  xgbRmse: number;
  ensembleMae: number;
  ensembleRmse: number;
  winner: ForecastMethod;
  method: ForecastMethod;
  xgbWeight: number;
  maWeight: number;
  holdout: ForecastPoint[];
  future: ForecastPoint[];
  dailyDemand: number;
  seriesMean: number;
  confidence: ConfidenceLevel;
  confidenceScore: number;
  observationCount: number;
  nonzeroCount: number;
  grain: Grain;
  trainedWithMl: boolean;
  fallbackReason?: string;
  cvMaeXgb: number;
  cvMaeMa: number;
};

export type PipelineMode = "serve" | "train";

export type PipelineDiagnostics = {
  minWeeksRequired: number;
  weeksCovered: number;
  meetsMinimum: boolean;
  reliableRange: boolean;
  usedFallbackDataset: boolean;
  fallbackReason?: string;
  sparseProductCount: number;
  weeklyProductCount: number;
  dailyProductCount: number;
  mlProductIds: string[];
  ruleProductIds: string[];
  skippedReasons: Record<string, string>;
  featureNames: string[];
  avoidedProductIds: boolean;
  maxDepth: number;
  learningRate: number;
  nEstimatorsCap: number;
  cvFolds: number;
  earlyStopping: boolean;
  chronologicalSplit: boolean;
  ensembleUsedCount: number;
  xgbUnstableCount: number;
  lowConfidenceCount: number;
  disclaimer: string;
  topN: number;
  trainedProductCount: number;
  servingFromCache: boolean;
  mode: PipelineMode;
};

export type PipelineResult = {
  trainedAt: string;
  trainedMs: number;
  holdoutStart: string;
  holdoutEnd: string;
  horizonEnd: string;
  dates: string[];
  maMae: number;
  maRmse: number;
  xgbMae: number;
  xgbRmse: number;
  ensembleMae: number;
  ensembleRmse: number;
  winner: ForecastMethod;
  treesUsed: number;
  byProduct: Record<string, ProductForecast>;
  diagnostics: PipelineDiagnostics;
};

export type StockStatus = "stockout" | "reorder" | "watch" | "healthy";

export type ReorderRow = {
  product: Product;
  dailyDemand: number;
  demandDuringLead: number;
  reorderPoint: number;
  targetStock: number;
  reorderQty: number;
  daysOfCover: number;
  status: StockStatus;
  winnerModel: ForecastMethod;
  confidence: ConfidenceLevel;
};

export type TrainProgress = {
  status: "idle" | "serving" | "training" | "ready";
  completed: number;
  total: number;
  currentProduct?: string;
  message: string;
};
