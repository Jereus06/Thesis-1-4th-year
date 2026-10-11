import { useMemo, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
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
import { num } from "@/lib/format";
import { usePermissions } from "@/lib/permissions";
import { isImportedSale } from "@/lib/sales-import";
import { useAppStore } from "@/lib/store";
import type { Sale } from "@/lib/types";

const PAGE_SIZE = 40;
type DeleteSelection = { kind: "single"; sale: Sale } | { kind: "all" };

export function SalesLedgerCard() {
  const { canRecordSales, canDeleteImportedSales } = usePermissions();
  const sales = useAppStore((state) => state.sales);
  const products = useAppStore((state) => state.products);
  const session = useAppStore((state) => state.session);
  const deleteImportedSales = useAppStore((state) => state.deleteImportedSales);
  const [page, setPage] = useState(0);
  const [selection, setSelection] = useState<DeleteSelection | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);
  const nameById = useMemo(
    () => Object.fromEntries(products.map((product) => [product.id, product.name])),
    [products],
  );
  const sortedSales = useMemo(
    () => [...sales].sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id)),
    [sales],
  );
  const importedCount = useMemo(() => sales.filter(isImportedSale).length, [sales]);
  const lastPage = Math.max(0, Math.ceil(sales.length / PAGE_SIZE) - 1);
  const currentPage = Math.min(page, lastPage);
  const visibleSales = sortedSales.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  const hasActiveProducts = products.some((product) => product.isActive !== false);

  function selectDeletion(next: DeleteSelection) {
    setError(null);
    setSelection(next);
  }

  async function confirmDeletion() {
    if (!selection || pending.current || !canDeleteImportedSales) return;
    pending.current = true;
    setDeleting(true);
    setError(null);
    try {
      const result = await deleteImportedSales(
        selection.kind === "single" ? selection.sale.id : undefined,
      );
      if (selection.kind === "all") setPage(0);
      setSelection(null);
      toast.success(
        result.deletedRows
          ? `Deleted ${num(result.deletedRows)} imported sale${result.deletedRows === 1 ? "" : "s"}.`
          : "The imported sales were already deleted.",
      );
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Unable to delete imported sales.");
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
          {num(sales.length)} sales rows ·{" "}
          {session ? "saved in PostgreSQL" : "browser demonstration"}
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
        {canDeleteImportedSales && (
          <p className="text-sm text-muted">
            Imported history can be deleted without changing current stock.
          </p>
        )}
        {session && (
          <a
            className="text-sm text-primary underline"
            href={api.exportUrl(session.businessId, "sales")}
          >
            Export sales CSV
          </a>
        )}
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs tracking-wide text-muted uppercase">
              <tr>
                <th scope="col" className="pb-2 font-medium">
                  Date
                </th>
                <th scope="col" className="pb-2 font-medium">
                  Product
                </th>
                <th scope="col" className="pb-2 font-medium">
                  Qty
                </th>
                <th scope="col" className="pb-2 pl-3 font-medium">
                  Source
                </th>
                {canDeleteImportedSales && (
                  <th scope="col" className="pb-2 pl-3 font-medium">
                    Action
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {visibleSales.map((sale) => (
                <tr key={sale.id} className="border-t border-border">
                  <td className="py-2 pr-3 tabular">{sale.date}</td>
                  <td className="pr-3">{nameById[sale.productId] ?? sale.productId}</td>
                  <td className="tabular">{num(sale.qty)}</td>
                  <td className="pl-3 text-muted">
                    {isImportedSale(sale)
                      ? "Imported"
                      : sale.source === "manual"
                        ? "Recorded"
                        : sale.source === "demo"
                          ? "Demo"
                          : "Unknown"}
                  </td>
                  {canDeleteImportedSales && (
                    <td className="pl-3">
                      {isImportedSale(sale) && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-danger"
                          disabled={deleting}
                          aria-label={`Delete imported sale for ${nameById[sale.productId] ?? sale.productId} on ${sale.date}, quantity ${num(sale.qty)}`}
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
              {!sales.length && (
                <tr>
                  <td colSpan={canDeleteImportedSales ? 5 : 4} className="py-6 text-muted">
                    No sales recorded yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {sales.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <p className="text-muted" aria-live="polite">
              {currentPage * PAGE_SIZE + 1}–{Math.min((currentPage + 1) * PAGE_SIZE, sales.length)}{" "}
              of {num(sales.length)} sales
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
                  ? "Delete imported sale?"
                  : "Delete all imported sales?"}
              </DialogTitle>
              <DialogDescription>
                {selection?.kind === "single"
                  ? `Permanently remove ${num(selection.sale.qty)} sold for ${nameById[selection.sale.productId] ?? selection.sale.productId} on ${selection.sale.date}.`
                  : `Permanently remove all ${num(importedCount)} imported sales rows from this store, including rows on other pages.`}{" "}
                Current stock stays the same. Refresh forecasts after deleting sales history.
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
                disabled={deleting || !canDeleteImportedSales}
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
    </Card>
  );
}
