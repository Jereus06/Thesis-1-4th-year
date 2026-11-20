import { useState } from "react";
import { Search } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { modelLabel } from "@/lib/forecast/constants";
import { compareSalesForecast, estimatedRevenue, type ReportModel } from "@/lib/sales-forecast";
import { num, peso, quantity } from "@/lib/format";
import type { PipelineResult, Product } from "@/lib/types";

type Props = {
  products: Product[];
  result: PipelineResult | null | undefined;
  today: string;
  from: string;
  to: string;
  model: ReportModel;
  onModelChange: (model: ReportModel) => void;
};

export function ReportForecastPanels({
  products,
  result,
  today,
  from,
  to,
  model,
  onModelChange,
}: Props) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const comparison = compareSalesForecast(products, result, from, to, model);
  const active = products.filter((product) => product.isActive !== false);
  const query = search.trim().toLocaleLowerCase();
  const matches = active.filter((product) =>
    [
      product.name,
      product.sku,
      product.category,
      product.brand,
      product.model,
      product.variant,
    ].some((value) => value?.toLocaleLowerCase().includes(query)),
  );
  const pageSize = 8;
  const currentPage = Math.min(page, Math.max(0, Math.ceil(matches.length / pageSize) - 1));
  const visible = matches.slice(currentPage * pageSize, (currentPage + 1) * pageSize);

  return (
    <>
      <Card className="min-w-0">
        <CardHeader>
          <CardTitle>Actual versus forecast</CardTitle>
          <CardDescription>
            See how past estimates compared with recorded sales in your selected dates. Only
            products and days with both values are included. Different units are shown separately.
          </CardDescription>
          <details className="rounded-xl border border-border p-3 text-sm">
            <summary className="cursor-pointer font-medium text-primary">
              Choose a forecasting method
            </summary>
            <div className="mt-3 grid gap-2">
              <Label htmlFor="report-model">Forecasting method</Label>
              <Select
                id="report-model"
                value={model}
                onChange={(event) => onModelChange(event.target.value as ReportModel)}
              >
                <option value="operating">Recommended method for each product</option>
                <option value="ma">Moving Average</option>
                <option value="xgb">XGBoost</option>
                <option value="ensemble">Ensemble</option>
              </Select>
              <p className="text-xs text-muted">
                Applies to this comparison and Estimated revenue below.
              </p>
            </div>
          </details>
          <p className="text-xs text-muted">
            Method: {model === "operating" ? "Recommended for each product" : modelLabel(model)}
          </p>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          {!comparison.length && (
            <p className="text-sm text-muted sm:col-span-2">
              No past forecast comparison is available for these dates and products. A saved
              forecast must have been tested against sales from the same days.
            </p>
          )}
          {comparison.map((row) => (
            <section
              key={row.unit}
              aria-label={`Forecast comparison in ${row.unit}`}
              className="min-w-0 rounded-2xl border border-border p-4"
            >
              <h3 className="font-medium">Products counted in {row.unit}</h3>
              <dl className="mt-3 grid grid-cols-2 gap-3">
                <Figure label="Actually sold" value={`${quantity(row.actual)} ${row.unit}`} />
                <Figure
                  label="Forecast quantity"
                  value={`${quantity(row.predicted)} ${row.unit}`}
                />
              </dl>
              <p className="mt-3 text-sm text-muted">
                Estimates were off by {num(row.mae, 2)} {row.unit} per product per day on average.
              </p>
              <details className="mt-3 border-t border-border pt-3 text-xs text-muted">
                <summary className="cursor-pointer font-medium text-primary">
                  How this was checked
                </summary>
                <div className="mt-2 space-y-2 leading-relaxed">
                  <p>
                    {num(row.observations)} daily product comparisons from the saved final test.
                    Products without matching results are left out.
                  </p>
                  <p>Methods: {row.methods.map(modelLabel).join(", ")}.</p>
                  <p>
                    Average error (MAE): {num(row.mae, 2)} {row.unit}. Error giving more weight to
                    large mistakes (RMSE): {num(row.rmse, 2)} {row.unit}.
                  </p>
                  <p>
                    These compare quantities and can be checked even when past selling prices are
                    missing.
                  </p>
                </div>
              </details>
            </section>
          ))}
        </CardContent>
      </Card>

      <Card className="min-w-0" role="region" aria-label="Estimated revenue">
        <CardHeader>
          <CardTitle>Estimated revenue</CardTitle>
          <CardDescription>
            Expected sales value for each product’s forecast dates, using its current selling price.
            Prices are assumed to stay the same. This is an estimate, not profit or guaranteed
            sales.
          </CardDescription>
          <p className="text-xs text-muted">
            Prices checked on {today}. The sales date filter above applies to past sales, not these
            future estimates.
          </p>
          <div className="grid gap-1.5 pt-2">
            <Label htmlFor="estimated-revenue-search">Find a product</Label>
            <div className="relative">
              <Search
                className="pointer-events-none absolute top-3.5 left-3 size-4 text-muted"
                aria-hidden="true"
              />
              <Input
                id="estimated-revenue-search"
                type="search"
                placeholder="Search name, SKU, brand, model, or size"
                className="pl-9"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(0);
                }}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {!active.length ? (
            <p className="text-sm text-muted">
              No active products match your report filters. Choose another product or unit.
            </p>
          ) : !matches.length ? (
            <div className="rounded-xl bg-surface-2 p-4 text-sm">
              <p>No products match “{search}”. Try a product name, SKU, brand, model, or size.</p>
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => {
                  setSearch("");
                  setPage(0);
                }}
              >
                Clear search
              </Button>
            </div>
          ) : (
            <>
              <p role="status" className="text-xs text-muted">
                Showing {currentPage * pageSize + 1}–
                {Math.min((currentPage + 1) * pageSize, matches.length)} of {num(matches.length)}{" "}
                products
              </p>
              <div className="grid gap-4 md:grid-cols-2">
                {visible.map((product) => {
                  const forecast = result?.byProduct[product.id];
                  const estimate = estimatedRevenue(
                    product,
                    forecast,
                    today,
                    model,
                    result?.forecastHorizonDays,
                  );
                  const missingPrice = estimate.assumedSellingPrice == null;
                  const missingForecast = estimate.predictedQuantity == null;
                  return (
                    <article
                      key={product.id}
                      className="min-w-0 rounded-2xl border border-border p-4 sm:p-5"
                    >
                      <h3 className="font-medium [overflow-wrap:anywhere]">{product.name}</h3>
                      <p className="mt-1 text-xs text-muted [overflow-wrap:anywhere]">
                        {product.sku}
                      </p>
                      <p className="mt-4 text-xs text-muted">Estimated revenue</p>
                      <p className="mt-1 text-2xl font-semibold tabular [overflow-wrap:anywhere]">
                        {estimate.amount == null ? "Not available yet" : peso(estimate.amount)}
                      </p>
                      {(missingPrice || missingForecast) && (
                        <p className="mt-2 text-sm text-muted">
                          {missingPrice && "Add a selling price in Inventory. "}
                          {missingForecast &&
                            (forecast?.forecastExpired || (estimate.end && estimate.end < today)
                              ? "Refresh forecasts to get an estimate for current dates."
                              : "A current, complete sales forecast is needed. Check sales history and refresh forecasts.")}
                        </p>
                      )}
                      <dl className="mt-4 grid gap-3 border-t border-border pt-3 text-sm">
                        <Figure
                          label="Expected quantity"
                          value={
                            missingForecast
                              ? "Waiting for a forecast"
                              : `${quantity(estimate.predictedQuantity!)} ${product.unit}`
                          }
                        />
                        <Figure
                          label="Price used"
                          value={
                            missingPrice
                              ? "Selling price not set"
                              : `${peso(estimate.assumedSellingPrice)} per ${product.unit}`
                          }
                        />
                        {estimate.start && estimate.end && (
                          <Figure
                            label={missingForecast ? "Saved forecast dates" : "Forecast dates"}
                            value={`${estimate.start} to ${estimate.end}`}
                          />
                        )}
                      </dl>
                      <details className="mt-3 text-xs text-muted">
                        <summary className="cursor-pointer font-medium text-primary">
                          Estimate details
                        </summary>
                        <p className="mt-2 leading-relaxed">
                          Expected quantity × price used. Price assumed as of{" "}
                          {estimate.assumptionDate}. Method:{" "}
                          {estimate.method ? modelLabel(estimate.method) : "Waiting for a forecast"}
                          .
                        </p>
                      </details>
                    </article>
                  );
                })}
              </div>
              {matches.length > pageSize && (
                <nav
                  aria-label="Estimated revenue pages"
                  className="flex flex-wrap items-center justify-between gap-3"
                >
                  <p className="text-xs text-muted">
                    Page {currentPage + 1} of {Math.ceil(matches.length / pageSize)}
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={currentPage === 0}
                      onClick={() => setPage(currentPage - 1)}
                    >
                      Previous
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={(currentPage + 1) * pageSize >= matches.length}
                      onClick={() => setPage(currentPage + 1)}
                    >
                      Next
                    </Button>
                  </div>
                </nav>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-1 font-medium tabular [overflow-wrap:anywhere]">{value}</dd>
    </div>
  );
}
