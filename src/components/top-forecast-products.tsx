import { ForecastEvidenceBadge } from "@/components/forecast-evidence-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { num } from "@/lib/format";
import type { ForecastTrainingScope, Product, ProductForecast } from "@/lib/types";

export function TopForecastProducts({
  scope,
  configuredLimit = 8,
  products,
  forecasts,
  stale = false,
  demonstration = false,
}: {
  scope?: ForecastTrainingScope | null;
  configuredLimit?: number;
  products: Product[];
  forecasts: Record<string, ProductForecast>;
  stale?: boolean;
  demonstration?: boolean;
}) {
  if (demonstration) return null;
  const selected =
    scope?.products.flatMap((row) => {
      const product = products.find((item) => item.id === row.productId && item.isActive !== false);
      return product ? [{ ...row, product, forecast: forecasts[row.productId] }] : [];
    }) ?? [];
  const limit = scope?.limit ?? configuredLimit;
  return (
    <Card role="region" aria-label="Top products for XGBoost">
      <CardHeader>
        <CardTitle>Top products for XGBoost</CardTitle>
        <CardDescription>
          Up to {num(limit)} eligible products, ranked by quantities sold during the saved training
          period. This list shows the machine-learning selection, not guaranteed future best
          sellers.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!scope ? (
          <p className="text-sm text-muted">
            No saved product selection is available yet. Refresh forecasts to see which products
            qualify for XGBoost. Current limit: {num(configuredLimit)} products.
          </p>
        ) : (
          <>
            <p className="text-sm text-muted">
              {num(selected.length)} active products shown · {num(scope.products.length)} selected
              in the saved run · limit {num(scope.limit)}. Training period: {scope.trainingStart} to{" "}
              {scope.trainingEnd}.
            </p>
            {configuredLimit !== scope.limit && (
              <p className="text-sm text-warning">
                The current limit is {num(configuredLimit)}. Refresh forecasts to apply it; this
                list belongs to the earlier saved run.
              </p>
            )}
            {stale && (
              <p className="text-sm text-warning">
                Records or settings changed. This is the previous saved selection; refresh
                forecasts.
              </p>
            )}
            {selected.length ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-xs tracking-wide text-muted uppercase">
                    <tr>
                      <th className="pb-2 pr-3 font-medium">Rank</th>
                      <th className="pb-2 pr-3 font-medium">Product</th>
                      <th className="pb-2 pr-3 font-medium">Past training sales</th>
                      <th className="pb-2 pr-3 font-medium">Expected sales per day</th>
                      <th className="pb-2 font-medium">Forecast confidence</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selected.map(({ product, forecast, rank, trainingQuantity }) => {
                      const current =
                        forecast?.demandAvailable !== false &&
                        !forecast?.forecastExpired &&
                        !stale &&
                        Number.isFinite(forecast?.dailyDemand);
                      return (
                        <tr key={product.id} className="border-t border-border">
                          <td className="py-3 pr-3 tabular">{num(rank)}</td>
                          <td className="py-3 pr-3">
                            <p className="font-medium">{product.name}</p>
                            <p className="text-xs text-muted">Product code: {product.sku}</p>
                          </td>
                          <td className="py-3 pr-3 tabular">
                            {num(Number(trainingQuantity), 1)} {product.unit}
                          </td>
                          <td className="py-3 pr-3 tabular">
                            {current ? `${num(forecast.dailyDemand, 1)} ${product.unit}` : "—"}
                          </td>
                          <td className="py-3">
                            <ForecastEvidenceBadge
                              evidence={forecast?.forecastEvidence}
                              confidence={forecast?.forecastConfidence}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-muted">
                No active products in this saved run qualify for XGBoost.
              </p>
            )}
            {scope.products.length < scope.limit && (
              <p className="text-sm text-muted">
                The limit is a maximum. Fewer products are selected when there are fewer eligible
                products with enough usable history. Other products can still use Moving Average.
              </p>
            )}
          </>
        )}
        <p className="text-xs text-muted">
          Confidence describes support for the estimate from past tests. Expected sales shows how
          much may sell; high confidence does not automatically mean high sales.
        </p>
      </CardContent>
    </Card>
  );
}
