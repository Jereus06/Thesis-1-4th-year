import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
import { Search } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { api } from "@/lib/api";
import { todayISO } from "@/lib/dates";
import { num } from "@/lib/format";
import { usePermissions } from "@/lib/permissions";
import { useAppStore } from "@/lib/store";
import type { InventoryMovement, Product, StockMovementInput } from "@/lib/types";

type EditableMovementType = "return" | "write_off";

const movementLabels: Record<InventoryMovement["movementType"], string> = {
  opening_balance: "Opening balance",
  sale: "Sale",
  receipt: "Delivery",
  return: "Return",
  write_off: "Write-off",
  adjustment: "Stock count adjustment",
};

export function StockMovementsPanel() {
  const products = useAppStore((s) => s.products);
  const movements = useAppStore((s) => s.inventoryMovements);
  const status = useAppStore((s) => s.movementsStatus);
  const loadError = useAppStore((s) => s.movementsError);
  const refresh = useAppStore((s) => s.refreshInventoryMovements);
  const session = useAppStore((s) => s.session);
  const mode = useAppStore((s) => s.dataMode);
  const { canRecordReturns, canWriteOffStock } = usePermissions();
  const [movementType, setMovementType] = useState<EditableMovementType | null>(null);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [page, setPage] = useState(0);
  const filterId = useId();
  const pageSize = 50;
  const activeProducts = products.filter((product) => product.isActive !== false);
  const productById = useMemo(
    () => new Map(products.map((product) => [product.id, product])),
    [products],
  );

  useEffect(() => {
    void refresh().catch(() => undefined);
  }, [refresh]);

  const filteredMovements = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return movements
      .filter((movement) => {
        if (typeFilter && movement.movementType !== typeFilter) return false;
        if (!normalizedQuery) return true;
        const product = productById.get(movement.productId);
        return [
          product?.name,
          product?.sku,
          movement.productId,
          movement.movementDate,
          movementLabels[movement.movementType],
          movement.note,
          movement.recordedBy,
          movement.saleId,
        ].some((value) => value?.toLowerCase().includes(normalizedQuery));
      })
      .sort((a, b) => b.movementDate.localeCompare(a.movementDate));
  }, [movements, productById, query, typeFilter]);
  const lastPage = Math.max(0, Math.ceil(filteredMovements.length / pageSize) - 1);
  const currentPage = Math.min(page, lastPage);
  const visibleMovements = filteredMovements.slice(
    currentPage * pageSize,
    (currentPage + 1) * pageSize,
  );

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Returns & write-offs</CardTitle>
          <CardDescription>
            Record items returned to usable stock or remove damaged, expired, or lost items. Each
            saved movement keeps its quantity, balance, note, and recording user in the audit
            ledger.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div className="flex flex-wrap gap-2">
            {canRecordReturns && (
              <Button
                variant="outline"
                disabled={!activeProducts.length || saving}
                onClick={() => setMovementType("return")}
              >
                Record return
              </Button>
            )}
            {canWriteOffStock && (
              <Button
                variant="outline"
                disabled={!activeProducts.length || saving}
                onClick={() => setMovementType("write_off")}
              >
                Write off stock
              </Button>
            )}
          </div>
          {!activeProducts.length && (
            <p className="text-sm text-muted">
              An active product is required to record a movement.
            </p>
          )}
          {canRecordReturns && !canWriteOffStock && (
            <p className="text-sm text-muted">
              Owners record write-offs and stock count adjustments.
            </p>
          )}
          {mode === "browser-demo" && (
            <p className="text-sm text-muted">
              Browser demonstration: new movements are saved on this browser. Older demonstration
              records may have no saved movement audit.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="grid gap-1">
              <CardTitle>Stock movement ledger</CardTitle>
              <CardDescription>
                Saved balances are the on-hand stock immediately after each movement was recorded. A
                backdated movement updates current stock and does not rewrite earlier balances.
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              {session && (
                <a
                  className="text-sm text-primary underline"
                  href={api.exportUrl(session.businessId, "inventory-movements")}
                >
                  Export CSV
                </a>
              )}
              <Button
                variant="outline"
                size="sm"
                disabled={status === "loading" || saving}
                onClick={() => void refresh().catch(() => undefined)}
              >
                {status === "loading" ? "Refreshing..." : "Refresh"}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-[1fr_15rem]">
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
              <Input
                type="search"
                className="pl-9"
                placeholder="Search product, date, note, or user ID"
                aria-label="Search stock movements"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setPage(0);
                }}
              />
            </div>
            <Select
              id={filterId}
              aria-label="Filter stock movements by type"
              value={typeFilter}
              onChange={(event) => {
                setTypeFilter(event.target.value);
                setPage(0);
              }}
            >
              <option value="">All movement types</option>
              {Object.entries(movementLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </div>
          {loadError && (
            <p role="alert" className="rounded-lg bg-danger/10 p-3 text-sm text-danger">
              {loadError} Use Refresh to try again.
            </p>
          )}
          {status === "loading" && (
            <p role="status" className="text-sm text-muted">
              Loading stock movements...
            </p>
          )}
          {visibleMovements.length > 0 ? (
            <>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[48rem] text-left text-sm">
                  <caption className="sr-only">Audited inventory stock movements</caption>
                  <thead className="border-b border-border text-xs text-muted">
                    <tr>
                      <th scope="col" className="p-3 pl-0 font-medium">
                        Movement date / type
                      </th>
                      <th scope="col" className="p-3 font-medium">
                        Product
                      </th>
                      <th scope="col" className="p-3 text-right font-medium">
                        Change
                      </th>
                      <th scope="col" className="p-3 text-right font-medium">
                        Saved balance
                      </th>
                      <th scope="col" className="p-3 pr-0 font-medium">
                        Audit details
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleMovements.map((movement) => (
                      <MovementRow
                        key={movement.id}
                        movement={movement}
                        product={productById.get(movement.productId)}
                        currentUserId={session?.userId}
                        currentUserName={session?.displayName}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs text-muted">
                  {currentPage * pageSize + 1}–
                  {Math.min((currentPage + 1) * pageSize, filteredMovements.length)} of{" "}
                  {filteredMovements.length} movement{filteredMovements.length === 1 ? "" : "s"}
                </p>
                {lastPage > 0 && (
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={currentPage === 0}
                      onClick={() => setPage(currentPage - 1)}
                    >
                      Previous
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={currentPage >= lastPage}
                      onClick={() => setPage(currentPage + 1)}
                    >
                      Next
                    </Button>
                  </div>
                )}
              </div>
            </>
          ) : status !== "loading" && !loadError ? (
            <p className="text-sm text-muted">
              {movements.length
                ? "No movements match your search or type filter."
                : "No stock movements have been recorded yet."}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Dialog
        open={movementType !== null}
        onOpenChange={(open) => {
          if (!open && !saving) setMovementType(null);
        }}
      >
        <DialogContent
          className="max-h-[calc(100dvh-2rem)] overflow-y-auto"
          onEscapeKeyDown={(event) => {
            if (saving) event.preventDefault();
          }}
          onPointerDownOutside={(event) => {
            if (saving) event.preventDefault();
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {movementType === "write_off" ? "Write off stock" : "Record a return"}
            </DialogTitle>
            <DialogDescription>
              {movementType === "write_off"
                ? "Removes unusable or lost stock. The reason is saved with the audit record."
                : "Adds returned items to usable on-hand stock. Sales history remains unchanged."}
            </DialogDescription>
          </DialogHeader>
          {movementType && (
            <StockMovementForm
              key={movementType}
              movementType={movementType}
              saving={saving}
              onSavingChange={setSaving}
              onDone={() => setMovementType(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function MovementRow({
  movement,
  product,
  currentUserId,
  currentUserName,
}: {
  movement: InventoryMovement;
  product?: Product;
  currentUserId?: string;
  currentUserName?: string;
}) {
  return (
    <tr className="border-b border-border/60 align-top">
      <td className="p-3 pl-0">
        <time dateTime={movement.movementDate}>{movement.movementDate}</time>
        <p className="mt-1 text-xs text-muted">{movementLabels[movement.movementType]}</p>
      </td>
      <td className="p-3">
        <p className="font-medium">{product?.name ?? "Product unavailable"}</p>
        <p className="mt-1 text-xs text-muted">{product?.sku ?? movement.productId}</p>
        {product?.isActive === false && (
          <Badge variant="outline" className="mt-1">
            Inactive
          </Badge>
        )}
      </td>
      <td className="p-3 text-right tabular-nums">
        <span className={movement.quantityDelta < 0 ? "text-danger" : "text-primary"}>
          {movement.quantityDelta > 0 ? "+" : ""}
          {num(movement.quantityDelta, 3)}
        </span>
        <p className="mt-1 text-xs text-muted">{product?.unit ?? "units"}</p>
      </td>
      <td className="p-3 text-right tabular-nums">{num(movement.balanceAfter, 3)}</td>
      <td className="max-w-xs p-3 pr-0">
        <Badge variant={movement.dataOrigin === "demo" ? "warning" : "outline"}>
          {movement.dataOrigin === "demo" ? "Test/demo records" : "Business records"}
        </Badge>
        {movement.note && <p className="mt-2 whitespace-pre-wrap break-words">{movement.note}</p>}
        <details className="mt-2 text-xs text-muted">
          <summary className="cursor-pointer">
            Recorded by{" "}
            {movement.recordedBy
              ? movement.recordedBy === currentUserId
                ? `${currentUserName ?? "You"} (you)`
                : movement.recordedBy === "browser-demo"
                  ? "demo user"
                  : `user ${movement.recordedBy.slice(0, 8)}`
              : "not recorded"}
          </summary>
          <div className="mt-2 grid gap-1 break-all">
            <p>Movement ID: {movement.id}</p>
            <p>Product ID: {movement.productId}</p>
            <p>User ID: {movement.recordedBy ?? "Not recorded"}</p>
            {movement.saleId && <p>Source sale ID: {movement.saleId}</p>}
          </div>
        </details>
      </td>
    </tr>
  );
}

function StockMovementForm({
  movementType,
  saving,
  onSavingChange,
  onDone,
}: {
  movementType: EditableMovementType;
  saving: boolean;
  onSavingChange: (saving: boolean) => void;
  onDone: () => void;
}) {
  const products = useAppStore((s) => s.products);
  const timezone = useAppStore((s) => s.settings.timezone);
  const recordStockMovement = useAppStore((s) => s.recordStockMovement);
  const { canRecordReturns, canWriteOffStock } = usePermissions();
  const activeProducts = products.filter((product) => product.isActive !== false);
  const [productId, setProductId] = useState(activeProducts[0]?.id ?? "");
  const [date, setDate] = useState(() => businessDate(timezone));
  const [qty, setQty] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const submitting = useRef(false);
  const retry = useRef<{ signature: string; key: string } | null>(null);
  const id = useId();
  const selectedProduct = activeProducts.find((product) => product.id === productId);
  const allowed = movementType === "return" ? canRecordReturns : canWriteOffStock;
  const quantity = Number(qty);
  const previewBalance =
    selectedProduct && Number.isFinite(quantity) && quantity > 0
      ? selectedProduct.currentStock + (movementType === "write_off" ? -quantity : quantity)
      : null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving || submitting.current) return;
    if (!allowed) {
      setError("Your role is not authorized to record this movement.");
      return;
    }
    if (!selectedProduct) {
      setError("Choose an active product.");
      return;
    }
    const parsedDate = new Date(`${date}T00:00:00Z`);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      Number(date.slice(0, 4)) < 1 ||
      !Number.isFinite(parsedDate.getTime()) ||
      parsedDate.toISOString().slice(0, 10) !== date
    ) {
      setError("Enter a valid date in YYYY-MM-DD format.");
      return;
    }
    const scaledQuantity = quantity * 1000;
    if (
      !qty.trim() ||
      !Number.isFinite(quantity) ||
      quantity <= 0 ||
      Math.abs(scaledQuantity - Math.round(scaledQuantity)) > 0.000001
    ) {
      setError("Enter a positive quantity with no more than three decimal places.");
      return;
    }
    if (movementType === "write_off" && quantity > selectedProduct.currentStock) {
      setError(
        `Only ${num(selectedProduct.currentStock, 3)} ${selectedProduct.unit} are on hand. Reduce the write-off quantity.`,
      );
      return;
    }
    const trimmedNote = note.trim();
    if (movementType === "write_off" && !trimmedNote) {
      setError("Enter the reason for this write-off.");
      return;
    }
    if (note.length > 500) {
      setError("Keep the note within 500 characters.");
      return;
    }
    const input: StockMovementInput = {
      productId: selectedProduct.id,
      movementDate: date,
      movementType,
      quantityDelta: movementType === "write_off" ? -quantity : quantity,
      ...(trimmedNote ? { note: trimmedNote } : {}),
    };
    const signature = JSON.stringify(input);
    if (retry.current?.signature !== signature) {
      retry.current = { signature, key: crypto.randomUUID() };
    }
    submitting.current = true;
    onSavingChange(true);
    setError(null);
    try {
      await recordStockMovement({ ...input, idempotencyKey: retry.current.key });
      toast.success(
        `${movementType === "write_off" ? "Wrote off" : "Returned"} ${num(quantity, 3)} ${selectedProduct.unit} of ${selectedProduct.name}.`,
      );
      onDone();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The stock movement could not be saved. Try again.",
      );
    } finally {
      submitting.current = false;
      onSavingChange(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-4" aria-busy={saving}>
      <fieldset disabled={saving || !allowed} className="grid min-w-0 gap-4">
        <div className="grid gap-1.5">
          <Label htmlFor={`${id}-product`}>Active product</Label>
          <Select
            id={`${id}-product`}
            required
            value={selectedProduct?.id ?? ""}
            onChange={(event) => setProductId(event.target.value)}
          >
            <option value="" disabled>
              Choose a product
            </option>
            {activeProducts.map((product) => (
              <option key={product.id} value={product.id}>
                {product.name} · {product.sku}
              </option>
            ))}
          </Select>
        </div>
        {selectedProduct && (
          <div className="rounded-xl bg-surface-2 p-3 text-sm">
            <p>
              On hand: {num(selectedProduct.currentStock, 3)} {selectedProduct.unit}
            </p>
            {previewBalance !== null && (
              <p className={previewBalance < 0 ? "mt-1 text-danger" : "mt-1 text-muted"}>
                After {movementType === "write_off" ? "write-off" : "return"}:{" "}
                {num(previewBalance, 3)} {selectedProduct.unit}
              </p>
            )}
          </div>
        )}
        <div className="grid gap-1.5">
          <Label htmlFor={`${id}-date`}>Movement date</Label>
          <Input
            id={`${id}-date`}
            type="date"
            required
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={`${id}-qty`}>
            {movementType === "write_off" ? "Quantity to write off" : "Quantity returned"}
          </Label>
          <Input
            id={`${id}-qty`}
            type="number"
            min={0.001}
            max={movementType === "write_off" ? selectedProduct?.currentStock : undefined}
            step={0.001}
            required
            value={qty}
            placeholder="Enter quantity"
            onChange={(event) => setQty(event.target.value)}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={`${id}-note`}>
            {movementType === "write_off" ? "Reason for write-off" : "Note (optional)"}
          </Label>
          <textarea
            id={`${id}-note`}
            className="w-full rounded-lg border border-border bg-surface p-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            rows={3}
            maxLength={500}
            required={movementType === "write_off"}
            value={note}
            placeholder={
              movementType === "write_off"
                ? "For example: damaged packaging or expired stock"
                : "For example: customer return accepted into usable stock"
            }
            onChange={(event) => setNote(event.target.value)}
            aria-describedby={`${id}-note-count`}
          />
          <p id={`${id}-note-count`} className="text-xs text-muted">
            {note.length}/500 characters
          </p>
        </div>
      </fieldset>
      {error && (
        <p role="alert" className="rounded-lg bg-danger/10 p-3 text-sm text-danger">
          {error}
        </p>
      )}
      <Button type="submit" disabled={saving || !allowed || !selectedProduct}>
        {saving ? "Saving..." : movementType === "write_off" ? "Save write-off" : "Save return"}
      </Button>
    </form>
  );
}

function businessDate(timezone: string) {
  try {
    const parts = new Intl.DateTimeFormat("en", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date());
    const part = (name: string) => parts.find((value) => value.type === name)?.value;
    return `${part("year")}-${part("month")}-${part("day")}`;
  } catch {
    return todayISO();
  }
}
