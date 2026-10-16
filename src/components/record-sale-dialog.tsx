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

export function RecordSaleDialog({ trigger }: { trigger?: ReactNode }) {
  const catalog = useAppStore((s) => s.products);
  const products = useMemo(
    () => catalog.filter((product) => product.isActive !== false),
    [catalog],
  );
  const { canRecordSales, canManageProducts } = usePermissions();
  const recordSale = useAppStore((s) => s.recordSale);
  const timezone = useAppStore((s) => s.settings.timezone);
  const [open, setOpen] = useState(false);
  const [productId, setProductId] = useState(products[0]?.id ?? "");
  const [date, setDate] = useState(() => businessDateISO(timezone));
  const [qty, setQty] = useState("1");
  const [saving, setSaving] = useState(false);
  const submitting = useRef(false);
  const retry = useRef<{ signature: string; key: string } | null>(null);
  const selectedProductId = products.some((p) => p.id === productId)
    ? productId
    : (products[0]?.id ?? "");
  const signature = JSON.stringify({ productId: selectedProductId, date, qty: Number(qty) });
  const retrying = retry.current?.signature === signature;
  const today = businessDateISO(timezone);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (saving || submitting.current || !canRecordSales) return;
    const n = Number(qty);
    if (!selectedProductId || !Number.isFinite(n) || n <= 0) {
      toast.error("Enter a valid quantity.");
      return;
    }
    if (!date || date > businessDateISO(timezone)) {
      toast.error("Use the business's current date or an earlier date.");
      return;
    }
    const product = products.find((p) => p.id === selectedProductId);
    if (!product || (!retrying && n > product.currentStock)) {
      toast.error("The sale quantity exceeds the product's on-hand stock.");
      return;
    }
    if (!retrying) retry.current = { signature, key: crypto.randomUUID() };
    submitting.current = true;
    try {
      setSaving(true);
      await recordSale(selectedProductId, date, n, retry.current!.key);
      retry.current = null;
      toast.success(`Recorded ${n} ${product?.unit ?? "unit"} of ${product?.name ?? "item"}.`);
      setOpen(false);
      setQty("1");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The sale could not be saved.");
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  }

  if (!canRecordSales) return null;
  const selected = products.find((product) => product.id === selectedProductId);

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
              disabled={!products.length || saving}
              onChange={(e) => setProductId(e.target.value)}
            >
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
            {selected && (
              <p className="text-xs text-muted">
                On hand: {num(selected.currentStock, 3)} {selected.unit}
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
              max={today}
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
              max={retrying ? undefined : selected?.currentStock}
              value={qty}
              disabled={saving}
              onChange={(e) => setQty(e.target.value)}
            />
          </div>
          <Button
            type="submit"
            disabled={saving || !selected || (selected.currentStock <= 0 && !retrying)}
          >
            Save sale
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
