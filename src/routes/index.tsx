import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Clock3, PackageMinus, Scale, Wallet } from "lucide-react";
import { useMemo, type ReactNode } from "react";
import { useForecast } from "@/components/forecast-context";
import { StatusBadge } from "@/components/status-badge";
import { TrainingBanner } from "@/components/training-banner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { DISCLAIMER, modelLabel } from "@/lib/forecast/constants";
import { hasMixedUnits } from "@/lib/forecast/metrics";
import { metric, num, peso } from "@/lib/format";
import { forecastRefreshAdvice } from "@/lib/forecast-schedule";
import { usePermissions } from "@/lib/permissions";
import { useAppStore } from "@/lib/store";
import type { ReorderRow } from "@/lib/types";

export const Route = createFileRoute("/")({ component: Overview });

function hasCurrentDemand(row: ReorderRow): boolean {
  return (
    row.demandAvailable !== false &&
    !row.forecastExpired &&
    Number.isFinite(row.dailyDemand) &&
    row.dailyDemand >= 0
  );
}

function Overview() {
  const mode = useAppStore((s) => s.dataMode);
  const catalog = useAppStore((s) => s.products);
  const products = useMemo(
    () => catalog.filter((product) => product.isActive !== false),
    [catalog],
  );
  const { canManageProducts, canRefreshForecast } = usePermissions();
  const storeName = useAppStore((s) => s.settings.storeName);
  const forecastHorizon = useAppStore((s) => s.settings.forecastHorizon);
  const { result, rows, expired, schedule } = useForecast();
  const refreshAdvice = forecastRefreshAdvice(mode, canRefreshForecast, schedule);
  const ready = Boolean(result);
  const mixedUnits =
    result?.diagnostics.comparisonMixedUnits ??
    (mode === "browser-demo" &&
      hasMixedUnits(products.filter((product) => result?.byProduct[product.id])));

  const available = rows.filter((row) => !expired && hasCurrentDemand(row));
  const restock = available.filter((row) => row.status === "stockout" || row.status === "reorder");
  const unavailable = rows.filter((row) => expired || !hasCurrentDemand(row));
  const missing = products.filter((product) => !rows.some((row) => row.product.id === product.id));
  const unavailableCount = unavailable.length + missing.length;
  const zeroDemand = available.filter((row) => row.dailyDemand === 0);
  const stockouts = rows.filter((r) => r.status === "stockout");
  const inventoryValue = products.reduce((sum, p) => sum + p.currentStock * p.unitCost, 0);
  const winner = result ? modelLabel(result.winner) : "—";
  const winnerMae =
    result && !mixedUnits
      ? result.winner === "xgb"
        ? result.xgbMae
        : result.winner === "ensemble"
          ? result.ensembleMae
          : result.maMae
      : Number.NaN;

  return (
    <div className="page-enter mx-auto flex max-w-6xl flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-2xl font-medium tracking-tight sm:text-3xl md:text-4xl">
          Morning briefing
          <span className="mt-1 block">for {storeName}</span>
        </h1>
      </header>

      <TrainingBanner />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          icon={PackageMinus}
          label="Need restock"
          value={ready ? num(restock.length) : null}
          hint={
            stockouts.length
              ? `${stockouts.length} already at zero`
              : unavailableCount
                ? `${unavailableCount} without current demand`
                : "Below reorder point"
          }
        />
        <Kpi
          icon={Wallet}
          label="Inventory value"
          value={peso(inventoryValue)}
          hint={`${products.length} SKUs on the shelf`}
        />
        <Kpi
          icon={Scale}
          label={ready ? `${winner} MAE` : "Holdout MAE"}
          value={ready ? (Number.isFinite(winnerMae) ? metric(winnerMae) : "") : null}
          hint={
            mixedUnits
              ? "Choose a product in Forecasts to see its score"
              : "Same holdout for MA, XGBoost, and ensemble"
          }
          action={
            <Button size="sm" className="mt-2 h-7 gap-1 px-2 text-xs" asChild>
              <Link to="/forecasts">
                Forecasts <ArrowRight className="size-3" aria-hidden="true" />
              </Link>
            </Button>
          }
        />
        <Kpi
          icon={Clock3}
          label="Forecast horizon"
          value={`${forecastHorizon} days`}
          hint={
            result
              ? `${result.diagnostics.trainedProductCount} ML SKUs · top ${result.diagnostics.topN}`
              : "Serving"
          }
        />
      </section>

      <section className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-3">
            <div>
              <CardTitle>Restock queue</CardTitle>
              <CardDescription>
                Reorder point = forecasted demand during lead time + safety stock.
              </CardDescription>
            </div>
            <Button variant="ghost" size="sm" asChild>
              <Link to="/restock">
                View all <ArrowRight className="size-4" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {!ready && (
              <div className="grid gap-2">
                <Skeleton className="h-14" />
                <Skeleton className="h-14" />
                <Skeleton className="h-14" />
              </div>
            )}
            {ready &&
              restock.slice(0, 6).map((row) => (
                <div
                  key={row.product.id}
                  className="flex items-center justify-between gap-3 rounded-xl bg-surface-2 px-3 py-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{row.product.name}</p>
                    <p className="text-xs text-muted">
                      On hand {num(row.product.currentStock)} {row.product.unit} · ROP{" "}
                      {num(Math.ceil(row.reorderPoint))} · order {num(row.reorderQty)}
                    </p>
                  </div>
                  <StatusBadge status={row.status} />
                </div>
              ))}
            {ready && restock.length === 0 && (
              <p className="text-sm text-muted">
                {products.length === 0
                  ? canManageProducts
                    ? "No active products to assess. Add or activate inventory and record sales history."
                    : "No active products to assess. Ask the owner to add or activate products."
                  : expired
                    ? `Saved predictions have expired. Review recent sales and ${refreshAdvice} before using reorder advice.`
                    : unavailableCount
                      ? "Current reorder advice is unavailable for part of the catalog. Check Forecasts before planning restocks."
                      : zeroDemand.length === available.length && available.length > 0
                        ? "Usable observations show zero demand. Days of cover cannot be calculated from a zero estimate."
                        : "No current reorder recommendations. Check the watch list before planning purchases."}
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Model comparison</CardTitle>
            <CardDescription>XGBoost is not assumed to win.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!ready || !result ? (
              <div className="grid gap-3">
                <Skeleton className="h-16" />
                <Skeleton className="h-16" />
              </div>
            ) : (
              <>
                <MetricBar
                  label="Ensemble"
                  mae={mixedUnits ? NaN : result.ensembleMae}
                  rmse={mixedUnits ? NaN : result.ensembleRmse}
                  active={
                    !mixedUnits &&
                    result.diagnostics.comparisonWinnerAvailable !== false &&
                    result.winner === "ensemble"
                  }
                />
                <MetricBar
                  label="XGBoost"
                  mae={mixedUnits ? NaN : result.xgbMae}
                  rmse={mixedUnits ? NaN : result.xgbRmse}
                  active={
                    !mixedUnits &&
                    result.diagnostics.comparisonWinnerAvailable !== false &&
                    result.winner === "xgb"
                  }
                />
                <MetricBar
                  label="Moving Average"
                  mae={mixedUnits ? NaN : result.maMae}
                  rmse={mixedUnits ? NaN : result.maRmse}
                  active={
                    !mixedUnits &&
                    result.diagnostics.comparisonWinnerAvailable !== false &&
                    (result.winner === "ma" || result.winner === "rule")
                  }
                />
                {mixedUnits && (
                  <p className="text-xs text-muted">
                    Products use different units. Choose a product in Forecasts to see its MAE and
                    RMSE.
                  </p>
                )}
                <p className="text-xs text-muted">{result?.diagnostics.disclaimer ?? DISCLAIMER}</p>
              </>
            )}
            <Button variant="outline" asChild className="w-full">
              <Link to="/forecasts">Open forecast charts</Link>
            </Button>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

function Kpi({
  icon: Icon,
  label,
  value,
  hint,
  action,
}: {
  icon: typeof Wallet;
  label: string;
  value: string | null;
  hint: string;
  action?: ReactNode;
}) {
  return (
    <Card>
      <CardContent className="flex items-start gap-3">
        <span className="mt-0.5 rounded-lg bg-surface-2 p-2 text-primary">
          <Icon className="size-4" />
        </span>
        <div className="min-w-0">
          <p className="text-xs tracking-wide text-muted uppercase">{label}</p>
          {value == null ? (
            <Skeleton className="mt-2 h-8 w-24" />
          ) : value ? (
            <p className="font-display text-2xl font-medium tracking-tight tabular">{value}</p>
          ) : null}
          <p className="text-xs text-muted">{hint}</p>
          {action}
        </div>
      </CardContent>
    </Card>
  );
}

function MetricBar({
  label,
  mae,
  rmse,
  active,
}: {
  label: string;
  mae: number;
  rmse: number;
  active: boolean;
}) {
  return (
    <div
      className={
        active
          ? "rounded-xl border border-primary/30 bg-primary/5 p-3"
          : "rounded-xl border border-border bg-surface p-3"
      }
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">{label}</p>
        {active && <span className="text-xs font-medium text-primary">Selected</span>}
      </div>
      <p className="mt-1 font-mono text-sm text-muted tabular">
        MAE {metric(mae)} · RMSE {metric(rmse)}
      </p>
    </div>
  );
}
