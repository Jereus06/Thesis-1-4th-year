import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ConfidenceBadge } from "@/components/confidence-badge";
import { DemandChart } from "@/components/demand-chart";
import { useForecast } from "@/components/forecast-context";
import { TrainingBanner } from "@/components/training-banner";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { DISCLAIMER, modelLabel } from "@/lib/forecast/constants";
import { metric, num } from "@/lib/format";
import { useAppStore } from "@/lib/store";
import type { ForecastPoint } from "@/lib/types";

export const Route = createFileRoute("/forecasts")({ component: ForecastsPage });

function ForecastsPage() {
  const products = useAppStore((s) => s.products);
  const { result, status } = useForecast();
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
            Chronological holdout. XGBoost uses a short feature set (no product IDs). The operational
            line is the validation-weighted ensemble unless XGBoost is unstable.
          </p>
        </div>
        <button
          type="button"
          onClick={copyTable}
          disabled={!ready}
          className="text-sm font-medium text-primary underline-offset-4 hover:underline disabled:text-muted"
        >
          Copy MAE / RMSE table
        </button>
      </header>

      <TrainingBanner />

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
          note={ready ? `${result?.treesUsed} trees after early stopping` : "Background fit"}
          ready={ready}
        />
        <Score
          name="Moving Average"
          mae={result?.maMae}
          rmse={result?.maRmse}
          winner={ready ? result?.winner === "ma" || result?.winner === "rule" : false}
          note="7-day window baseline"
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
                : `${modelLabel(forecast.method)} · daily demand ${num(forecast.dailyDemand, 1)} · ${forecast.grain} grain · ${forecast.nonzeroCount} non-zero days`}
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {forecast && (
              <ConfidenceBadge level={forecast.confidence} score={forecast.confidenceScore} />
            )}
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
          {ready ? (
            <DemandChart points={chartPoints} />
          ) : (
            <Skeleton className="h-72 w-full" />
          )}
          <p className="mt-3 text-xs text-muted">
            Shaded band is the 10th–90th percentile interval. Ink is actual holdout demand.{" "}
            {DISCLAIMER}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Per-product holdout errors</CardTitle>
          <CardDescription>
            Lower is better. Low-confidence and rule-based SKUs are called out instead of hidden.
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
                  <th className="pb-2 font-medium">Confidence</th>
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
                      <td>
                        <ConfidenceBadge level={f.confidence} />
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
