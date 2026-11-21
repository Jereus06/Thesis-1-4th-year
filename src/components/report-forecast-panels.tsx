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
        <CardContent>
          {!comparison.length ? (
            <p className="text-sm text-muted">
              No past forecast comparison is available for these dates and products. A saved
              forecast must have been tested against sales from the same days.
            </p>
          ) : (
            <div className="record-scroll" tabIndex={0}>
              <table aria-label="Actual versus forecast" className="w-full min-w-[48rem] text-left text-sm">
                <thead className="text-xs tracking-wide text-muted uppercase">
                  <tr>
                    <th scope="col" className="px-4 py-3 font-medium">Unit</th>
                    <th scope="col" className="px-4 py-3 font-medium">Actually sold</th>
                    <th scope="col" className="px-4 py-3 font-medium">Forecast quantity</th>
                    <th scope="col" className="px-4 py-3 font-medium">Average error</th>
                  </tr>
                </thead>
                <tbody>
                  {comparison.map((row) => (
                    <tr key={row.unit} className="border-t border-border">
                      <td className="px-4 py-3">{row.unit}</td>
                      <td className="px-4 py-3 tabular">{quantity(row.actual)} {row.unit}</td>
                      <td className="px-4 py-3 tabular">{quantity(row.predicted)} {row.unit}</td>
                      <td className="px-4 py-3 tabular">{num(row.mae, 2)} {row.unit} per product per day</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
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
            future estimates. Totals cover the remaining forecast dates shown, using expected
            quantity multiplied by the price used.
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
                }}
              >
                Clear search
              </Button>
            </div>
          ) : (
            <>
              <p role="status" className="text-xs text-muted">
                {num(matches.length)} products
              </p>
              <div
                className="record-scroll"
                tabIndex={0}
                role="region"
                aria-label="Estimated revenue products"
              >
                <table aria-label="Estimated revenue by product" className="w-full min-w-[64rem] text-left text-sm">
                  <thead className="text-xs tracking-wide text-muted uppercase">
                    <tr>
                      <th scope="col" className="px-4 py-3 font-medium">Product</th>
                      <th scope="col" className="px-4 py-3 font-medium">Estimated revenue</th>
                      <th scope="col" className="px-4 py-3 font-medium">Expected quantity</th>
                      <th scope="col" className="px-4 py-3 font-medium">Price used</th>
                      <th scope="col" className="px-4 py-3 font-medium">Forecast dates</th>
                    </tr>
                  </thead>
                  <tbody>
                {matches.map((product) => {
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
                    <tr key={product.id} className="border-t border-border">
                      <td className="px-4 py-3 [overflow-wrap:anywhere]">
                        <p className="font-medium">{product.name}</p>
                        <p className="mt-1 text-xs text-muted">{product.sku}</p>
                      </td>
                      <td className="px-4 py-3 tabular">
                        {estimate.amount == null ? "Not available yet" : peso(estimate.amount)}
                      {(missingPrice || missingForecast) && (
                        <p className="mt-2 text-sm text-muted">
                          {missingPrice && "Add a selling price in Inventory. "}
                          {missingForecast && estimate.unavailableReason}
                        </p>
                      )}
                      </td>
                      <td className="px-4 py-3 tabular">
                        {missingForecast ? (estimate.expired ? "Forecast expired" : "Unavailable") : `${quantity(estimate.predictedQuantity!)} ${product.unit}`}
                      </td>
                      <td className="px-4 py-3 tabular">
                        {missingPrice ? "Selling price not set" : `${peso(estimate.assumedSellingPrice)} per ${product.unit}`}
                      </td>
                      <td className="px-4 py-3">
                        {estimate.start && estimate.end ? `${estimate.start} to ${estimate.end}` : (estimate.expired ? "Forecast period ended" : "No current dates")}
                      </td>
                    </tr>
                  );
                })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </>
  );
}
