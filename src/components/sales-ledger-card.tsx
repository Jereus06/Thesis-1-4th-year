import { useMemo, useRef, useState } from "react";
import { Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { ImportRefreshNotice } from "@/components/import-refresh-notice";
import { RecordSaleDialog } from "@/components/record-sale-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { api } from "@/lib/api";
import { num, quantity } from "@/lib/format";
import { usePermissions } from "@/lib/permissions";
import { isImportedSale } from "@/lib/sales-import";
import { useAppStore } from "@/lib/store";
import type { Sale } from "@/lib/types";

const PAGE_SIZE = 40;
type DeleteSelection = { kind: "single"; sale: Sale } | { kind: "all" };

export function SalesLedgerCard() {
  const { canRecordSales, canDeleteSales, canDeleteImportedSales } = usePermissions();
  const sales = useAppStore((state) => state.sales);
  const products = useAppStore((state) => state.products);
  const session = useAppStore((state) => state.session);
  const deleteSale = useAppStore((state) => state.deleteSale);
  const deleteImportedSales = useAppStore((state) => state.deleteImportedSales);
  const [page, setPage] = useState(0);
  const [selection, setSelection] = useState<DeleteSelection | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exportFrom, setExportFrom] = useState("");
  const [exportTo, setExportTo] = useState("");
  const [exportReminderOpen, setExportReminderOpen] = useState(false);
  const [exportMode, setExportMode] = useState<"day" | "range">("day");
  const [search, setSearch] = useState("");
  const pending = useRef(false);
  const nameById = useMemo(
    () => Object.fromEntries(products.map((product) => [product.id, product.name])),
    [products],
  );
  const sortedSales = useMemo(
    () => [...sales].sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id)),
    [sales],
  );
  const filteredSales = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    if (!query) return sortedSales;
    return sortedSales.filter((sale) => {
      const product = products.find((item) => item.id === sale.productId);
      return `${product?.name ?? sale.productId} ${product?.sku ?? ""}`
        .toLocaleLowerCase()
        .includes(query);
    });
  }, [products, search, sortedSales]);
  const importedCount = useMemo(() => sales.filter(isImportedSale).length, [sales]);
  const lastPage = Math.max(0, Math.ceil(filteredSales.length / PAGE_SIZE) - 1);
  const currentPage = Math.min(page, lastPage);
  const visibleSales = filteredSales.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  const hasActiveProducts = products.some((product) => product.isActive !== false);
  const recordedSelection = selection?.kind === "single" && selection.sale.source === "manual";
  const canDeleteSelection = selection?.kind === "single" ? canDeleteSales : canDeleteImportedSales;
  const invalidExportRange = Boolean(exportFrom && exportTo && exportFrom > exportTo);
  const exportReady = Boolean(exportFrom) && !invalidExportRange;

  function selectDeletion(next: DeleteSelection) {
    setError(null);
    setSelection(next);
  }

  async function confirmDeletion() {
    if (!selection || pending.current || !canDeleteSelection) return;
    pending.current = true;
    setDeleting(true);
    setError(null);
    try {
      const result =
        selection.kind === "single"
          ? await deleteSale(selection.sale.id)
          : await deleteImportedSales();
      if (selection.kind === "all") setPage(0);
      setSelection(null);
      toast.success(
        result.deletedRows
          ? recordedSelection
            ? "Recorded sale deleted; stock restored."
            : `Deleted ${num(result.deletedRows)} imported sale${result.deletedRows === 1 ? "" : "s"}.`
          : "The selected sales were already deleted.",
      );
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Unable to delete sales.");
    } finally {
      pending.current = false;
      setDeleting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent sales</CardTitle>
        <ImportRefreshNotice />
        <CardDescription>
          {num(sales.length)} sales records{!session && " · Demo records"}
        </CardDescription>
        <div className="flex flex-wrap gap-2">
          {canRecordSales && (
            <RecordSaleDialog
              trigger={<Button disabled={!hasActiveProducts || deleting}>Record sale</Button>}
            />
          )}
          {canDeleteImportedSales && (
            <Button
              variant="outline"
              className="text-danger"
              disabled={!importedCount || deleting}
              onClick={() => selectDeletion({ kind: "all" })}
            >
              <Trash2 aria-hidden="true" />
              Delete imported sales
            </Button>
          )}
        </div>
        {canDeleteSales && (
          <p className="text-sm text-muted">
            Deleting a recorded sale restores its quantity to stock. Deleting imported history
            leaves stock unchanged.
          </p>
        )}
        {session && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setExportReminderOpen(true)}
          >
            Export sales CSV
          </Button>
        )}
        <div className="relative">
          <Search
            className="pointer-events-none absolute top-3.5 left-3 size-4 text-muted"
            aria-hidden="true"
          />
          <input
            aria-label="Search sales"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(0);
            }}
            placeholder="Search sales by product or SKU"
            className="flex h-11 w-full rounded-xl border border-border bg-surface py-2 pr-3 pl-9 text-sm text-fg shadow-sm outline-none transition-colors placeholder:text-muted focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/20"
          />
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="record-scroll" tabIndex={0} role="region" aria-label="Sales records">
          <table
            aria-label="Recent sales"
            className="w-full min-w-[34rem] table-fixed text-left text-sm"
          >
            <colgroup>
              <col className="w-[22%]" />
              <col className={canDeleteSales ? "w-[28%]" : "w-[46%]"} />
              <col className={canDeleteSales ? "w-[10%]" : "w-[14%]"} />
              <col className={canDeleteSales ? "w-[17%]" : "w-[18%]"} />
              {canDeleteSales && <col className="w-[23%]" />}
            </colgroup>
            <thead className="text-xs tracking-wide text-muted uppercase">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">
                  Date
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Product
                </th>
                <th scope="col" className="px-4 py-3 text-center font-medium">
                  Qty
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Source
                </th>
                {canDeleteSales && (
                  <th scope="col" className="px-4 py-3 text-center font-medium">
                    Action
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {visibleSales.map((sale) => (
                <tr key={sale.id} className="border-t border-border">
                  <td className="px-4 py-3 whitespace-nowrap tabular">{sale.date}</td>
                  <td className="px-4 py-3 [overflow-wrap:anywhere]">
                    {nameById[sale.productId] ?? sale.productId}
                  </td>
                  <td className="px-4 py-3 text-center tabular">{quantity(sale.qty)}</td>
                  <td className="px-4 py-3 text-muted">
                    {isImportedSale(sale)
                      ? "Imported"
                      : sale.source === "manual"
                        ? "Recorded"
                        : sale.source === "demo"
                          ? "Demo"
                          : "Unknown"}
                  </td>
                  {canDeleteSales && (
                    <td className="px-4 py-3 text-center">
                      {(isImportedSale(sale) || sale.source === "manual") && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-danger"
                          disabled={deleting}
                          aria-label={`Delete ${isImportedSale(sale) ? "imported" : "recorded"} sale for ${nameById[sale.productId] ?? sale.productId} on ${sale.date}, quantity ${quantity(sale.qty)}`}
                          onClick={() => selectDeletion({ kind: "single", sale })}
                        >
                          <Trash2 aria-hidden="true" />
                          Delete
                        </Button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
              {!filteredSales.length && (
                <tr>
                  <td colSpan={canDeleteSales ? 5 : 4} className="px-4 py-6 text-muted">
                    {sales.length ? "No sales match your search." : "No sales recorded yet."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {filteredSales.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <p className="text-muted" aria-live="polite">
              {currentPage * PAGE_SIZE + 1}–
              {Math.min((currentPage + 1) * PAGE_SIZE, filteredSales.length)} of{" "}
              {num(filteredSales.length)} sales
            </p>
            {lastPage > 0 && (
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!currentPage || deleting}
                  onClick={() => setPage(currentPage - 1)}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={currentPage === lastPage || deleting}
                  onClick={() => setPage(currentPage + 1)}
                >
                  Next
                </Button>
              </div>
            )}
          </div>
        )}
        <Dialog
          open={selection !== null}
          onOpenChange={(open) => {
            if (!open && !pending.current) setSelection(null);
          }}
        >
          <DialogContent
            onEscapeKeyDown={(event) => {
              if (pending.current) event.preventDefault();
            }}
            onInteractOutside={(event) => {
              if (pending.current) event.preventDefault();
            }}
          >
            <DialogHeader>
              <DialogTitle>
                {selection?.kind === "single"
                  ? recordedSelection
                    ? "Delete recorded sale?"
                    : "Delete imported sale?"
                  : "Delete all imported sales?"}
              </DialogTitle>
              <DialogDescription>
                {selection?.kind === "single"
                  ? `Permanently remove ${quantity(selection.sale.qty)} sold for ${nameById[selection.sale.productId] ?? selection.sale.productId} on ${selection.sale.date}.`
                  : `Permanently remove all ${num(importedCount)} imported sales rows from this store, including rows on other pages.`}{" "}
                {recordedSelection
                  ? `This restores ${quantity(selection.sale.qty)} to current stock and saves an adjustment in Stock movements.`
                  : "Current stock stays the same."}{" "}
                Refresh forecasts after deleting sales history.
              </DialogDescription>
            </DialogHeader>
            {error && (
              <p role="alert" className="mb-4 text-sm text-danger">
                {error}
              </p>
            )}
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="outline" disabled={deleting} onClick={() => setSelection(null)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                disabled={deleting || !canDeleteSelection}
                onClick={() => void confirmDeletion()}
              >
                {deleting
                  ? "Deleting…"
                  : selection?.kind === "single"
                    ? "Delete sale"
                    : "Delete imported sales"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </CardContent>
      <Dialog open={exportReminderOpen} onOpenChange={setExportReminderOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Export sales</DialogTitle>
            <DialogDescription>Choose whether to export one day or a date range.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant={exportMode === "day" ? "default" : "outline"}
                aria-pressed={exportMode === "day"}
                onClick={() => setExportMode("day")}
              >
                Single day
              </Button>
              <Button
                type="button"
                variant={exportMode === "range" ? "default" : "outline"}
                aria-pressed={exportMode === "range"}
                onClick={() => setExportMode("range")}
              >
                Date range
              </Button>
            </div>
            <label className="grid gap-1.5 text-sm">
              {exportMode === "day" ? "Date" : "From"}
              <input
                type="date"
                required
                value={exportFrom}
                onChange={(event) => setExportFrom(event.target.value)}
                className="h-11 rounded-lg border border-border bg-surface px-3 text-sm text-fg"
              />
            </label>
            {exportMode === "range" && (
              <label className="grid gap-1.5 text-sm">
                To
                <input
                  type="date"
                  required
                  value={exportTo}
                  onChange={(event) => setExportTo(event.target.value)}
                  className="h-11 rounded-lg border border-border bg-surface px-3 text-sm text-fg"
                />
              </label>
            )}
            {invalidExportRange && (
              <p className="text-sm text-danger" role="alert">
                The start date must not be after the end date.
              </p>
            )}
            <Button
              type="button"
              disabled={!exportReady || (exportMode === "range" && !exportTo)}
              onClick={() => {
                if (!session) return;
                window.location.assign(
                  api.exportUrl(session.businessId, "sales", {
                    from: exportFrom,
                    to: exportMode === "day" ? exportFrom : exportTo,
                  }),
                );
                setExportReminderOpen(false);
              }}
            >
              Download CSV
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
