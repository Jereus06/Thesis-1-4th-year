import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { DemandChart } from "@/components/demand-chart";
import { DemandEvidence } from "@/components/demand-evidence";
import { ForecastEvidenceBadge } from "@/components/forecast-evidence-badge";
import { IntervalEvidence } from "@/components/interval-evidence";
import { useForecast } from "@/components/forecast-context";
import { TrainingBanner } from "@/components/training-banner";
import { ForecastTimingEvidence } from "@/components/forecast-timing-evidence";
import { TopForecastProducts } from "@/components/top-forecast-products";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { DISCLAIMER, modelLabel } from "@/lib/forecast/constants";
import { metric, num } from "@/lib/format";
import { intervalAvailability } from "@/lib/forecast-interval";
import { forecastRefreshAdvice, forecastScheduleMessage } from "@/lib/forecast-schedule";
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
  const configuredLimit = useAppStore((s) => s.settings.topNProducts);
  const { result, status, refresh, forecastThrough, schedule } = useForecast();
  const refreshAdvice = forecastRefreshAdvice(mode, canRefreshForecast, schedule);
  const ready = Boolean(result);
  const [productId, setProductId] = useState("");
  const selected = products.find((p) => p.id === productId);
  const forecast = selected ? result?.byProduct[selected.id] : undefined;
  const scores = selected ? forecast : result;
  const winnerAvailable = selected
    ? Boolean(
        forecast &&
        Number.isFinite(forecast.cvMaeMa) &&
        (!forecast.trainedWithMl || Number.isFinite(forecast.cvMaeXgb)),
      )
    : result?.diagnostics.comparisonWinnerAvailable !== false;

  const chartPoints: ForecastPoint[] = useMemo(() => {
    if (!forecast) return [];
    return [...forecast.holdout, ...forecast.future];
  }, [forecast]);

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
      {mode === "api" && <ForecastTimingEvidence timing={result?.processingTiming} />}
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

      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <p className="font-medium">{selected?.name ?? "Overall results"}</p>
        <Select
          id="forecast-results"
          aria-label="Forecast results"
          className="md:max-w-xs"
          value={selected?.id ?? ""}
          onChange={(e) => setProductId(e.target.value)}
        >
          <option value="">Overall results</option>
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
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
          note={`Uses the previous ${window} days of sales`}
          ready={ready}
        />
      </section>
      {mode === "api" && ready && (
        <p className="text-sm text-muted">
          {selected
            ? `Past test results for ${selected.name}.`
            : result?.diagnostics.comparisonObservationCount
              ? `Past tests cover ${num(result.diagnostics.comparisonObservationCount)} daily results across ${num(result.diagnostics.comparisonProductCount ?? 0)} products, using the same sales records.`
              : "Matching past test results are not available. A dash means no saved score."}{" "}
          MAE shows average error; RMSE highlights larger mistakes. Lower is better. The chosen
          method comes from an earlier, separate check.
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
                ? "The chart compares past estimates with recorded sales and shows upcoming estimates."
                : "This chart uses sample data. Its shaded range is for demonstration only."}{" "}
              {DISCLAIMER}
            </p>
            {mode === "api" && (
              <details className="mt-3 text-sm text-muted">
                <summary className="cursor-pointer font-medium">How confidence is rated</summary>
                <p className="mt-2">
                  Confidence describes past forecasting results, not how much a product will sell.
                  High means total error was at most 20% of recorded sales; Medium means at most
                  50%. Both need at least 14 tested days in a row with some sales. Low means larger
                  errors or too few usable test results. These ratings do not guarantee future
                  sales. The error percentage adds up all prediction differences and divides that
                  total by recorded sales.
                </p>
              </details>
            )}
          </CardContent>
        </Card>
      ) : products.length > 0 ? (
        <p className="text-sm text-muted">
          Choose a product above to see its own results and sales chart.
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Past forecast errors by product</CardTitle>
          <CardDescription>
            Average differences between estimated and recorded sales. Smaller numbers mean closer
            estimates.
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
