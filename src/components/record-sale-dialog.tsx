import { useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { businessDateISO } from "@/lib/dates";
import { num } from "@/lib/format";
import { usePermissions } from "@/lib/permissions";
import { useAppStore } from "@/lib/store";
import type { SessionUser } from "@/lib/api";
import type { Product } from "@/lib/types";

export function RecordSaleDialog({ trigger }: { trigger?: ReactNode }) {
  const catalog = useAppStore((s) => s.products);
  const products = useMemo(
    () => catalog.filter((product) => product.isActive !== false),
    [catalog],
  );
  const { canRecordSales, canManageProducts } = usePermissions();
  const recordSale = useAppStore((s) => s.recordSale);
  const session = useAppStore((s) => s.session);
  const timezone = useAppStore((s) => s.settings.timezone);
  const [open, setOpen] = useState(false);
  const [productId, setProductId] = useState(products[0]?.id ?? "");
  const [date, setDate] = useState(() => businessDateISO(timezone));
  const [qty, setQty] = useState("1");
  const [saving, setSaving] = useState(false);
  const submitting = useRef(false);
  const retry = useRef<{
    signature: string;
    key: string;
    session: SessionUser | null;
    product: Product;
  } | null>(null);
  const pending = retry.current?.session === session ? retry.current : null;
  const selectedProductId = productId || pending?.product.id || (products[0]?.id ?? "");
  const currentProduct = catalog.find((product) => product.id === selectedProductId);
  const selected =
    currentProduct ?? (pending?.product.id === selectedProductId ? pending.product : undefined);
  const active = Boolean(currentProduct && currentProduct.isActive !== false);
  const signature = JSON.stringify({ productId: selectedProductId, date, qty: Number(qty) });
  const retrying = pending?.signature === signature;
  const today = businessDateISO(timezone);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (
      saving ||
      submitting.current ||
      !canRecordSales ||
      useAppStore.getState().session !== session
    )
      return;
    const n = Number(qty);
    if (!qty.trim() || !Number.isFinite(n) || n <= 0 || Number(n.toFixed(3)) !== n) {
      toast.error("Enter a positive quantity with no more than three decimal places.");
      return;
    }
    const parsedDate = new Date(`${date}T00:00:00Z`);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      Number(date.slice(0, 4)) < 1 ||
      !Number.isFinite(parsedDate.getTime()) ||
      parsedDate.toISOString().slice(0, 10) !== date
    ) {
      toast.error("Enter a valid date in YYYY-MM-DD format.");
      return;
    }
    if (!retrying && date > businessDateISO(timezone)) {
      toast.error("Use the business's current date or an earlier date.");
      return;
    }
    if (!selected || (!retrying && !active)) {
      toast.error("Choose an active product.");
      return;
    }
    if (!retrying && n > selected.currentStock) {
      toast.error("The sale quantity exceeds the product's on-hand stock.");
      return;
    }
    if (!retrying)
      retry.current = { signature, key: crypto.randomUUID(), session, product: selected };
    submitting.current = true;
    try {
      setSaving(true);
      await recordSale(selectedProductId, date, n, retry.current!.key);
      if (useAppStore.getState().session !== session) return;
      retry.current = null;
      toast.success(`Recorded ${n} ${selected.unit} of ${selected.name}.`);
      setOpen(false);
      setQty("1");
    } catch (error) {
      if (useAppStore.getState().session !== session) return;
      toast.error(error instanceof Error ? error.message : "The sale could not be saved.");
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  }

  if (!canRecordSales) return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger ?? <Button>Record sale</Button>}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record a sale</DialogTitle>
          <DialogDescription>
            Deducts from on-hand stock and feeds the next forecast run.
          </DialogDescription>
        </DialogHeader>
        {!products.length && (
          <p className="text-sm text-muted">
            {canManageProducts
              ? "Add or activate a product in Inventory before recording a sale."
              : "No active products are available. Ask the owner to add or activate a product."}
          </p>
        )}
        <form className="grid gap-4" onSubmit={submit}>
          <div className="grid gap-1.5">
            <Label htmlFor="sale-product">Product</Label>
            <Select
              id="sale-product"
              value={selectedProductId}
              disabled={(!products.length && !selectedProductId) || saving}
              onChange={(e) => setProductId(e.target.value)}
            >
              {selectedProductId && !active && (
                <option value={selectedProductId}>
                  {selected?.name ?? "Product unavailable"} (inactive or unavailable)
                </option>
              )}
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
            {selected && (
              <p className="text-xs text-muted">
                {currentProduct ? (
                  <>
                    On hand: {num(currentProduct.currentStock, 3)} {currentProduct.unit}
                  </>
                ) : (
                  "Current stock is unavailable."
                )}
              </p>
            )}
            {selectedProductId && !active && (
              <p className="text-xs text-muted">
                {retrying
                  ? "Retry the unchanged submission to confirm whether it saved."
                  : "Choose an active product for a new sale."}
              </p>
            )}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="sale-date">Date</Label>
            <Input
              id="sale-date"
              type="date"
              required
              value={date}
              max={retrying ? undefined : today}
              disabled={saving}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="sale-qty">Quantity</Label>
            <Input
              id="sale-qty"
              type="number"
              required
              min={0.001}
              step={0.001}
              max={retrying ? undefined : currentProduct?.currentStock}
              value={qty}
              disabled={saving}
              onChange={(e) => setQty(e.target.value)}
            />
          </div>
          <Button
            type="submit"
            disabled={saving || !selected || (!retrying && (!active || selected.currentStock <= 0))}
          >
            Save sale
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
