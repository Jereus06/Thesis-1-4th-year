import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Clock3, PackageMinus, Scale, Wallet } from "lucide-react";
import { useForecast } from "@/components/forecast-context";
import { StatusBadge } from "@/components/status-badge";
import { TrainingBanner } from "@/components/training-banner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { AS_OF } from "@/lib/data/seed";
import { formatLong } from "@/lib/dates";
import { DISCLAIMER, modelLabel } from "@/lib/forecast/constants";
import { metric, num, peso } from "@/lib/format";
import { useAppStore } from "@/lib/store";

export const Route = createFileRoute("/")({ component: Overview });

function Overview() {
  const products = useAppStore((s) => s.products);
  const storeName = useAppStore((s) => s.settings.storeName);
  const { result, rows } = useForecast();
  const ready = Boolean(result);

  const restock = rows.filter((r) => r.status === "stockout" || r.status === "reorder");
  const stockouts = rows.filter((r) => r.status === "stockout");
  const inventoryValue = products.reduce((sum, p) => sum + p.currentStock * p.unitCost, 0);
  const winner = result ? modelLabel(result.winner) : "—";
  const winnerMae = result
    ? result.winner === "xgb"
      ? result.xgbMae
      : result.winner === "ensemble"
        ? result.ensembleMae
        : result.maMae
    : Number.NaN;

  return (
    <div className="page-enter mx-auto flex max-w-6xl flex-col gap-6">
      <header className="flex flex-col gap-2">
        <p className="text-xs font-medium tracking-widest text-muted uppercase">{formatLong(AS_OF)}</p>
        <h1 className="font-display text-2xl font-medium tracking-tight sm:text-3xl md:text-4xl">
          Morning briefing
          <span className="mt-1 block">for {storeName}</span>
        </h1>
        <p className="max-w-2xl text-muted">
          {!ready
            ? "Loading cached forecasts…"
            : restock.length
              ? `${restock.length} product${restock.length === 1 ? "" : "s"} should be reordered before supplier lead time catches you short.`
              : "Stock is above reorder points. Keep recording sales so the next forecast stays honest."}
        </p>
      </header>

      <TrainingBanner />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          icon={PackageMinus}
          label="Need restock"
          value={ready ? num(restock.length) : null}
          hint={stockouts.length ? `${stockouts.length} already at zero` : "Below reorder point"}
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
          value={ready ? metric(winnerMae) : null}
          hint="Same holdout for MA, XGBoost, and ensemble"
        />
        <Kpi
          icon={Clock3}
          label="Forecast horizon"
          value="14 days"
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
              <p className="text-sm text-muted">No urgent restocks. Healthy cover across the catalog.</p>
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
                  mae={result.ensembleMae}
                  rmse={result.ensembleRmse}
                  active={result.winner === "ensemble"}
                />
                <MetricBar
                  label="XGBoost"
                  mae={result.xgbMae}
                  rmse={result.xgbRmse}
                  active={result.winner === "xgb"}
                />
                <MetricBar
                  label="Moving Average"
                  mae={result.maMae}
                  rmse={result.maRmse}
                  active={result.winner === "ma" || result.winner === "rule"}
                />
                <p className="text-xs text-muted">{DISCLAIMER}</p>
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
}: {
  icon: typeof Wallet;
  label: string;
  value: string | null;
  hint: string;
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
          ) : (
            <p className="font-display text-2xl font-medium tracking-tight tabular">{value}</p>
          )}
          <p className="text-xs text-muted">{hint}</p>
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
