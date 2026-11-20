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
    (expectedDays == null || points.length * step >= expectedDays);
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
  return {
    productId: product.id,
    method,
    assumptionDate,
    assumedSellingPrice: price ?? null,
    predictedQuantity,
    amount:
      predictedQuantity != null && price != null && Number.isFinite(price) && price >= 0
        ? predictedQuantity * price
        : null,
    start: points[0]?.date,
    end: points.at(-1)?.date,
  };
}
