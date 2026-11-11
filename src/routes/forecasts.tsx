import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { DemandChart } from "@/components/demand-chart";
import { DemandEvidence } from "@/components/demand-evidence";
import { ForecastEvidenceBadge } from "@/components/forecast-evidence-badge";
import { IntervalEvidence } from "@/components/interval-evidence";
import { useForecast } from "@/components/forecast-context";
import { TrainingBanner } from "@/components/training-banner";
import { TopForecastProducts } from "@/components/top-forecast-products";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { DISCLAIMER, modelLabel } from "@/lib/forecast/constants";
import { metric, num } from "@/lib/format";
import { intervalAvailability } from "@/lib/forecast-interval";
import { forecastRefreshAdvice, forecastScheduleMessage } from "@/lib/forecast-schedule";
import { usePermissions } from "@/lib/permissions";
import { useAppStore } from "@/lib/store";
import type { ForecastPoint, Product } from "@/lib/types";

export const Route = createFileRoute("/forecasts")({ component: ForecastsPage });

function ForecastsPage() {
  const catalog = useAppStore((s) => s.products);
  const products = useMemo(
    () => catalog.filter((product) => product.isActive !== false),
    [catalog],
  );
  const mode = useAppStore((s) => s.dataMode);
  const { canRefreshForecast } = usePermissions();
  const configuredMaWindow = useAppStore((s) => s.settings.maWindow);
  const configuredLimit = useAppStore((s) => s.settings.topNProducts);
  const { result, status, refresh, forecastThrough, schedule } = useForecast();
  const [errorSearch, setErrorSearch] = useState("");
  const [grainView, setGrainView] = useState<"daily" | "weekly">("daily");
  const [horizon, setHorizon] = useState(7);
  const [horizonUnit, setHorizonUnit] = useState<"days" | "weeks">("days");
  const [metricView, setMetricView] = useState<"units" | "value">("units");
  const [compareModels, setCompareModels] = useState(true);
  const savedMaWindow = result?.diagnostics.maWindow;
  const maNote =
    savedMaWindow !== undefined && Number.isInteger(savedMaWindow) && savedMaWindow > 0
      ? `Uses the previous ${savedMaWindow} days of sales.`
      : result
        ? "Sales window unavailable for these results"
        : "Averages recent daily sales";
  const refreshAdvice = forecastRefreshAdvice(mode, canRefreshForecast, schedule);
  const ready = Boolean(result);
  const preferredProduct = useMemo(() => {
    const activeIds = new Set(products.map((product) => product.id));
    const ranked = result?.diagnostics.trainingScope?.products
      .filter((row) => activeIds.has(row.productId) && Number.isInteger(row.rank) && row.rank > 0)
      .sort((a, b) => a.rank - b.rank || a.productId.localeCompare(b.productId, "en"));
    const rankedProduct = products.find((product) => product.id === ranked?.[0]?.productId);
    if (rankedProduct) return rankedProduct;
    const ordered = [...products].sort(
      (a, b) => a.sku.localeCompare(b.sku, "en") || a.id.localeCompare(b.id, "en"),
    );
    return ordered.find((product) => result?.byProduct[product.id]) ?? ordered[0];
  }, [products, result]);
  const completedRunId =
    result?.diagnostics.mode === "train"
      ? result.runId || result.trainedAt || undefined
      : undefined;
  const [selection, setSelection] = useState({
    completedRunId,
    productId: preferredProduct?.id ?? "",
  });
  const newCompletedRun =
    completedRunId !== undefined && completedRunId !== selection.completedRunId;
  // A new completed run replaces the selection; polls and serve previews keep the user's choice.
  if (newCompletedRun) {
    setSelection({ completedRunId, productId: preferredProduct?.id ?? "" });
  }
  const selected =
    products.find(
      (product) => product.id === (newCompletedRun ? preferredProduct?.id : selection.productId),
    ) ?? preferredProduct;
  const forecast = selected ? result?.byProduct[selected.id] : undefined;
  const scores = forecast;
  const winnerAvailable = Boolean(
    forecast &&
    Number.isFinite(forecast.cvMaeMa) &&
    (!forecast.trainedWithMl || Number.isFinite(forecast.cvMaeXgb)),
  );

  const chartPoints: ForecastPoint[] = useMemo(() => {
    if (!forecast) return [];
    const future = forecast.future.slice(0, horizon * (horizonUnit === "weeks" ? 7 : 1));
    const points = [...forecast.holdout, ...future];
    if (grainView === "daily") return points;
    const grouped: ForecastPoint[] = [];
    for (let index = 0; index < points.length; index += 7) {
      const batch = points.slice(index, index + 7);
      if (!batch.length) continue;
      const sum = (key: "actual" | "ma" | "xgb" | "ensemble" | "p10" | "p50" | "p90") =>
        batch.reduce((total, point) => total + (point[key] ?? 0), 0);
      grouped.push({
        date: batch[0].date,
        actual: batch.some((point) => point.actual !== null) ? sum("actual") : null,
        ma: sum("ma"),
        xgb: sum("xgb"),
        ensemble: sum("ensemble"),
        p10: sum("p10"),
        p50: sum("p50"),
        p90: sum("p90"),
      });
    }
    return grouped;
  }, [forecast, grainView, horizon, horizonUnit]);
  const metricScale = metricView === "value" ? selected?.unitCost ?? 0 : 1;

  return (
    <div className="page-enter mx-auto flex max-w-6xl flex-col gap-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="font-display text-3xl font-medium tracking-tight">Sales forecasts</h1>
        </div>
        {canRefreshForecast && (
          <div className="flex items-center gap-4">
            <Button
              disabled={status === "training"}
              onClick={() => void refresh().catch((error: Error) => toast.error(error.message))}
            >
              {status === "training" ? "Updating forecasts…" : "Refresh forecasts"}
            </Button>
          </div>
        )}
      </header>

      <TrainingBanner />
      {!canRefreshForecast && !forecastScheduleMessage(mode, schedule) && (
        <p className="text-sm text-muted">The owner can refresh forecasts after records change.</p>
      )}

      <TopForecastProducts
        scope={result?.diagnostics.trainingScope}
        configuredLimit={configuredLimit}
        products={products}
        forecasts={result?.byProduct ?? {}}
        stale={result?.diagnostics.trainingScopeStale}
        demonstration={mode === "browser-demo"}
      />

      <Card>
        <CardHeader>
          <CardTitle>Forecast options</CardTitle>
          <CardDescription>Adjust the demonstration view without changing the saved forecast run.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="grid gap-1.5">
            <Label htmlFor="forecast-grain">View</Label>
            <Select id="forecast-grain" value={grainView} onChange={(event) => setGrainView(event.target.value as "daily" | "weekly")}>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="forecast-horizon">Horizon</Label>
            <div className="flex gap-2">
              <Input id="forecast-horizon" type="number" min={1} max={90} value={horizon} onChange={(event) => setHorizon(Math.max(1, Math.min(90, Number(event.target.value) || 1)))} />
              <Select aria-label="Forecast horizon unit" value={horizonUnit} onChange={(event) => setHorizonUnit(event.target.value as "days" | "weeks")}>
                <option value="days">days</option>
                <option value="weeks">weeks</option>
              </Select>
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="forecast-metric">Metric</Label>
            <Select id="forecast-metric" value={metricView} onChange={(event) => setMetricView(event.target.value as "units" | "value")}>
              <option value="units">Units sold</option>
              <option value="value">Estimated sales value</option>
            </Select>
          </div>
          <label className="flex items-end gap-2 pb-2 text-sm">
            <input type="checkbox" checked={compareModels} onChange={(event) => setCompareModels(event.target.checked)} />
            Compare forecasting strategies
          </label>
        </CardContent>
      </Card>

      <div className="relative z-30 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <p className="font-medium">{selected?.name ?? "No active products"}</p>
        <ProductPicker
          products={products}
          selected={selected}
          disabled={!products.length}
          onChange={(productId) =>
            setSelection({ completedRunId: selection.completedRunId, productId })
          }
        />
      </div>

      <section aria-label="Model scores" className="grid gap-3 md:grid-cols-3">
        <Score
          name="Ensemble"
          mae={scores?.ensembleMae}
          rmse={scores?.ensembleRmse}
          winner={ready && winnerAvailable ? scores?.winner === "ensemble" : false}
          note="Combines both forecasting methods"
          ready={ready}
        />
        <Score
          name="XGBoost"
          mae={scores?.xgbMae}
          rmse={scores?.xgbRmse}
          winner={ready && winnerAvailable ? scores?.winner === "xgb" : false}
          note={
            mode === "api" ? "Learns patterns from past sales" : "Demonstration forecasting method"
          }
          ready={ready}
        />
        <Score
          name="Moving Average"
          mae={scores?.maMae}
          rmse={scores?.maRmse}
          winner={
            ready && winnerAvailable ? scores?.winner === "ma" || scores?.winner === "rule" : false
          }
          note={maNote}
          ready={ready}
        />
      </section>
      {savedMaWindow !== undefined &&
        Number.isInteger(savedMaWindow) &&
        savedMaWindow > 0 &&
        savedMaWindow !== configuredMaWindow && (
          <p className="text-sm text-muted" role="status">
            Saved window: {configuredMaWindow} days. Displayed results used {savedMaWindow} days.
            Refresh forecasts to apply the change.
          </p>
        )}
      {mode === "api" && ready && selected && (
        <p className="text-sm text-muted">
          Past test results for {selected.name}. MAE is average error; RMSE highlights larger
          errors. Lower is better.
        </p>
      )}

      {selected ? (
        <Card>
          <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <CardTitle>{selected?.name ?? "Product"}</CardTitle>
              <CardDescription>
                {!forecast
                  ? "No forecast yet"
                  : !Number.isFinite(forecast.dailyDemand) && forecast.fallbackReason
                    ? "No current sales estimate. Review the sales records below."
                    : `Expected daily sales: ${num(forecast.dailyDemand, 1)} ${selected.unit}`}
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {forecast && (
                <ForecastEvidenceBadge
                  evidence={forecast.forecastEvidence}
                  confidence={forecast.forecastConfidence}
                  demonstration={mode === "browser-demo"}
                />
              )}
            </div>
          </CardHeader>
          <CardContent>
            {forecast && mode === "api" && (
              <DemandEvidence
                forecast={forecast}
                unavailableReason={forecast.unavailableReason}
                className="mb-4 space-y-1 text-sm text-muted"
              />
            )}
            {ready ? (
              <DemandChart
                points={chartPoints}
                scale={metricScale}
                showModels={compareModels}
                intervalLabel={
                  mode === "browser-demo"
                    ? "Example sales range"
                    : forecast?.interval?.nominalCoverage !== undefined
                      ? `Estimated sales range (${num(forecast.interval.nominalCoverage * 100)}% target)`
                      : "Estimated sales range"
                }
              />
            ) : (
              <Skeleton className="h-72 w-full" />
            )}
            {forecast && (
              <IntervalEvidence
                forecast={forecast}
                mode={mode}
                forecastThrough={forecastThrough}
                refreshAdvice={refreshAdvice}
              />
            )}
            <p className="mt-3 text-xs text-muted">
              {mode === "api"
                ? "Recorded sales and future estimates are shown separately."
                : "This chart uses sample data. Its shaded range is for demonstration only."}{" "}
              {DISCLAIMER}
            </p>
            {mode === "api" && (
              <details className="mt-3 text-sm text-muted">
                <summary className="cursor-pointer font-medium">How confidence is rated</summary>
                <p className="mt-2">
                  Confidence reflects past accuracy. High: up to 20% error. Medium: up to 50%. Both
                  require at least 14 consecutive tested days and some recorded sales. Low means
                  larger errors or limited test records. Future sales may differ.
                </p>
              </details>
            )}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Past forecast errors by product</CardTitle>
          <CardDescription>Lower error means closer estimates.</CardDescription>
          <Input
            aria-label="Search forecast errors"
            placeholder="Search by product name or SKU"
            value={errorSearch}
            onChange={(event) => setErrorSearch(event.target.value)}
          />
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {!ready ? (
            <Skeleton className="h-48 w-full" />
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="text-xs tracking-wide text-muted uppercase">
                <tr>
                  <th className="pb-2 font-medium">Product</th>
                  <th className="pb-2 font-medium">Sales days</th>
                  <th className="pb-2 font-medium">MA MAE</th>
                  <th className="pb-2 font-medium">XGB MAE</th>
                  <th className="pb-2 font-medium">Ens MAE</th>
                  <th className="pb-2 font-medium">Chosen method</th>
                  <th className="pb-2 font-medium">Past results</th>
                  <th className="pb-2 font-medium">Sales range</th>
                </tr>
              </thead>
              <tbody>
                {products
                  .filter((p) =>
                    `${p.name} ${p.sku}`.toLowerCase().includes(errorSearch.trim().toLowerCase()),
                  )
                  .map((p) => {
                    const f = result?.byProduct[p.id];
                    if (!f) return null;
                    return (
                      <tr key={p.id} className="border-t border-border">
                        <td className="py-2.5 pr-3">{p.name}</td>
                        <td className="tabular">{num(f.nonzeroCount)}</td>
                        <td className="tabular">{metric(f.maMae)}</td>
                        <td className="tabular">{metric(f.xgbMae)}</td>
                        <td className="tabular">{metric(f.ensembleMae)}</td>
                        <td>
                          <Badge variant={f.trainedWithMl ? "primary" : "default"}>
                            {modelLabel(f.method)}
                          </Badge>
                        </td>
                        <td className="min-w-48 py-2.5 pr-3">
                          {mode === "api" ? (
                            <DemandEvidence forecast={f} unavailableReason={f.unavailableReason} />
                          ) : (
                            <span className="text-xs text-muted">Synthetic demonstration</span>
                          )}
                        </td>
                        <td className="min-w-40 text-xs text-muted">
                          {intervalAvailability(f, mode)}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          )}
          {ready &&
            !products.some(
              (p) =>
                result?.byProduct[p.id] &&
                `${p.name} ${p.sku}`.toLowerCase().includes(errorSearch.trim().toLowerCase()),
            ) && <p className="pt-3 text-sm text-muted">No products match your search.</p>}
        </CardContent>
      </Card>
    </div>
  );
}

function ProductPicker({
  products,
  selected,
  disabled,
  onChange,
}: {
  products: Product[];
  selected?: Product;
  disabled?: boolean;
  onChange: (productId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const visibleProducts = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return products;
    return products.filter((product) =>
      `${product.name} ${product.sku}`.toLowerCase().includes(normalizedQuery),
    );
  }, [products, query]);

  return (
    <div className="relative w-full md:max-w-xs">
      <button
        type="button"
        className="flex h-11 w-full items-center justify-between rounded-lg border border-border bg-surface px-3 text-left text-sm text-fg outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-50"
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="truncate">{selected?.name ?? "No active products"}</span>
        <ChevronDown className="ml-2 size-4 shrink-0" aria-hidden="true" />
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-lg border border-border bg-surface p-2 shadow-lg">
          <Input
            autoFocus
            aria-label="Search forecast products"
            placeholder="Search products or SKU"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <div className="mt-2 max-h-60 overflow-y-auto" role="listbox">
            {visibleProducts.length ? (
              visibleProducts.map((product) => (
                <button
                  type="button"
                  role="option"
                  aria-selected={product.id === selected?.id}
                  key={product.id}
                  className="block w-full rounded-md px-3 py-2 text-left text-sm hover:bg-surface-2 aria-selected:bg-surface-2"
                  onClick={() => {
                    onChange(product.id);
                    setQuery("");
                    setOpen(false);
                  }}
                >
                  {product.name}
                </button>
              ))
            ) : (
              <p className="px-3 py-2 text-sm text-muted">No products match your search.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Score({
  name,
  mae,
  rmse,
  winner,
  note,
  ready,
}: {
  name: string;
  mae: number | undefined;
  rmse: number | undefined;
  winner: boolean;
  note: string;
  ready: boolean;
}) {
  return (
    <Card className={winner ? "border-primary/40" : undefined}>
      <CardContent className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs tracking-wide text-muted uppercase">{name}</p>
          {ready ? (
            <p className="mt-1 font-mono text-sm tabular">
              MAE {metric(mae)}
              <span className="mx-2 text-border">/</span>
              RMSE {metric(rmse)}
            </p>
          ) : (
            <Skeleton className="mt-2 h-5 w-40" />
          )}
          <p className="mt-1 text-xs text-muted">{note}</p>
        </div>
        {winner && <Badge variant="primary">Chosen method</Badge>}
      </CardContent>
    </Card>
  );
}
