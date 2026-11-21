import { predictionKey } from "./forecast/chart";
import type { ForecastMethod, PipelineResult, Product, ProductForecast } from "./types";

export type ReportModel = "operating" | ForecastMethod;

/** Final-test pairs only; errors are computed per product/date, grouped by counting unit. */
export function compareSalesForecast(
  products: readonly Product[],
  result: PipelineResult | null | undefined,
  from: string,
  to: string,
  model: ReportModel = "operating",
) {
  const groups = new Map<
    string,
    {
      unit: string;
      actual: number;
      predicted: number;
      observations: number;
      absoluteError: number;
      squaredError: number;
      methods: Set<ForecastMethod>;
    }
  >();
  for (const product of products) {
    const forecast = result?.byProduct[product.id];
    if (!forecast || forecast.grain !== "daily") continue;
    const method = model === "operating" ? forecast.method : model;
    // Rule forecasts have no separate MA test series in the transport contract.
    if (method === "rule") continue;
    const seen = new Set<string>();
    for (const point of forecast.holdout) {
      const predicted = point[predictionKey(method)];
      if (
        point.date < from ||
        point.date > to ||
        seen.has(point.date) ||
        point.actual == null ||
        !Number.isFinite(point.actual) ||
        !Number.isFinite(predicted)
      )
        continue;
      seen.add(point.date);
      const group = groups.get(product.unit) ?? {
        unit: product.unit,
        actual: 0,
        predicted: 0,
        observations: 0,
        absoluteError: 0,
        squaredError: 0,
        methods: new Set<ForecastMethod>(),
      };
      const error = point.actual - predicted;
      group.actual += point.actual;
      group.predicted += predicted;
      group.observations++;
      group.absoluteError += Math.abs(error);
      group.squaredError += error * error;
      group.methods.add(method);
      groups.set(product.unit, group);
    }
  }
  return [...groups.values()].map((group) => ({
    ...group,
    methods: [...group.methods],
    mae: group.absoluteError / group.observations,
    rmse: Math.sqrt(group.squaredError / group.observations),
  }));
}

export function estimatedRevenue(
  product: Product,
  forecast: ProductForecast | undefined,
  assumptionDate: string,
  model: ReportModel = "operating",
  expectedDays?: number,
) {
  const method = model === "operating" ? forecast?.method : model;
  const points = [...(forecast?.future ?? [])].sort((a, b) => a.date.localeCompare(b.date));
  const step = forecast?.grain === "weekly" ? 7 : 1;
  const origin = Date.parse(`${forecast?.forecastOriginDate}T00:00:00Z`);
  const today = Date.parse(`${assumptionDate}T00:00:00Z`);
  // The API omits elapsed dates. Validate the remaining saved daily period,
  // rather than requiring the original horizon after some days have passed.
  const hasSavedPeriod = step === 1 && Number.isFinite(origin) && expectedDays != null;
  const remainingStart = hasSavedPeriod ? Math.max(origin + 86400000, today) : NaN;
  const savedEnd = hasSavedPeriod ? origin + expectedDays! * 86400000 : NaN;
  const expectedRemaining = hasSavedPeriod
    ? Math.max(0, (savedEnd - remainingStart) / 86400000 + 1)
    : expectedDays;
  const complete =
    points.every((point, index) => {
      const timestamp = Date.parse(`${point.date}T00:00:00Z`);
      return (
        Number.isFinite(timestamp) &&
        point.date >= assumptionDate &&
        (!index ||
          timestamp - Date.parse(`${points[index - 1].date}T00:00:00Z`) === step * 86400000)
      );
    }) &&
    (expectedRemaining == null || points.length * step >= expectedRemaining) &&
    (!hasSavedPeriod ||
      (points.length === expectedRemaining &&
        Date.parse(`${points[0]?.date}T00:00:00Z`) === remainingStart &&
        Date.parse(`${points.at(-1)?.date}T00:00:00Z`) === savedEnd));
  const available =
    forecast &&
    forecast.demandAvailable !== false &&
    !forecast.forecastExpired &&
    complete &&
    points.length > 0 &&
    method &&
    points.every(
      (point) => Number.isFinite(point[predictionKey(method)]) && point[predictionKey(method)] >= 0,
    );
  const predictedQuantity = available
    ? points.reduce((sum, point) => sum + point[predictionKey(method!)], 0)
    : null;
  const price = product.sellingPrice;
  const expired = forecast?.forecastExpired || (Number.isFinite(savedEnd) && savedEnd < today);
  const unavailableReason = predictedQuantity != null
    ? undefined
    : expired
      ? `The forecast period ended${Number.isFinite(savedEnd) ? ` on ${new Date(savedEnd).toISOString().slice(0, 10)}` : ""}. Add recent sales or review missing sales dates, then refresh forecasts. Refreshing alone does not move old sales history forward.`
      : forecast?.unavailableReason ??
        (!forecast || !points.length
          ? "No current forecast is available for this product. Check its sales history and the latest forecast run."
          : !complete
            ? "The saved forecast has missing dates. Refresh forecasts to generate a complete period."
            : "The selected method has no usable forecast for this product. Choose the recommended method or refresh forecasts.");
  return {
    productId: product.id,
    method,
    assumptionDate,
    assumedSellingPrice: price ?? null,
    predictedQuantity,
    unavailableReason,
    expired: Boolean(expired),
    amount:
      predictedQuantity != null && price != null && Number.isFinite(price) && price >= 0
        ? predictedQuantity * price
        : null,
    start: points[0]?.date,
    end: points.at(-1)?.date,
  };
}
