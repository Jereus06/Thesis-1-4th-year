import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowRight, CircleCheck, PackageMinus, Search, TriangleAlert, X } from "lucide-react";
import { useForecast } from "@/components/forecast-context";
import { ImportRefreshNotice } from "@/components/import-refresh-notice";
import { ReceiveStockDialog } from "@/components/receive-stock-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { quantity } from "@/lib/format";
import { buildLowStockAlerts } from "@/lib/inventory/low-stock";
import { usePermissions } from "@/lib/permissions";
import { useAppStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import type { SessionUser } from "@/lib/api";

type AlertFilter = "all" | "stockout" | "reorder";

export function LowStockPanel() {
  const products = useAppStore((state) => state.products);
  const session = useAppStore((state) => state.session);
  const stockRefreshError = useAppStore((state) => state.movementsError);
  const { rows, expired, error } = useForecast();
  const { canReceiveStock } = usePermissions();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<AlertFilter>("all");
  const [deliverySelection, setDeliverySelection] = useState<{
    productId: string;
    session: SessionUser | null;
  } | null>(null);
  const [deliveryOpen, setDeliveryOpen] = useState(false);
  const alerts = useMemo(
    () => buildLowStockAlerts(products, rows, expired),
    [products, rows, expired],
  );
  const activeCount = products.filter((product) => product.isActive !== false).length;
  const outCount = alerts.filter((alert) => alert.status === "stockout").length;
  const lowCount = alerts.length - outCount;
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return alerts.filter(
      (alert) =>
        (filter === "all" || alert.status === filter) &&
        [alert.product.name, alert.product.sku, alert.product.category].some((value) =>
          value.toLowerCase().includes(query),
        ),
    );
  }, [alerts, search, filter]);
  const deliveryProduct =
    deliverySelection?.session === session
      ? (products.find((product) => product.id === deliverySelection.productId) ?? null)
      : null;

  const summaries = [
    {
      value: "all",
      label: "All alerts",
      count: alerts.length,
      icon: TriangleAlert,
      color: "text-primary",
    },
    {
      value: "stockout",
      label: "Out of stock",
      count: outCount,
      icon: PackageMinus,
      color: "text-danger",
    },
    {
      value: "reorder",
      label: "Low stock",
      count: lowCount,
      icon: TriangleAlert,
      color: "text-warning",
    },
  ] as const;

  return (
    <section aria-label="Low stock" className="grid gap-5">
      <ImportRefreshNotice />
      {stockRefreshError && (
        <p role="status" className="text-sm text-warning">
          {stockRefreshError}
        </p>
      )}
      <div className="relative flex flex-wrap items-center justify-between gap-5 overflow-hidden rounded-3xl bg-primary p-5 text-primary-foreground sm:p-7">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-28 -right-14 size-80 rounded-full border border-white/10"
        />
        <div className="relative flex items-start gap-4">
          <span
            className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-white/10 text-white"
            aria-hidden="true"
          >
            <PackageMinus className="size-6" />
          </span>
          <div>
            <h2 className="font-display text-2xl font-medium tracking-tight sm:text-3xl">
              Low stock
            </h2>
            <p className="mt-2 max-w-lg text-sm text-white/75">
              See what needs attention, with empty shelves first.
            </p>
          </div>
        </div>
        <Button
          asChild
          variant="outline"
          className="relative gap-2 rounded-full border-white/20 bg-surface text-primary hover:bg-white focus-visible:ring-white/60"
        >
          <Link to="/restock">
            Open Restock <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-2 sm:gap-4" aria-label="Filter stock alerts">
        {summaries.map((summary) => (
          <button
            key={summary.value}
            type="button"
            aria-label={summary.label}
            aria-pressed={filter === summary.value}
            onClick={() => setFilter(summary.value)}
            className={cn(
              "min-w-0 rounded-2xl border bg-surface p-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary sm:p-5",
              filter === summary.value
                ? "border-primary bg-primary/5"
                : "border-border hover:bg-surface-2",
            )}
          >
            <summary.icon className={cn("mb-3 size-5", summary.color)} aria-hidden="true" />
            <p className="min-h-8 text-xs text-muted sm:min-h-0">{summary.label}</p>
            <p
              className={cn("mt-1 text-3xl font-medium tabular", summary.color)}
              data-testid={`low-stock-${summary.value}-count`}
            >
              {quantity(summary.count)}
            </p>
          </button>
        ))}
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border p-4 sm:px-6">
          <div className="relative w-full sm:max-w-sm">
            <Search
              className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted"
              aria-hidden="true"
            />
            <Input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              aria-label="Search low-stock products"
              placeholder="Search by name, SKU or category"
              className="rounded-xl pr-11 pl-10 [&::-webkit-search-cancel-button]:appearance-none"
            />
            {search && (
              <button
                type="button"
                aria-label="Clear low-stock search"
                onClick={() => setSearch("")}
                className="absolute top-1/2 right-1 flex size-9 -translate-y-1/2 items-center justify-center rounded-lg text-muted hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-primary"
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            )}
          </div>
          <p className="text-xs text-muted" aria-live="polite">
            Showing {quantity(filtered.length)} of {quantity(alerts.length)} alerts
          </p>
        </div>
        {filtered.length ? (
          <div className="record-scroll" tabIndex={0}>
            <table aria-label="Low-stock products" className="w-full text-left text-sm">
              <thead className="bg-surface-2/50 text-[11px] tracking-wide text-muted uppercase">
                <tr>
                  <th scope="col" className="px-5 py-3 font-medium sm:pl-6">
                    Product
                  </th>
                  <th scope="col" className="px-3 py-3 font-medium">
                    SKU
                  </th>
                  <th scope="col" className="px-4 py-3 text-center whitespace-nowrap font-medium">
                    Current quantity
                  </th>
                  <th scope="col" className="py-3 pr-3 pl-4 font-medium">
                    Unit
                  </th>
                  <th scope="col" className="px-5 py-3 text-center font-medium">
                    Threshold
                  </th>
                  <th scope="col" className="px-3 py-3 font-medium">
                    Status
                  </th>
                  {canReceiveStock && (
                    <th scope="col" className="px-5 py-3 font-medium">
                      Action
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {filtered.map((alert) => (
                  <tr
                    key={alert.product.id}
                    className="border-t border-border transition-colors hover:bg-surface-2/40"
                  >
                    <td className="px-5 py-4 sm:pl-6">
                      <p className="min-w-36 font-medium">{alert.product.name}</p>
                      <p className="mt-1 text-xs text-muted">{alert.product.category}</p>
                    </td>
                    <td className="px-3 py-4 text-xs whitespace-nowrap text-muted">
                      {alert.product.sku}
                    </td>
                    <td
                      className={cn(
                        "px-4 py-4 text-center font-medium tabular",
                        alert.status === "stockout" && "text-danger",
                      )}
                    >
                      {quantity(alert.product.currentStock)}
                    </td>
                    <td className="py-4 pr-3 pl-4 whitespace-nowrap text-muted">
                      {alert.product.unit}
                    </td>
                    <td className="px-5 py-4 text-center">
                      <div className="flex items-baseline justify-center gap-2 whitespace-nowrap">
                        <span className="font-medium tabular">{quantity(alert.threshold)}</span>
                        <span className="text-muted">{alert.product.unit}</span>
                      </div>
                      <p className="mt-1 text-[11px] whitespace-nowrap text-muted">
                        {alert.thresholdSource === "reorder_point"
                          ? "Reorder point"
                          : "Safety stock minimum"}
                      </p>
                    </td>
                    <td className="px-3 py-4 whitespace-nowrap">
                      <Badge variant={alert.status === "stockout" ? "danger" : "warning"}>
                        {alert.status === "stockout" ? "Out of stock" : "Low stock"}
                      </Badge>
                    </td>
                    {canReceiveStock && (
                      <td className="px-5 py-4">
                        <Button
                          variant="outline"
                          size="sm"
                          className="whitespace-nowrap"
                          onClick={() => {
                            setDeliverySelection({ productId: alert.product.id, session });
                            setDeliveryOpen(true);
                          }}
                        >
                          Record delivery
                        </Button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="flex flex-col items-center px-5 py-12 text-center">
            <span
              className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-primary/5 text-primary"
              aria-hidden="true"
            >
              {alerts.length ? <Search className="size-6" /> : <CircleCheck className="size-6" />}
            </span>
            <h3 className="font-display text-xl font-medium">
              {!activeCount
                ? "No active products"
                : alerts.length
                  ? "No matching alerts"
                  : "No stock alerts"}
            </h3>
            <p className="mt-2 max-w-sm text-sm text-muted">
              {!activeCount
                ? "Add or activate products in Inventory to monitor their stock."
                : alerts.length
                  ? "Try another search or show all alerts to see the affected products."
                  : "Every active product is above its stock threshold."}
            </p>
            {alerts.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                className="mt-5 rounded-full"
                onClick={() => {
                  setSearch("");
                  setFilter("all");
                }}
              >
                Show all alerts
              </Button>
            )}
          </div>
        )}
        {error && (
          <p
            role="status"
            className="border-t border-border px-5 py-4 text-xs text-warning sm:px-6"
          >
            Forecast estimates could not be refreshed. Stock alerts use the available thresholds
            shown above.
          </p>
        )}
      </div>
      <ReceiveStockDialog
        product={deliveryProduct}
        open={deliveryOpen && deliveryProduct !== null}
        onOpenChange={setDeliveryOpen}
      />
    </section>
  );
}
