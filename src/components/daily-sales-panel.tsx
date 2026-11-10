import { useMemo, useState } from "react";
import {
  ArrowRight,
  CalendarDays,
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  Package2,
  ReceiptText,
  Search,
  X,
} from "lucide-react";
import { ImportRefreshNotice } from "@/components/import-refresh-notice";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { summarizeDailySales } from "@/lib/daily-sales";
import { businessDateISO } from "@/lib/dates";
import { quantity } from "@/lib/format";
import { useAppStore } from "@/lib/store";
import { cn } from "@/lib/utils";

const dayLabel = (value: string, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("en-PH", { ...options, timeZone: "UTC" }).format(
    new Date(`${value}T12:00:00Z`),
  );
function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000")) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
function shiftDay(value: string, amount: number) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  if (date.getUTCFullYear() < 1) return "0001-01-01";
  return date.toISOString().slice(0, 10);
}

export function DailySalesPanel() {
  const sales = useAppStore((state) => state.sales);
  const products = useAppStore((state) => state.products);
  const timezone = useAppStore((state) => state.settings.timezone);
  const today = businessDateISO(timezone);
  const [mode, setMode] = useState<"day" | "range">("day");
  const [date, setDate] = useState(today);
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [search, setSearch] = useState("");
  const start = mode === "day" ? date : from;
  const end = mode === "day" ? date : to;
  const valid = validDate(start) && validDate(end) && start <= end && end <= today;
  const summary = useMemo(
    () => summarizeDailySales(sales, products, start, end, search),
    [sales, products, start, end, search],
  );
  const noMatches =
    search.trim().length > 0 && sales.some((sale) => sale.date >= start && sale.date <= end);
  const activityDates = useMemo(
    () => new Set(sales.filter((sale) => sale.qty > 0).map((sale) => sale.date)),
    [sales],
  );
  const latestDate = useMemo(
    () =>
      [...activityDates]
        .filter((day) => validDate(day) && day <= today)
        .sort()
        .at(-1),
    [activityDates, today],
  );
  const week = useMemo(() => {
    const anchor = validDate(date) && date <= today ? date : today;
    const first = [shiftDay(anchor, -3), shiftDay(today, -6)].sort()[0];
    return Array.from({ length: 7 }, (_, index) => shiftDay(first, index));
  }, [date, today]);
  const heading = valid
    ? mode === "day"
      ? dayLabel(date, { weekday: "long", month: "long", day: "numeric", year: "numeric" })
      : `${dayLabel(from, { month: "short", day: "numeric", year: "numeric" })} — ${dayLabel(to, { month: "short", day: "numeric", year: "numeric" })}`
    : "Choose your sales dates";

  function changeMode(next: "day" | "range") {
    if (next === mode) return;
    if (next === "range") {
      setFrom(date || today);
      setTo(date || today);
    } else setDate(from || today);
    setMode(next);
  }

  function showLatest() {
    if (!latestDate) return;
    setMode("day");
    setDate(latestDate);
  }

  return (
    <section aria-label="Daily sales" className="grid gap-5">
      <ImportRefreshNotice />
      <div className="relative overflow-hidden rounded-3xl bg-primary text-primary-foreground">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-28 -right-14 size-80 rounded-full border border-white/10"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-24 -bottom-44 size-96 rounded-full border border-white/10"
        />
        <div className="relative grid gap-6 p-5 sm:p-7">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="mb-2 flex items-center gap-2 text-xs font-medium tracking-[0.18em] text-white/70 uppercase">
                <CalendarDays className="size-4" aria-hidden="true" /> Sales activity
              </p>
              <h2 className="font-display text-3xl font-medium tracking-tight">Daily sales</h2>
              <p className="mt-2 text-sm text-white/75">
                A clear look at what sold, on the dates you choose.
              </p>
            </div>
            <div
              className="inline-flex gap-1 rounded-xl bg-black/15 p-1"
              aria-label="Sales date selection mode"
            >
              <button
                type="button"
                aria-pressed={mode === "day"}
                onClick={() => changeMode("day")}
                className={cn(
                  "flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2",
                  mode === "day"
                    ? "bg-surface text-primary shadow-sm"
                    : "text-white/80 hover:bg-white/10",
                )}
              >
                <CalendarDays className="size-4" aria-hidden="true" />
                Single day
              </button>
              <button
                type="button"
                aria-pressed={mode === "range"}
                onClick={() => changeMode("range")}
                className={cn(
                  "flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2",
                  mode === "range"
                    ? "bg-surface text-primary shadow-sm"
                    : "text-white/80 hover:bg-white/10",
                )}
              >
                <CalendarRange className="size-4" aria-hidden="true" />
                Date range
              </button>
            </div>
          </div>
          <div className="flex flex-col justify-between gap-5 border-t border-white/15 pt-5 lg:flex-row lg:items-end">
            <div className="min-w-0">
              <p className="text-xs text-white/75">
                {mode === "day" ? "Selected day" : "Selected period"}
              </p>
              <p
                className="mt-1 font-display text-xl leading-snug font-medium sm:text-2xl"
                aria-live="polite"
              >
                {heading}
              </p>
              <p className="mt-2 text-xs text-white/75">Store dates · {timezone}</p>
            </div>
            {mode === "day" ? (
              <div className="flex w-full items-end gap-2 lg:w-auto">
                <button
                  type="button"
                  aria-label="Previous day"
                  disabled={!valid || date === "0001-01-01"}
                  onClick={() => setDate(shiftDay(date, -1))}
                  className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-white/25 bg-white/5 transition-colors hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-35"
                >
                  <ChevronLeft className="size-5" aria-hidden="true" />
                </button>
                <div className="grid min-w-0 flex-1 gap-1.5 lg:w-44">
                  <Label htmlFor="daily-sales-date" className="text-xs text-white/75">
                    Sales date
                  </Label>
                  <Input
                    id="daily-sales-date"
                    type="date"
                    min="0001-01-01"
                    value={date}
                    max={today}
                    onChange={(event) => setDate(event.target.value)}
                    className="min-w-0 rounded-xl border-transparent bg-surface [color-scheme:light]"
                  />
                </div>
                <button
                  type="button"
                  aria-label="Next day"
                  disabled={!valid || date >= today}
                  onClick={() => setDate(shiftDay(date, 1))}
                  className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-white/25 bg-white/5 transition-colors hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-35"
                >
                  <ChevronRight className="size-5" aria-hidden="true" />
                </button>
              </div>
            ) : (
              <div className="grid w-full grid-cols-2 gap-3 lg:w-80">
                <div className="grid min-w-0 gap-1.5">
                  <Label htmlFor="daily-sales-from" className="text-xs text-white/75">
                    From date
                  </Label>
                  <Input
                    id="daily-sales-from"
                    type="date"
                    min="0001-01-01"
                    value={from}
                    max={today}
                    onChange={(event) => setFrom(event.target.value)}
                    className="min-w-0 rounded-xl border-transparent bg-surface [color-scheme:light]"
                  />
                </div>
                <div className="grid min-w-0 gap-1.5">
                  <Label htmlFor="daily-sales-to" className="text-xs text-white/75">
                    To date
                  </Label>
                  <Input
                    id="daily-sales-to"
                    type="date"
                    value={to}
                    min={from || "0001-01-01"}
                    max={today}
                    onChange={(event) => setTo(event.target.value)}
                    className="min-w-0 rounded-xl border-transparent bg-surface [color-scheme:light]"
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {mode === "day" && (
        <div className="rounded-2xl border border-border bg-surface p-3 sm:p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <p className="flex items-center gap-2 text-xs text-muted">
              <span className="size-1.5 rounded-full bg-primary" aria-hidden="true" /> Sales
              recorded
            </p>
            <div className="flex gap-1">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-8 rounded-full px-3"
                onClick={() => setDate(shiftDay(today, -1))}
              >
                Yesterday
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="h-8 rounded-full px-3"
                onClick={() => setDate(today)}
              >
                Today
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-7 gap-1.5 sm:gap-2">
            {week.map((day) => (
              <button
                key={day}
                type="button"
                aria-label={`Show sales on ${day}`}
                aria-pressed={date === day}
                onClick={() => setDate(day)}
                className={cn(
                  "flex min-w-0 flex-col items-center gap-1 rounded-xl py-3 transition-colors focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2",
                  date === day
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted hover:bg-surface-2",
                )}
              >
                <span className="text-[11px] sm:text-xs">
                  {dayLabel(day, { weekday: "short" })}
                </span>
                <span className="text-lg leading-none font-medium tabular">
                  {Number(day.slice(8))}
                </span>
                <span
                  aria-hidden="true"
                  className={cn(
                    "mt-1 size-1 rounded-full",
                    activityDates.has(day)
                      ? date === day
                        ? "bg-white/80"
                        : "bg-primary"
                      : "bg-transparent",
                  )}
                />
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-border bg-surface p-4 sm:px-5">
        <Label htmlFor="daily-sales-search" className="text-xs text-muted">
          Search products or SKU
        </Label>
        <div className="relative mt-2">
          <Search
            className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted"
            aria-hidden="true"
          />
          <Input
            id="daily-sales-search"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Find a product by name or SKU…"
            aria-describedby="daily-sales-search-help"
            className="rounded-xl pr-12 pl-10 [&::-webkit-search-cancel-button]:appearance-none"
          />
          {search && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => setSearch("")}
              className="absolute top-1/2 right-1 flex size-9 -translate-y-1/2 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-primary"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          )}
        </div>
        <p id="daily-sales-search-help" className="mt-2 text-xs text-muted">
          Filter the list and totals by product name or SKU.
        </p>
      </div>

      {!valid ? (
        <p
          role="alert"
          className="rounded-2xl border border-warning/30 bg-warning/5 p-4 text-sm text-warning"
        >
          Choose a valid day or date range ending on or before {today}. The start date must come
          before or match the end date.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-[1fr_1fr_1.5fr]">
            <div className="rounded-2xl border border-border bg-surface p-4 sm:p-5">
              <Package2 className="mb-3 size-5 text-primary" aria-hidden="true" />
              <p className="text-xs text-muted">Products sold</p>
              <p
                className="mt-1 text-3xl font-medium tracking-tight tabular"
                data-testid="daily-sales-product-count"
              >
                {quantity(summary.products.length)}
              </p>
            </div>
            <div className="rounded-2xl border border-border bg-surface p-4 sm:p-5">
              <ReceiptText className="mb-3 size-5 text-primary" aria-hidden="true" />
              <p className="text-xs text-muted">Sales records</p>
              <p
                className="mt-1 text-3xl font-medium tracking-tight tabular"
                data-testid="daily-sales-record-count"
              >
                {quantity(summary.recordCount)}
              </p>
              <p className="mt-2 text-xs text-muted">
                {quantity(summary.recordedCount)} recorded · {quantity(summary.importedCount)}{" "}
                imported
              </p>
            </div>
            <div className="col-span-2 rounded-2xl border border-border bg-surface p-4 sm:p-5 lg:col-span-1">
              <p className="mb-3 text-xs text-muted">Quantity sold by unit</p>
              <div className="flex flex-wrap gap-2" aria-label="Quantity totals by unit">
                {summary.totals.length ? (
                  summary.totals.map((total) => (
                    <div
                      key={total.unit}
                      className="flex items-baseline gap-3 rounded-xl bg-primary/5 px-3 py-2"
                    >
                      <span className="text-xl font-medium tabular text-primary">
                        {quantity(total.quantity)}
                      </span>
                      <span className="text-sm text-muted">{total.unit}</span>
                    </div>
                  ))
                ) : (
                  <p className="text-2xl text-muted">—</p>
                )}
              </div>
              <p className="mt-3 text-xs text-muted">Each counting unit has its own total.</p>
            </div>
          </div>
          <div className="overflow-hidden rounded-2xl border border-border bg-surface">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4 sm:px-6">
              <div>
                <h3 className="font-display text-xl font-medium">What sold</h3>
                <p className="mt-1 text-xs text-muted">
                  {mode === "day"
                    ? "All sales records for this day"
                    : "All sales records in this period"}
                  , grouped by product and sale date.
                </p>
              </div>
              <span className="rounded-full border border-border bg-surface-2 px-3 py-1.5 text-xs text-muted">
                {quantity(summary.products.length)}{" "}
                {summary.products.length === 1 ? "product" : "products"}
              </span>
            </div>
            {summary.products.length ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm" aria-label="Products sold">
                  <thead className="bg-surface-2/50 text-[11px] tracking-wide text-muted uppercase">
                    <tr>
                      <th scope="col" className="px-5 py-3 font-medium sm:pl-6">
                        Date
                      </th>
                      <th scope="col" className="px-5 py-3 font-medium sm:pl-6">
                        Product
                      </th>
                      <th scope="col" className="px-3 py-3 font-medium">
                        SKU
                      </th>
                      <th scope="col" className="min-w-24 px-4 py-3 text-center font-medium">
                        Quantity
                      </th>
                      <th scope="col" className="min-w-20 py-3 pr-3 pl-4 font-medium">
                        Unit
                      </th>
                      <th scope="col" className="px-5 py-3 text-center font-medium">
                        Sales records
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.rows.map((product) => (
                      <tr
                        key={`${product.date}:${product.productId}`}
                        className="border-t border-border transition-colors hover:bg-surface-2/40"
                      >
                        <td className="px-5 py-4 whitespace-nowrap text-muted sm:pl-6">
                          <time dateTime={product.date}>
                            {dayLabel(product.date, {
                              month: "short",
                              day: "numeric",
                              year: "numeric",
                            })}
                          </time>
                        </td>
                        <td className="px-5 py-4 sm:pl-6">
                          <div className="flex items-center gap-3">
                            <span
                              className="hidden size-9 shrink-0 items-center justify-center rounded-xl bg-primary/5 text-primary sm:flex"
                              aria-hidden="true"
                            >
                              <Package2 className="size-4" />
                            </span>
                            <span className="min-w-32 font-medium">{product.name}</span>
                          </div>
                        </td>
                        <td className="px-3 py-4 text-xs whitespace-nowrap text-muted">
                          {product.sku}
                        </td>
                        <td className="px-4 py-4 text-center font-medium tabular">
                          {quantity(product.quantity)}
                        </td>
                        <td className="py-4 pr-3 pl-4 whitespace-nowrap text-muted">
                          {product.unit}
                        </td>
                        <td className="px-5 py-4 text-center">
                          <span className="tabular">{quantity(product.recordCount)}</span>
                          <p className="mt-1 text-[11px] whitespace-nowrap text-muted">
                            {quantity(product.recordedCount)} recorded ·{" "}
                            {quantity(product.importedCount)} imported
                          </p>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="flex flex-col items-center px-5 py-12 text-center">
                <span className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-surface-2 text-muted">
                  <ReceiptText className="size-6" aria-hidden="true" />
                </span>
                <h4 className="font-display text-xl font-medium">
                  {noMatches ? "No matching products" : "No sales records found"}
                </h4>
                <p className="mt-2 max-w-xs text-sm text-muted">
                  {noMatches
                    ? "Try a different product name or SKU, or clear your search to see all sales for these dates."
                    : `There are no saved sales for ${mode === "day" ? "this day" : "these dates"}. Choose another date to explore your records.`}
                </p>
                {noMatches ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-5 rounded-full"
                    onClick={() => setSearch("")}
                  >
                    Show all products
                  </Button>
                ) : latestDate ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-5 rounded-full"
                    onClick={showLatest}
                  >
                    View latest sales <ArrowRight aria-hidden="true" />
                  </Button>
                ) : null}
              </div>
            )}
            <p className="border-t border-border px-5 py-4 text-xs leading-relaxed text-muted sm:px-6">
              Returns are shown in Stock movements and are not deducted from these sales totals.
            </p>
          </div>
        </>
      )}
    </section>
  );
}
