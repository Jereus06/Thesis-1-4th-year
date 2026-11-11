import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CalendarRange, ChevronDown, FileText, Search, TrendingUp } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAppStore } from "@/lib/store";
import { useForecast } from "@/components/forecast-context";
import { summarizeDailySales } from "@/lib/daily-sales";
import { peso, quantity, num } from "@/lib/format";
import { chartColors } from "@/lib/chart-theme";

export const Route = createFileRoute("/sales-report")({ component: SalesReportPage });

function SalesReportPage() {
  const products = useAppStore((state) => state.products);
  const sales = useAppStore((state) => state.sales);
  const { result: forecastResult } = useForecast();
  const dates = useMemo(() => sales.map((sale) => sale.date).sort(), [sales]);
  const [from, setFrom] = useState(dates[0] ?? "");
  const [to, setTo] = useState(dates.at(-1) ?? "");
  const [productId, setProductId] = useState("all");
  const selectedProductIds = useMemo(() => {
    const active = products.filter((product) => product.isActive !== false);
    return new Set(
      active
        .filter((product) => productId === "all" || product.id === productId)
        .map((product) => product.id),
    );
  }, [products, productId]);
  const filteredSales = useMemo(
    () => sales.filter((sale) => selectedProductIds.has(sale.productId)),
    [sales, selectedProductIds],
  );
  const summary = useMemo(
    () => summarizeDailySales(filteredSales, products, from, to),
    [filteredSales, products, from, to],
  );
  const trend = useMemo(
    () =>
      summary.rows
        .reduce<{ date: string; units: number; value: number }[]>((rows, row) => {
          const current = rows.find((item) => item.date === row.date);
          if (current) {
            current.units += row.quantity;
            current.value += row.totalAmount;
          } else rows.push({ date: row.date, units: row.quantity, value: row.totalAmount });
          return rows;
        }, [])
        .sort((a, b) => a.date.localeCompare(b.date)),
    [summary.rows],
  );
  const productRanking = [...summary.products].sort((a, b) => b.quantity - a.quantity).slice(0, 8);
  const transactionAverage = summary.recordCount ? summary.totalAmount / summary.recordCount : 0;
  const forecastComparison = useMemo(() => {
    let actual = 0;
    let predicted = 0;
    for (const productId of selectedProductIds) {
      const forecast = forecastResult?.byProduct[productId];
      for (const point of forecast?.holdout ?? []) {
        if (point.date >= from && point.date <= to && point.actual !== null) {
          actual += point.actual;
          predicted += point.ensemble;
        }
      }
    }
    return { actual, predicted, error: Math.abs(actual - predicted) };
  }, [forecastResult, selectedProductIds, from, to]);
  const validRange = Boolean(from && to && from <= to);

  return (
    <div className="page-enter mx-auto flex max-w-6xl flex-col gap-6">
      <header>
        <p className="mb-2 flex items-center gap-2 text-xs font-medium tracking-[0.18em] text-muted uppercase">
          <FileText className="size-4" aria-hidden="true" /> Owner report
        </p>
        <h1 className="font-display text-3xl font-medium tracking-tight">Sales report</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted">
          Review sales activity by date and product. Monetary values use each product&apos;s
          recorded unit cost because the current prototype has no selling-price field.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><CalendarRange className="size-5" /> Report filters</CardTitle>
          <CardDescription>Choose a period and optional product filters.</CardDescription>
        </CardHeader>
        <CardContent className="relative z-50 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="grid gap-1.5">
            <Label htmlFor="report-from">From</Label>
            <Input id="report-from" type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="report-to">To</Label>
            <Input id="report-to" type="date" value={to} onChange={(event) => setTo(event.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="report-product">Product</Label>
            <ProductPicker
              products={products}
              selectedId={productId}
              onChange={setProductId}
            />
          </div>
        </CardContent>
      </Card>

      {!validRange ? (
        <Card><CardContent className="pt-6 text-sm text-muted">Choose a valid date range to view the report.</CardContent></Card>
      ) : (
        <>
          <section aria-label="Sales summary" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Summary label="Units sold" value={quantity(summary.products.reduce((total, row) => total + row.quantity, 0))} />
            <Summary label="Estimated sales value" value={peso(summary.totalAmount)} />
            <Summary label="Transactions" value={num(summary.recordCount)} />
            <Summary label="Average transaction value" value={peso(transactionAverage)} />
          </section>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><TrendingUp className="size-5" /> Sales trend</CardTitle>
              <CardDescription>Daily units sold in the selected period.</CardDescription>
            </CardHeader>
            <CardContent>
              {trend.length ? (
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={trend} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid stroke={chartColors.grid} vertical={false} />
                      <XAxis dataKey="date" tick={{ fill: chartColors.muted, fontSize: 11 }} tickLine={false} axisLine={{ stroke: chartColors.grid }} />
                      <YAxis tick={{ fill: chartColors.muted, fontSize: 12 }} tickLine={false} axisLine={false} allowDecimals={false} />
                      <Tooltip />
                      <Bar dataKey="units" name="Units sold" fill={chartColors.actual} radius={[5, 5, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : <p className="py-16 text-center text-sm text-muted">No sales match these filters.</p>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Actual versus forecast</CardTitle>
              <CardDescription>Holdout-period comparison for the selected products and dates.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-3">
              <div><p className="text-sm text-muted">Actual units</p><p className="mt-1 text-xl font-medium tabular">{quantity(forecastComparison.actual)}</p></div>
              <div><p className="text-sm text-muted">Forecast units</p><p className="mt-1 text-xl font-medium tabular">{quantity(forecastComparison.predicted)}</p></div>
              <div><p className="text-sm text-muted">Absolute difference</p><p className="mt-1 text-xl font-medium tabular">{quantity(forecastComparison.error)}</p></div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Product performance</CardTitle>
              <CardDescription>Ranked by units sold for the selected product and date range.</CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              {productRanking.length ? (
                <table className="w-full text-left text-sm">
                  <thead className="text-xs tracking-wide text-muted uppercase"><tr><th className="pb-2">Product</th><th className="pb-2">Units</th><th className="pb-2">Estimated value</th><th className="pb-2">Records</th></tr></thead>
                  <tbody>{productRanking.map((row) => <tr key={row.productId} className="border-t border-border"><td className="py-2.5 pr-3">{row.name}<span className="ml-2 text-xs text-muted">{row.sku}</span></td><td className="py-2.5 tabular">{quantity(row.quantity)} {row.unit}</td><td className="py-2.5 tabular">{peso(row.totalAmount)}</td><td className="py-2.5 tabular">{num(row.recordCount)}</td></tr>)}</tbody>
                </table>
              ) : <p className="text-sm text-muted">No product sales match these filters.</p>}
            </CardContent>
          </Card>

          <p className="text-xs text-muted">
            Data-quality note: this report summarizes saved demo or imported records only. It does not infer missing sales, stockouts, or partner-business findings.
          </p>
        </>
      )}
    </div>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return <Card><CardContent className="pt-5"><p className="text-sm text-muted">{label}</p><p className="mt-1 text-2xl font-medium tabular">{value}</p></CardContent></Card>;
}

function ProductPicker({
  products,
  selectedId,
  onChange,
}: {
  products: ReturnType<typeof useAppStore.getState>["products"];
  selectedId: string;
  onChange: (productId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const activeProducts = products.filter((product) => product.isActive !== false);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleProducts = activeProducts.filter(
    (product) =>
      !normalizedQuery ||
      product.name.toLocaleLowerCase().includes(normalizedQuery) ||
      product.sku.toLocaleLowerCase().includes(normalizedQuery),
  );
  const selectedProduct = activeProducts.find((product) => product.id === selectedId);

  return (
    <div className="relative z-[60]">
      <button
        id="report-product"
        type="button"
        className="flex h-11 w-full items-center justify-between rounded-xl border border-border bg-surface px-3 text-left text-sm text-fg shadow-sm outline-none transition-colors hover:border-primary/40 focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/20"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="truncate">{selectedProduct?.name ?? "All products"}</span>
        <ChevronDown className="ml-2 size-4 shrink-0" aria-hidden="true" />
      </button>
      {open && (
        <div className="absolute top-full left-0 z-[100] mt-1 w-full rounded-xl border border-border bg-surface p-2 shadow-lg">
          <div className="relative">
            <Search className="pointer-events-none absolute top-3 left-3 size-4 text-muted" aria-hidden="true" />
            <Input
              autoFocus
              aria-label="Search products in dropdown"
              placeholder="Search name or SKU"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="pl-9"
            />
          </div>
          <div className="mt-2 max-h-60 overflow-y-auto" role="listbox" aria-label="Products">
            <button
              type="button"
              role="option"
              aria-selected={selectedId === "all"}
              className="block w-full rounded-md px-3 py-2 text-left text-sm hover:bg-surface-2 aria-selected:bg-surface-2"
              onClick={() => {
                onChange("all");
                setQuery("");
                setOpen(false);
              }}
            >
              All products
            </button>
            {visibleProducts.map((product) => (
              <button
                type="button"
                role="option"
                aria-selected={product.id === selectedId}
                key={product.id}
                className="block w-full rounded-md px-3 py-2 text-left text-sm hover:bg-surface-2 aria-selected:bg-surface-2"
                onClick={() => {
                  onChange(product.id);
                  setQuery("");
                  setOpen(false);
                }}
              >
                {product.name}
                <span className="ml-2 text-xs text-muted">{product.sku}</span>
              </button>
            ))}
            {!visibleProducts.length && (
              <p className="px-3 py-2 text-sm text-muted">No products match your search.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
