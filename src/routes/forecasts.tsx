import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { DemandChart } from "@/components/demand-chart";
import { DemandEvidence } from "@/components/demand-evidence";
import { IntervalEvidence } from "@/components/interval-evidence";
import { useForecast } from "@/components/forecast-context";
import { TrainingBanner } from "@/components/training-banner";
import { ForecastTimingEvidence } from "@/components/forecast-timing-evidence";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { DISCLAIMER, modelLabel } from "@/lib/forecast/constants";
import { metric, num } from "@/lib/format";
import { intervalAvailability } from "@/lib/forecast-interval";
import { usePermissions } from "@/lib/permissions";
import { useAppStore } from "@/lib/store";
import type { ForecastPoint } from "@/lib/types";

export const Route = createFileRoute("/forecasts")({ component: ForecastsPage });

function ForecastsPage() {
  const catalog = useAppStore((s) => s.products);
  const products = useMemo(
    () => catalog.filter((product) => product.isActive !== false),
    [catalog],
  );
  const mode = useAppStore((s) => s.dataMode);
  const { canRefreshForecast } = usePermissions();
  const window = useAppStore((s) => s.settings.maWindow);
  const { result, status, refresh, forecastThrough } = useForecast();
  const ready = Boolean(result);
  const mlFirst =
    products.find((p) => result?.byProduct[p.id]?.trainedWithMl)?.id ?? products[0]?.id ?? "";
  const [productId, setProductId] = useState("");
  useEffect(() => {
    if (!productId && mlFirst) setProductId(mlFirst);
  }, [mlFirst, productId]);
  const selected =
    products.find((p) => p.id === productId) ??
    products.find((p) => p.id === mlFirst) ??
    products[0];
  const forecast = selected ? result?.byProduct[selected.id] : undefined;

  const chartPoints: ForecastPoint[] = useMemo(() => {
    if (!forecast) return [];
    return [...forecast.holdout, ...forecast.future];
  }, [forecast]);

  async function copyTable() {
    if (!result) return;
    const header = "Forecasting Model\tMAE\tRMSE";
    const lines = [
      `Moving Average\t${formatFixed(result.maMae)}\t${formatFixed(result.maRmse)}`,
      `XGBoost\t${formatFixed(result.xgbMae)}\t${formatFixed(result.xgbRmse)}`,
      `Ensemble\t${formatFixed(result.ensembleMae)}\t${formatFixed(result.ensembleRmse)}`,
    ];
    try {
      await navigator.clipboard.writeText([header, ...lines].join("\n"));
      toast.success("Copied MAE / RMSE table.");
    } catch {
      toast.error("Clipboard is blocked in this preview.");
    }
  }

  return (
    <div className="page-enter mx-auto flex max-w-6xl flex-col gap-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="font-display text-3xl font-medium tracking-tight">Forecast evaluation</h1>
          <p className="mt-2 max-w-2xl text-muted">
            {mode === "api"
              ? "Python XGBoost and Moving Average use separate chronological training, validation, and final-test periods. The operating method is selected on validation."
              : "Demonstration model evaluation using synthetic sales."}
          </p>
        </div>
        <div className="flex items-center gap-4">
          {canRefreshForecast && (
            <Button
              disabled={status === "training"}
              onClick={() => void refresh().catch((error: Error) => toast.error(error.message))}
            >
              {status === "training" ? "Forecast queued…" : "Refresh forecasts"}
            </Button>
          )}
          <button
            type="button"
            onClick={copyTable}
            disabled={!ready}
            className="text-sm font-medium text-primary underline-offset-4 hover:underline disabled:text-muted"
          >
            Copy MAE / RMSE table
          </button>
        </div>
      </header>

      <TrainingBanner />
      {mode === "api" && <ForecastTimingEvidence timing={result?.processingTiming} />}
      {!canRefreshForecast && (
        <p className="text-sm text-muted">The owner can refresh forecasts after records change.</p>
      )}

      <section className="grid gap-3 md:grid-cols-3">
        <Score
          name="Ensemble"
          mae={result?.ensembleMae}
          rmse={result?.ensembleRmse}
          winner={ready ? result?.winner === "ensemble" : false}
          note="Weighted by validation MAE"
          ready={ready}
        />
        <Score
          name="XGBoost"
          mae={result?.xgbMae}
          rmse={result?.xgbRmse}
          winner={ready ? result?.winner === "xgb" : false}
          note={
            mode === "api"
              ? "Official Python XGBoost · saved model"
              : "Prototype boosted-tree model"
          }
          ready={ready}
        />
        <Score
          name="Moving Average"
          mae={result?.maMae}
          rmse={result?.maRmse}
          winner={ready ? result?.winner === "ma" || result?.winner === "rule" : false}
          note={`${window}-day window baseline`}
          ready={ready}
        />
      </section>

      <Card>
        <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <CardTitle>{selected?.name ?? "Product"}</CardTitle>
            <CardDescription>
              {!forecast
                ? "No forecast yet"
                : !Number.isFinite(forecast.dailyDemand) && forecast.fallbackReason
                  ? forecast.fallbackReason
                  : `${modelLabel(forecast.method)} · daily demand ${num(forecast.dailyDemand, 1)} · ${forecast.grain} grain · ${forecast.nonzeroCount} non-zero days`}
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select
              className="md:max-w-xs"
              value={selected?.id}
              onChange={(e) => setProductId(e.target.value)}
            >
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
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
              intervalLabel={
                mode === "browser-demo"
                  ? "Illustrative demonstration band"
                  : forecast?.interval?.nominalCoverage !== undefined
                    ? `${num(forecast.interval.nominalCoverage * 100)}% nominal interval`
                    : "Saved prediction interval"
              }
            />
          ) : (
            <Skeleton className="h-72 w-full" />
          )}
          {forecast && (
            <IntervalEvidence forecast={forecast} mode={mode} forecastThrough={forecastThrough} />
          )}
          <p className="mt-3 text-xs text-muted">
            {mode === "api"
              ? "Actuals are from the final-test period. Baseline-only products display no XGBoost score. Shading appears only for saved interval bounds."
              : "Shaded demonstration bands are illustrative; their coverage has not been validated."}{" "}
            {result?.diagnostics.disclaimer ?? DISCLAIMER}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Per-product holdout errors</CardTitle>
          <CardDescription>
            Lower errors are better. Each product shows its data evidence and interval availability.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {!ready ? (
            <Skeleton className="h-48 w-full" />
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="text-xs tracking-wide text-muted uppercase">
                <tr>
                  <th className="pb-2 font-medium">Product</th>
                  <th className="pb-2 font-medium">Obs</th>
                  <th className="pb-2 font-medium">MA MAE</th>
                  <th className="pb-2 font-medium">XGB MAE</th>
                  <th className="pb-2 font-medium">Ens MAE</th>
                  <th className="pb-2 font-medium">Method</th>
                  <th className="pb-2 font-medium">Data evidence</th>
                  <th className="pb-2 font-medium">Interval</th>
                </tr>
              </thead>
              <tbody>
                {products.map((p) => {
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
        </CardContent>
      </Card>
    </div>
  );
}

function formatFixed(value: number): string {
  return Number.isFinite(value) ? value.toFixed(3) : "n/a";
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
        {winner && <Badge variant="primary">Better model</Badge>}
      </CardContent>
    </Card>
  );
}
