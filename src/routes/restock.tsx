import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState, type ReactNode } from "react";
import { ForecastEvidenceBadge } from "@/components/forecast-evidence-badge";
import { DemandEvidence } from "@/components/demand-evidence";
import { useForecast } from "@/components/forecast-context";
import { ReceiveStockDialog } from "@/components/receive-stock-dialog";
import { StatusBadge } from "@/components/status-badge";
import { TrainingBanner } from "@/components/training-banner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { num } from "@/lib/format";
import { forecastRefreshAdvice } from "@/lib/forecast-schedule";
import { usePermissions } from "@/lib/permissions";
import { useAppStore } from "@/lib/store";
import type { SessionUser } from "@/lib/api";
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
  const session = useAppStore((state) => state.session);
  const products = useMemo(
    () => catalog.filter((product) => product.isActive !== false),
    [catalog],
  );
  const { canReceiveStock, canRefreshForecast, canManageProducts } = usePermissions();
  const refreshAdvice = forecastRefreshAdvice(mode, canRefreshForecast, schedule);
  const [deliverySelection, setDeliverySelection] = useState<{
    row: ReorderRow;
    session: SessionUser | null;
  } | null>(null);
  const selected =
    deliverySelection?.session === session
      ? (rows.find((row) => row.product.id === deliverySelection.row.product.id) ??
        deliverySelection.row)
      : null;
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
    setDeliverySelection({ row, session });
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
              <h2 className="font-display text-xl font-medium">Waiting for sales estimates</h2>
              <p className="text-sm text-muted">
                Check these products' sales records and {refreshAdvice}. You can still record
                deliveries in Inventory.
              </p>
              {missing.map((product) => (
                <div key={product.id} className="rounded-xl border border-border p-3">
                  <p className="text-sm font-medium">{product.name}</p>
                  <DemandEvidence forecast={result?.byProduct[product.id]} compact />
                </div>
              ))}
            </section>
          )}
          <Section title="Order now" empty="No products are currently listed for ordering.">
            {groups.action.map(renderRow)}
          </Section>
          <Section title="Watch list" empty="No products are getting low on stock.">
            {groups.watch.map(renderRow)}
          </Section>
          <Section title="Enough stock" empty="No products are in this group.">
            {groups.healthy.map(renderRow)}
          </Section>
          <Section title="No sales expected" empty="No products are in this group.">
            {groups.zero.map(renderRow)}
          </Section>
          <Section
            title="Sales estimate unavailable"
            empty={
              missing.length
                ? "Other products are waiting for a sales estimate."
                : "No products are in this group."
            }
          >
            {groups.unavailable.map(renderRow)}
          </Section>
        </>
      )}
      <ReceiveStockDialog
        product={selected?.product ?? null}
        row={selected}
        open={open && selected !== null}
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
  const mode = useAppStore((s) => s.dataMode);
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
                  {row.forecastExpired ? "Expired forecast" : "Sales estimate unavailable"}
                </Badge>
                {p.currentStock <= 0 && <StatusBadge status="stockout" />}
              </>
            ) : (
              <>
                {(!zeroDemand || row.status === "stockout" || row.status === "reorder") && (
                  <StatusBadge status={row.status} />
                )}
                {zeroDemand && <Badge variant="outline">No sales expected</Badge>}
              </>
            )}
            {(available || mode === "browser-demo") && (
              <ForecastEvidenceBadge
                evidence={row.forecastEvidence}
                confidence={row.forecastConfidence}
                demonstration={mode === "browser-demo"}
              />
            )}
          </div>
          <p className="text-sm text-muted">
            {p.sku} · {p.category}
          </p>
          {zeroDemand && (
            <p className="text-sm text-muted">
              The current estimate is zero sales. We cannot estimate how long this stock may last.
            </p>
          )}
          <DemandEvidence
            compact
            forecast={forecast}
            forecastEvidence={row.forecastEvidence}
            forecastConfidence={row.forecastConfidence}
            unavailableReason={
              !available
                ? (row.unavailableReason ??
                  forecast?.unavailableReason ??
                  (row.forecastExpired
                    ? `The saved forecast period has ended. Review recent sales and ${refreshAdvice}.`
                    : "No sales estimate yet. Check the sales records and review missing days."))
                : undefined
            }
            fallbackReason={row.fallbackReason}
            unknownDays={row.unknownDays}
            excludedDays={row.excludedDays}
            qualityWarnings={row.qualityWarnings}
          />
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 pt-2 text-sm sm:grid-cols-4">
            <Stat label="Stock on hand" value={`${num(p.currentStock)} ${p.unit}`} />
            <Stat label="Expected daily sales" value={available ? num(row.dailyDemand, 1) : "—"} />
            <Stat
              label="Order when stock reaches"
              value={available ? num(Math.ceil(row.reorderPoint)) : "—"}
            />
            <Stat
              label="Days stock may last"
              value={available && !zeroDemand ? num(row.daysOfCover, 1) : "—"}
            />
          </dl>
        </div>
        <div className="flex shrink-0 flex-col items-stretch gap-2 sm:items-end">
          <p className="text-right">
            <span className="block text-xs tracking-wide text-muted uppercase">
              Suggested order
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
