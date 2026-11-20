import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  Calculator,
  CalendarDays,
  CalendarRange,
  ChevronDown,
  FileText,
  Package2,
  ReceiptText,
  Search,
  TrendingUp,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { SalesReportChart } from "@/components/sales-report-chart";
import { modelLabel } from "@/lib/forecast/constants";
import { compareSalesForecast, estimatedRevenue, type ReportModel } from "@/lib/sales-forecast";
import type { SalesReportChartType, SalesView } from "@/lib/sales-report-chart";
import { useAppStore } from "@/lib/store";
import { useForecast } from "@/components/forecast-context";
import { summarizeDailySales } from "@/lib/daily-sales";
import { businessDateISO } from "@/lib/dates";
import { peso, quantity, num } from "@/lib/format";

export const Route = createFileRoute("/sales-report")({ component: SalesReportPage });

function validReportDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000")) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function SalesReportPage() {
  const products = useAppStore((state) => state.products);
  const sales = useAppStore((state) => state.sales);
  const timezone = useAppStore((state) => state.settings.timezone);
  const today = businessDateISO(timezone);
  const { result: forecastResult } = useForecast();
  const dates = useMemo(
    () =>
      sales
        .map((sale) => sale.date)
        .filter((date) => validReportDate(date) && date <= today)
        .sort(),
    [sales, today],
  );
  const [dateMode, setDateMode] = useState<"day" | "range">("range");
  const [dayDraft, setDayDraft] = useState<string | null>(null);
  const [fromDraft, setFromDraft] = useState<string | null>(null);
  const [toDraft, setToDraft] = useState<string | null>(null);
  const selectedDay = dayDraft ?? dates.at(-1) ?? today;
  const rangeFrom = fromDraft ?? dates[0] ?? today;
  const rangeTo = toDraft ?? dates.at(-1) ?? today;
  const from = dateMode === "day" ? selectedDay : rangeFrom;
  const to = dateMode === "day" ? selectedDay : rangeTo;
  const [productId, setProductId] = useState("all");
  const [view, setView] = useState<SalesView>("quantity");
  const [unit, setUnit] = useState("all");
  const [model, setModel] = useState<ReportModel>("operating");
  const [chartType, setChartType] = useState<SalesReportChartType>("bar");
  const selectedProductIds = useMemo(() => {
    const active = products.filter((product) => unit === "all" || product.unit === unit);
    return new Set(
      active
        .filter((product) => productId === "all" || product.id === productId)
        .map((product) => product.id),
    );
  }, [products, productId, unit]);
  const filteredSales = useMemo(
    () => sales.filter((sale) => selectedProductIds.has(sale.productId)),
    [sales, selectedProductIds],
  );
  const summary = useMemo(
    () => summarizeDailySales(filteredSales, products, from, to),
    [filteredSales, products, from, to],
  );
  const productRanking = [...summary.products].sort((a, b) =>
    view === "revenue"
      ? (b.totalAmount ?? -1) - (a.totalAmount ?? -1)
      : a.unit.localeCompare(b.unit) || b.quantity - a.quantity,
  );
  const pricedRecords = summary.recordCount - summary.unpricedCount;
  const transactionAverage =
    pricedRecords && summary.totalAmount != null ? summary.totalAmount / pricedRecords : null;
  const selectedProducts = products.filter((product) => selectedProductIds.has(product.id));
  const forecastComparison = compareSalesForecast(
    selectedProducts,
    forecastResult,
    from,
    to,
    model,
  );
  const estimates = selectedProducts
    .filter((product) => product.isActive !== false)
    .map((product) => ({
      product,
      ...estimatedRevenue(
        product,
        forecastResult?.byProduct[product.id],
        today,
        model,
        forecastResult?.forecastHorizonDays,
      ),
    }));
  const revenueNote = summary.unpricedCount
    ? `Incomplete: ${summary.unpricedCount} unpriced records`
    : "Saved sale prices";
  const validRange = validReportDate(from) && validReportDate(to) && from <= to && to <= today;

  return (
    <div className="page-enter mx-auto flex max-w-6xl flex-col gap-6">
      <header className="relative overflow-hidden rounded-3xl bg-primary px-5 py-6 text-primary-foreground sm:px-7 sm:py-7">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-24 -right-12 size-72 rounded-full border border-white/10"
        />
        <div className="relative flex flex-wrap items-end justify-between gap-5">
          <div className="max-w-2xl">
            <p className="mb-3 flex items-center gap-2 text-xs font-medium tracking-[0.18em] text-white/70 uppercase">
              <FileText className="size-4" aria-hidden="true" /> Owner report
            </p>
            <h1 className="font-display text-3xl font-medium tracking-tight sm:text-4xl">
              Sales report
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-white/80">
              Review saved quantities and revenue by date and product.
            </p>
          </div>
          <span className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-2 text-xs text-white/90">
            <CalendarDays className="size-4" aria-hidden="true" />
            {dateMode === "day" ? "Single day report" : "Date range report"}
          </span>
        </div>
      </header>

      <Card className="relative z-30">
        <CardHeader className="gap-4 pb-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 space-y-1.5">
            <CardTitle className="flex items-center gap-2">
              <CalendarRange className="size-5 text-primary" aria-hidden="true" /> Report filters
            </CardTitle>
            <CardDescription className="text-xs leading-relaxed">
              Choose one day or a date range.
            </CardDescription>
          </div>
          <div
            role="group"
            aria-label="Report date selection mode"
            className="inline-flex max-w-full shrink-0 gap-1 self-start rounded-xl border border-border bg-surface-2/60 p-1 sm:self-center"
          >
            <Button
              type="button"
              size="sm"
              variant={dateMode === "day" ? "default" : "outline"}
              className="rounded-lg px-3 text-xs"
              aria-pressed={dateMode === "day"}
              onClick={() => setDateMode("day")}
            >
              Single day
            </Button>
            <Button
              type="button"
              size="sm"
              variant={dateMode === "range" ? "default" : "outline"}
              className="rounded-lg px-3 text-xs"
              aria-pressed={dateMode === "range"}
              onClick={() => setDateMode("range")}
            >
              Date range
            </Button>
          </div>
        </CardHeader>
        <CardContent
          className={`relative z-50 grid gap-4 border-t border-border/70 pt-4 sm:grid-cols-2 ${dateMode === "range" ? "lg:grid-cols-3" : ""}`}
        >
          {dateMode === "day" ? (
            <div className="grid gap-1.5">
              <Label htmlFor="report-date">Sales date</Label>
              <Input
                id="report-date"
                type="date"
                min="0001-01-01"
                max={today}
                value={selectedDay}
                onChange={(event) => setDayDraft(event.target.value)}
              />
            </div>
          ) : (
            <>
              <div className="grid gap-1.5">
                <Label htmlFor="report-from">From</Label>
                <Input
                  id="report-from"
                  type="date"
                  min="0001-01-01"
                  max={today}
                  value={rangeFrom}
                  onChange={(event) => setFromDraft(event.target.value)}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="report-to">To</Label>
                <Input
                  id="report-to"
                  type="date"
                  min="0001-01-01"
                  max={today}
                  value={rangeTo}
                  onChange={(event) => setToDraft(event.target.value)}
                />
              </div>
            </>
          )}
          <div className="grid gap-1.5">
            <Label htmlFor="report-view">View</Label>
            <Select
              id="report-view"
              value={view}
              onChange={(event) => setView(event.target.value as SalesView)}
            >
              <option value="quantity">Quantity</option>
              <option value="revenue">Revenue</option>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="report-unit">Counting unit</Label>
            <Select id="report-unit" value={unit} onChange={(event) => setUnit(event.target.value)}>
              <option value="all">All counting units</option>
              {[...new Set(products.map((product) => product.unit))].map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="report-product">Product</Label>
            <ProductPicker products={products} selectedId={productId} onChange={setProductId} />
          </div>
        </CardContent>
      </Card>

      {!validRange ? (
        <Card>
          <CardContent className="pt-6 text-sm text-muted">
            {dateMode === "day"
              ? "Choose a valid sales date on or before today."
              : "Choose a valid date range ending on or before today."}
          </CardContent>
        </Card>
      ) : (
        <>
          <section
            aria-label="Sales summary"
            className="grid auto-rows-fr gap-3 min-[360px]:grid-cols-2 xl:grid-cols-4"
          >
            <Summary
              label={view === "quantity" ? "Units sold" : "Revenue"}
              icon={Package2}
              note={view === "quantity" ? "Shown by counting unit" : revenueNote}
              totals={view === "quantity" ? summary.totals : undefined}
              value={view === "revenue" ? peso(summary.totalAmount) : undefined}
            />
            <Summary
              label={view === "quantity" ? "Revenue" : "Units sold"}
              icon={Wallet}
              totals={view === "revenue" ? summary.totals : undefined}
              value={view === "quantity" ? peso(summary.totalAmount) : undefined}
              note={view === "quantity" ? revenueNote : "Shown by counting unit"}
            />
            <Summary
              label="Sales records"
              icon={ReceiptText}
              value={num(summary.recordCount)}
              note="Saved sale entries"
            />
            <Summary
              label="Revenue per priced record"
              icon={Calculator}
              value={peso(transactionAverage)}
              note={revenueNote}
            />
          </section>

          <Card>
            <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="space-y-1.5">
                <CardTitle className="flex items-center gap-2">
                  <TrendingUp className="size-5" />
                  {chartType === "pie" ? "Sales by product" : "Sales trend"}
                </CardTitle>
                <CardDescription>
                  {chartType === "pie"
                    ? `Product shares by ${view}. Quantity shares require one counting unit.`
                    : view === "revenue"
                      ? `Daily revenue. ${revenueNote}.`
                      : "Daily quantities. Different counting units stay separate."}
                </CardDescription>
              </div>
              <div className="grid w-full gap-1.5 sm:w-44 sm:shrink-0">
                <Label htmlFor="report-chart-type">Chart type</Label>
                <Select
                  id="report-chart-type"
                  value={chartType}
                  onChange={(event) => setChartType(event.target.value as SalesReportChartType)}
                >
                  <option value="bar">Bar</option>
                  <option value="line">Line</option>
                  <option value="area">Area</option>
                  <option value="pie">Pie — product share</option>
                </Select>
              </div>
            </CardHeader>
            <CardContent>
              {view === "revenue" && <p className="mb-3 text-xs text-muted">{revenueNote}</p>}
              <SalesReportChart
                rows={summary.rows}
                products={summary.products}
                chartType={chartType}
                view={view}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Actual versus forecast</CardTitle>
              <CardDescription>
                Quantity comparison on matching saved final-test product/date observations. Counting
                units stay separate.
              </CardDescription>
              <Label htmlFor="report-model">Forecast model</Label>
              <Select
                id="report-model"
                value={model}
                onChange={(event) => setModel(event.target.value as ReportModel)}
              >
                <option value="operating">Operating model per product</option>
                <option value="ma">Moving Average</option>
                <option value="xgb">XGBoost</option>
                <option value="ensemble">Ensemble</option>
              </Select>
            </CardHeader>
            <CardContent className="grid gap-3">
              {!forecastComparison.length && (
                <p>Unavailable: no matching daily test evidence for this model and period.</p>
              )}
              {forecastComparison.map((row) => (
                <div key={row.unit} className="rounded-xl bg-surface-2 p-3 text-sm">
                  <p>
                    {row.unit} · Models: {row.methods.map(modelLabel).join(", ")} ·{" "}
                    {row.observations} product/date observations
                  </p>
                  <p>
                    Actual: {quantity(row.actual)} · Forecast: {quantity(row.predicted)} · MAE:{" "}
                    {num(row.mae, 2)} · RMSE: {num(row.rmse, 2)}
                  </p>
                </div>
              ))}
              <p className="text-xs text-muted">
                Only matched observations are included; products without evidence are excluded.
                These are quantity errors, independent of historical price availability.
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Estimated revenue</CardTitle>
              <CardDescription>
                Future predicted quantity × assumed selling price. Assumption date: {today}. Prices
                are assumed constant over each saved forecast period; these estimates are not profit
                or guaranteed earnings.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              {!estimates.length && <p>Unavailable: no active products selected.</p>}
              {estimates.map((row) => (
                <div key={row.productId} className="rounded-xl bg-surface-2 p-3 text-sm">
                  <p>
                    {row.product.name} · {row.product.sku} ·{" "}
                    {row.method ? modelLabel(row.method) : "Model unavailable"}
                  </p>
                  <p>
                    Assumed selling price: {peso(row.assumedSellingPrice)} / {row.product.unit} as
                    of {row.assumptionDate}
                  </p>
                  <p>
                    Predicted quantity:{" "}
                    {row.predictedQuantity == null
                      ? "Unavailable"
                      : `${quantity(row.predictedQuantity)} ${row.product.unit}`}{" "}
                    · Estimated revenue: {peso(row.amount)}
                  </p>
                  <p>
                    {row.start ?? "Unavailable"} · {row.end ?? "Unavailable"}
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Product performance</CardTitle>
              <CardDescription>
                {view === "revenue"
                  ? "Ranked by saved revenue."
                  : "Ranked by quantity within each counting unit."}{" "}
                {revenueNote}.
              </CardDescription>
            </CardHeader>
            <CardContent className="record-scroll" tabIndex={0}>
              {productRanking.length ? (
                <table
                  aria-label="Product performance"
                  className="w-full min-w-[42rem] table-fixed text-left text-sm"
                >
                  <colgroup>
                    <col className="w-[46%]" />
                    <col className="w-[18%]" />
                    <col className="w-[22%]" />
                    <col className="w-[14%]" />
                  </colgroup>
                  <thead className="text-xs tracking-wide text-muted uppercase">
                    <tr>
                      <th scope="col" className="px-4 py-3 font-medium">
                        Product
                      </th>
                      <th scope="col" className="px-4 py-3 text-center font-medium">
                        Units
                      </th>
                      <th scope="col" className="px-4 py-3 text-center font-medium">
                        Revenue
                      </th>
                      <th scope="col" className="px-4 py-3 text-center font-medium">
                        Records
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {productRanking.map((row) => (
                      <tr key={row.productId} className="border-t border-border">
                        <td className="px-4 py-3 [overflow-wrap:anywhere]">
                          {row.name}
                          {!row.isActive && " (Inactive)"}
                          <span className="ml-2 text-xs text-muted">{row.sku}</span>
                        </td>
                        <td className="px-4 py-3 text-center tabular">
                          {quantity(row.quantity)} {row.unit}
                        </td>
                        <td className="px-4 py-3 text-center tabular">
                          {peso(row.totalAmount)}
                          {row.unpricedCount > 0 && (
                            <small className="block">
                              Incomplete: {row.unpricedCount} unpriced records
                            </small>
                          )}
                        </td>
                        <td className="px-4 py-3 text-center tabular">{num(row.recordCount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="text-sm text-muted">No product sales match these filters.</p>
              )}
            </CardContent>
          </Card>

          <p className="text-xs text-muted">
            Only recorded sales are included. Missing records do not mean zero sales.
          </p>
        </>
      )}
    </div>
  );
}

function Summary({
  label,
  value,
  totals,
  icon: Icon,
  note,
}: {
  label: string;
  value?: string;
  totals?: { unit: string; quantity: number }[];
  icon: LucideIcon;
  note: string;
}) {
  return (
    <Card role="group" aria-label={label} className="min-w-0">
      <CardContent className="grid h-full min-h-[13rem] grid-rows-[auto_1fr_auto] gap-3 p-4 sm:p-5">
        <div className="flex min-h-11 min-w-0 items-center gap-2.5">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/7 text-primary">
            <Icon className="size-4" aria-hidden="true" />
          </span>
          <p className="min-w-0 text-xs leading-snug font-medium text-muted [overflow-wrap:anywhere]">
            {label}
          </p>
        </div>
        <div className="min-h-0 min-w-0 self-center">
          {totals?.length ? (
            <dl
              aria-label="Units sold by counting unit"
              className="max-h-24 space-y-1.5 overflow-y-auto pr-1"
              tabIndex={0}
            >
              {totals.map((row) => (
                <div
                  key={row.unit}
                  className="flex min-w-0 items-baseline justify-between gap-2 rounded-lg bg-surface-2/65 px-2.5 py-1.5"
                >
                  <dt className="order-2 min-w-0 max-w-[65%] text-right text-xs leading-snug text-muted [overflow-wrap:anywhere]">
                    {row.unit || "Unspecified unit"}
                  </dt>
                  <dd className="order-1 min-w-0 text-lg leading-snug font-semibold tabular [overflow-wrap:anywhere]">
                    {quantity(row.quantity)}
                  </dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="min-w-0 text-[clamp(1.05rem,1.7vw,1.75rem)] leading-tight font-semibold tracking-tight tabular [overflow-wrap:anywhere]">
              {value ?? "0"}
            </p>
          )}
        </div>
        <p className="min-h-8 border-t border-border/70 pt-2 text-[11px] leading-relaxed text-muted">
          {note}
        </p>
      </CardContent>
    </Card>
  );
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
  const activeProducts = products;
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleProducts = activeProducts.filter(
    (product) =>
      !normalizedQuery ||
      product.name.toLocaleLowerCase().includes(normalizedQuery) ||
      [product.sku, product.brand, product.model, product.variant, product.category].some((value) =>
        value?.toLocaleLowerCase().includes(normalizedQuery),
      ),
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
            <Search
              className="pointer-events-none absolute top-3 left-3 size-4 text-muted"
              aria-hidden="true"
            />
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
                {product.isActive === false && " (Inactive)"}
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
