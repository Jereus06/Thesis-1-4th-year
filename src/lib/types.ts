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
  isActive?: boolean;
};

export type ProductPatch = Partial<
  Pick<
    Product,
    | "sku"
    | "name"
    | "category"
    | "unit"
    | "currentStock"
    | "leadTimeDays"
    | "safetyStock"
    | "unitCost"
    | "isActive"
  >
>;

export type InventoryMovement = {
  id: string;
  businessId?: string;
  productId: string;
  movementDate: string;
  movementType: "opening_balance" | "sale" | "receipt" | "return" | "write_off" | "adjustment";
  quantityDelta: number;
  balanceAfter: number;
  dataOrigin: "demo" | "partner";
  saleId: string | null;
  note: string | null;
  recordedBy: string | null;
};

export type StockMovementInput = {
  productId: string;
  movementDate: string;
  movementType: "receipt" | "return" | "write_off" | "adjustment";
  quantityDelta: number;
  note?: string;
  idempotencyKey?: string;
};

export type Sale = {
  id: string;
  productId: string;
  date: string;
  qty: number;
  sourceRecordKey?: string;
};

export type SalesImportError = {
  row: number;
  code: string;
  sku?: string;
};

export type SalesImportResult = {
  acceptedRows: number;
  rejectedRows: number;
  errors: SalesImportError[];
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
  minimumNonzeroDays: number;
  timezone: string;
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

export type PredictionIntervalEvidence = {
  available: boolean;
  selectionObservations?: number;
  calibrationObservations?: number;
  calibrationStart?: string | null;
  calibrationEnd?: string | null;
  calibrationSplit?: string;
  lowerResidual?: number | null;
  upperResidual?: number | null;
  finalTestCoverage?: number | null;
  finalTestObservations?: number;
  nominalCoverage?: number;
  method?: string;
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
  unavailableReason?: string;
  demandAvailable?: boolean;
  forecastExpired?: boolean;
  unknownDays?: number;
  excludedDays?: number;
  qualityWarnings?: string[];
  interval?: PredictionIntervalEvidence;
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

export type ForecastTiming = {
  queueWaitMs?: number | null;
  preparationMs?: number | null;
  trainingMs?: number | null;
  validationMs?: number | null;
  evaluationMs?: number | null;
  validationEvaluationMs?: number | null;
  persistenceMs?: number | null;
  totalProcessingMs?: number | null;
  timingVersion?: string;
  timingScope?: unknown;
};

export type PipelineResult = {
  trainedAt: string;
  trainedMs: number;
  processingTiming?: ForecastTiming;
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
  demandAvailable?: boolean;
  forecastExpired?: boolean;
  unavailableReason?: string;
  fallbackReason?: string;
  unknownDays?: number;
  excludedDays?: number;
  qualityWarnings?: string[];
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
  status: "idle" | "serving" | "training" | "ready" | "expired";
  completed: number;
  total: number;
  currentProduct?: string;
  message: string;
};
