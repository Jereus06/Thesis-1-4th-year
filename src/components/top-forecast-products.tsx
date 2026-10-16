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
          Up to {num(limit)} products, ranked by past sales used to prepare the saved forecast. This
          does not guarantee future best sellers.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!scope ? (
          <p className="text-sm text-muted">
            Refresh forecasts to see the selected products. Maximum: {num(configuredLimit)}{" "}
            products.
          </p>
        ) : (
          <>
            <p className="text-sm text-muted">
              {num(selected.length)} {selected.length === 1 ? "product" : "products"} shown ·{" "}
              {num(scope.products.length)} selected · maximum {num(scope.limit)}. Sales used:{" "}
              {scope.trainingStart} to {scope.trainingEnd}.
            </p>
            {configuredLimit !== scope.limit && (
              <p className="text-sm text-warning">
                The maximum changed to {num(configuredLimit)} products. Refresh forecasts to update
                this list.
              </p>
            )}
            {stale && (
              <p className="text-sm text-warning">
                Records or settings changed. Refresh forecasts to update this list.
              </p>
            )}
            {selected.length ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-xs tracking-wide text-muted uppercase">
                    <tr>
                      <th className="pb-2 pr-3 font-medium">Rank</th>
                      <th className="pb-2 pr-3 font-medium">Product</th>
                      <th className="pb-2 pr-3 font-medium">Past sales</th>
                      <th className="pb-2 pr-3 font-medium">Expected daily sales</th>
                      <th className="pb-2 font-medium">Confidence</th>
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
                No active products were selected for this saved forecast.
              </p>
            )}
            {scope.products.length < scope.limit && (
              <p className="text-sm text-muted">
                Fewer products appear when fewer have enough usable history. Other products can
                still use Moving Average.
              </p>
            )}
          </>
        )}
        <p className="text-xs text-muted">
          Confidence shows how well an estimate performed in past checks. High confidence does not
          mean high sales.
        </p>
      </CardContent>
    </Card>
  );
}
