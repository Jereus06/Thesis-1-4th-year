import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState, type ReactNode } from "react";
import { ConfidenceBadge } from "@/components/confidence-badge";
import { DemandEvidence } from "@/components/demand-evidence";
import { useForecast } from "@/components/forecast-context";
import { ReceiveStockDialog } from "@/components/receive-stock-dialog";
import { StatusBadge } from "@/components/status-badge";
import { TrainingBanner } from "@/components/training-banner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { DISCLAIMER, modelLabel } from "@/lib/forecast/constants";
import { num } from "@/lib/format";
import { forecastRefreshAdvice } from "@/lib/forecast-schedule";
import { usePermissions } from "@/lib/permissions";
import { useAppStore } from "@/lib/store";
import type { ProductForecast, ReorderRow } from "@/lib/types";

export const Route = createFileRoute("/restock")({ component: RestockPage });

function hasCurrentDemand(row: ReorderRow): boolean {
  return (
    row.demandAvailable !== false &&
    !row.forecastExpired &&
    Number.isFinite(row.dailyDemand) &&
    row.dailyDemand >= 0
  );
}

function RestockPage() {
  const { rows, result, schedule } = useForecast();
  const mode = useAppStore((state) => state.dataMode);
  const catalog = useAppStore((state) => state.products);
  const products = useMemo(
    () => catalog.filter((product) => product.isActive !== false),
    [catalog],
  );
  const { canReceiveStock, canRefreshForecast, canManageProducts } = usePermissions();
  const refreshAdvice = forecastRefreshAdvice(mode, canRefreshForecast, schedule);
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const selected = rows.find((row) => row.product.id === selectedProductId) ?? null;
  const [open, setOpen] = useState(false);
  const ready = Boolean(result);
  const missing = products.filter((product) => !rows.some((row) => row.product.id === product.id));

  const groups = useMemo(() => {
    return {
      action: rows.filter(
        (row) => hasCurrentDemand(row) && (row.status === "stockout" || row.status === "reorder"),
      ),
      watch: rows.filter(
        (row) => hasCurrentDemand(row) && row.dailyDemand > 0 && row.status === "watch",
      ),
      healthy: rows.filter(
        (row) => hasCurrentDemand(row) && row.dailyDemand > 0 && row.status === "healthy",
      ),
      zero: rows.filter(
        (row) =>
          hasCurrentDemand(row) &&
          row.dailyDemand === 0 &&
          row.status !== "stockout" &&
          row.status !== "reorder",
      ),
      unavailable: rows.filter((row) => !hasCurrentDemand(row)),
    };
  }, [rows]);

  function openReceive(row: ReorderRow) {
    if (!canReceiveStock || row.product.isActive === false) return;
    setSelectedProductId(row.product.id);
    setOpen(true);
  }
  function renderRow(row: ReorderRow) {
    return (
      <RestockCard
        key={row.product.id}
        row={row}
        forecast={result?.byProduct[row.product.id]}
        canReceiveStock={canReceiveStock}
        refreshAdvice={refreshAdvice}
        onReceive={() => openReceive(row)}
      />
    );
  }

  return (
    <div className="page-enter mx-auto flex max-w-6xl flex-col gap-6">
      <header>
        <h1 className="font-display text-3xl font-medium tracking-tight">
          Restocking recommendations
        </h1>
        <p className="mt-2 max-w-2xl text-muted">
          ROP = (average forecasted daily demand × supplier lead time) + safety stock. Suggested
          quantities apply when stock reaches the reorder point.
        </p>
        <p className="mt-2 text-xs text-muted">{result?.diagnostics.disclaimer ?? DISCLAIMER}</p>
      </header>
      <TrainingBanner />
      {!ready ? (
        <div className="grid gap-3">
          <Skeleton className="h-36" />
          <Skeleton className="h-36" />
        </div>
      ) : products.length === 0 ? (
        <p className="text-sm text-muted">
          {canManageProducts
            ? "No active products to assess. Add or activate products in Inventory before reviewing restocking recommendations."
            : "No active products to assess. Ask the owner to add or activate products."}
        </p>
      ) : (
        <>
          {missing.length > 0 && (
            <section className="space-y-3">
              <h2 className="font-display text-xl font-medium">Waiting for demand estimates</h2>
              <p className="text-sm text-muted">
                Current recommendations are not available for these products. Review their sales
                history and {refreshAdvice}. Actual deliveries can still be recorded in Inventory.
              </p>
              {missing.map((product) => (
                <div key={product.id} className="rounded-xl border border-border p-3">
                  <p className="text-sm font-medium">{product.name}</p>
                  <DemandEvidence forecast={result?.byProduct[product.id]} />
                </div>
              ))}
            </section>
          )}
          <Section title="Order now" empty="No current reorder recommendations.">
            {groups.action.map(renderRow)}
          </Section>
          <Section title="Watch list" empty="No items with positive demand in the watch band.">
            {groups.watch.map(renderRow)}
          </Section>
          <Section
            title="Healthy stock"
            empty="No products with positive demand are marked healthy."
          >
            {groups.healthy.map(renderRow)}
          </Section>
          <Section title="Zero usable demand" empty="No current estimates show zero demand.">
            {groups.zero.map(renderRow)}
          </Section>
          <Section
            title="Demand unavailable"
            empty={
              missing.length
                ? "Other products are waiting for a current demand estimate."
                : "No products are marked as having unavailable demand."
            }
          >
            {groups.unavailable.map(renderRow)}
          </Section>
        </>
      )}
      <ReceiveStockDialog
        product={selected?.product ?? null}
        row={selected}
        open={open}
        onOpenChange={setOpen}
      />
    </div>
  );
}

function Section({
  title,
  empty,
  children,
}: {
  title: string;
  empty: string;
  children: ReactNode;
}) {
  const items = Array.isArray(children) ? children : [children];
  const has = items.filter(Boolean).length > 0;
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-display text-xl font-medium">{title}</h2>
      {has ? (
        <div className="grid gap-3">{items}</div>
      ) : (
        <p className="text-sm text-muted">{empty}</p>
      )}
    </section>
  );
}

function RestockCard({
  row,
  forecast,
  onReceive,
  canReceiveStock,
  refreshAdvice,
}: {
  row: ReorderRow;
  forecast?: ProductForecast;
  onReceive: () => void;
  canReceiveStock: boolean;
  refreshAdvice: string;
}) {
  const p = row.product;
  const available = hasCurrentDemand(row);
  const zeroDemand = available && row.dailyDemand === 0;
  return (
    <Card>
      <CardContent className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium">{p.name}</p>
            {!available ? (
              <>
                <Badge variant="warning">
                  {row.forecastExpired ? "Expired forecast" : "Demand unavailable"}
                </Badge>
                {p.currentStock <= 0 && <StatusBadge status="stockout" />}
              </>
            ) : (
              <>
                {(!zeroDemand || row.status === "stockout" || row.status === "reorder") && (
                  <StatusBadge status={row.status} />
                )}
                {zeroDemand && <Badge variant="outline">Zero usable demand</Badge>}
              </>
            )}
            <ConfidenceBadge level={row.confidence} />
          </div>
          <p className="text-sm text-muted">
            {p.sku} · {p.category} · lead {p.leadTimeDays}d · safety {num(p.safetyStock)}
            {available && ` · ${modelLabel(row.winnerModel)} demand`}
          </p>
          {zeroDemand && (
            <p className="text-sm text-muted">
              Usable observations show zero demand. Days of cover cannot be calculated from a zero
              estimate.
            </p>
          )}
          <DemandEvidence
            forecast={forecast}
            unavailableReason={
              !available
                ? (row.unavailableReason ??
                  forecast?.unavailableReason ??
                  (row.forecastExpired
                    ? `The saved forecast period has ended. Review recent sales and ${refreshAdvice}.`
                    : "No usable demand estimate is available. Review sales history and data quality."))
                : undefined
            }
            fallbackReason={row.fallbackReason}
            unknownDays={row.unknownDays}
            excludedDays={row.excludedDays}
            qualityWarnings={row.qualityWarnings}
          />
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 pt-2 text-sm sm:grid-cols-4">
            <Stat label="On hand" value={`${num(p.currentStock)} ${p.unit}`} />
            <Stat label="Daily demand" value={available ? num(row.dailyDemand, 1) : "—"} />
            <Stat
              label="Reorder point"
              value={available ? num(Math.ceil(row.reorderPoint)) : "—"}
            />
            <Stat
              label="Days of cover"
              value={available && !zeroDemand ? num(row.daysOfCover, 1) : "—"}
            />
          </dl>
        </div>
        <div className="flex shrink-0 flex-col items-stretch gap-2 sm:items-end">
          <p className="text-right">
            <span className="block text-xs tracking-wide text-muted uppercase">
              Recommended qty
            </span>
            <span className="font-display text-3xl font-medium tabular">
              {available ? num(row.reorderQty) : "—"}
            </span>
          </p>
          {canReceiveStock && p.isActive !== false && (
            <Button
              onClick={onReceive}
              variant={available && row.reorderQty > 0 ? "default" : "outline"}
            >
              Record delivery
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="tabular">{value}</dd>
    </div>
  );
}
