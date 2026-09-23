import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState, type ReactNode } from "react";
import { ConfidenceBadge } from "@/components/confidence-badge";
import { useForecast } from "@/components/forecast-context";
import { ReceiveStockDialog } from "@/components/receive-stock-dialog";
import { StatusBadge } from "@/components/status-badge";
import { TrainingBanner } from "@/components/training-banner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { DISCLAIMER, modelLabel } from "@/lib/forecast/constants";
import { num } from "@/lib/format";
import type { ReorderRow } from "@/lib/types";

export const Route = createFileRoute("/restock")({ component: RestockPage });

function RestockPage() {
  const { rows, result } = useForecast();
  const [selected, setSelected] = useState<ReorderRow | null>(null);
  const [open, setOpen] = useState(false);
  const ready = Boolean(result);

  const groups = useMemo(() => {
    return {
      action: rows.filter((r) => r.status === "stockout" || r.status === "reorder"),
      watch: rows.filter((r) => r.status === "watch"),
      healthy: rows.filter((r) => r.status === "healthy"),
    };
  }, [rows]);

  function openReceive(row: ReorderRow) {
    setSelected(row);
    setOpen(true);
  }

  return (
    <div className="page-enter mx-auto flex max-w-6xl flex-col gap-6">
      <header>
        <h1 className="font-display text-3xl font-medium tracking-tight">Restocking recommendations</h1>
        <p className="mt-2 max-w-2xl text-muted">
          ROP = (average forecasted daily demand × supplier lead time) + safety stock. Top sellers
          use the ensemble; slow movers use a simple reorder rule.
        </p>
        <p className="mt-2 text-xs text-muted">{DISCLAIMER}</p>
      </header>

      <TrainingBanner />

      {!ready ? (
        <div className="grid gap-3">
          <Skeleton className="h-36" />
          <Skeleton className="h-36" />
        </div>
      ) : (
        <>
          <Section title="Order now" empty="Nothing is at or below reorder point.">
            {groups.action.map((row) => (
              <RestockCard key={row.product.id} row={row} onReceive={() => openReceive(row)} />
            ))}
          </Section>
          <Section title="Watch list" empty="No items in the watch band.">
            {groups.watch.map((row) => (
              <RestockCard key={row.product.id} row={row} onReceive={() => openReceive(row)} />
            ))}
          </Section>
          <Section title="Healthy stock" empty="No healthy items yet.">
            {groups.healthy.map((row) => (
              <RestockCard key={row.product.id} row={row} onReceive={() => openReceive(row)} />
            ))}
          </Section>
        </>
      )}

      <ReceiveStockDialog row={selected} open={open} onOpenChange={setOpen} />
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
      {has ? <div className="grid gap-3">{items}</div> : <p className="text-sm text-muted">{empty}</p>}
    </section>
  );
}

function RestockCard({ row, onReceive }: { row: ReorderRow; onReceive: () => void }) {
  const p = row.product;
  return (
    <Card>
      <CardContent className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium">{p.name}</p>
            <StatusBadge status={row.status} />
            <ConfidenceBadge level={row.confidence} />
          </div>
          <p className="text-sm text-muted">
            {p.sku} · {p.category} · lead {p.leadTimeDays}d · safety {num(p.safetyStock)} ·{" "}
            {modelLabel(row.winnerModel)} demand
          </p>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 pt-2 text-sm sm:grid-cols-4">
            <Stat label="On hand" value={`${num(p.currentStock)} ${p.unit}`} />
            <Stat label="Daily demand" value={num(row.dailyDemand, 1)} />
            <Stat label="Reorder point" value={num(Math.ceil(row.reorderPoint))} />
            <Stat label="Days of cover" value={num(row.daysOfCover, 1)} />
          </dl>
        </div>
        <div className="flex shrink-0 flex-col items-stretch gap-2 sm:items-end">
          <p className="text-right">
            <span className="block text-xs tracking-wide text-muted uppercase">Recommended qty</span>
            <span className="font-display text-3xl font-medium tabular">{num(row.reorderQty)}</span>
          </p>
          <Button
            onClick={onReceive}
            disabled={row.reorderQty <= 0}
            variant={row.reorderQty > 0 ? "default" : "outline"}
          >
            Record delivery
          </Button>
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
