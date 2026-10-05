import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { num } from "@/lib/format";
import { usePermissions } from "@/lib/permissions";
import { useAppStore } from "@/lib/store";
import type { Product, ReorderRow } from "@/lib/types";

export function ReceiveStockDialog({
  product,
  row,
  open,
  onOpenChange,
}: {
  product: Product | null;
  row?: ReorderRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { canReceiveStock } = usePermissions();
  const currentProduct = useAppStore((state) =>
    state.products.find((item) => item.id === product?.id),
  );
  const suggested = row?.reorderQty ?? 0;
  const description =
    row?.demandAvailable === false
      ? "Demand is unavailable. Enter the quantity actually delivered."
      : suggested > 0
        ? `Suggested reorder is ${num(suggested)} ${product?.unit}. Enter the quantity actually delivered.`
        : "Enter the quantity actually delivered. A reorder recommendation is not required.";

  return (
    <Dialog open={open && canReceiveStock} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record delivery</DialogTitle>
          <DialogDescription>{product ? description : "Choose a product."}</DialogDescription>
        </DialogHeader>
        {product && (!currentProduct || currentProduct.isActive === false) && (
          <p className="text-sm text-muted">
            This product is inactive or unavailable. An owner must activate it before recording a
            delivery.
          </p>
        )}
        {currentProduct && currentProduct.isActive !== false && (
          <ReceiveStockForm
            key={currentProduct.id}
            product={currentProduct}
            row={row}
            onDone={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ReceiveStockForm({
  product,
  row,
  onDone,
}: {
  product: Product;
  row?: ReorderRow | null;
  onDone: () => void;
}) {
  const { canReceiveStock } = usePermissions();
  const receiveStock = useAppStore((s) => s.receiveStock);
  const [qty, setQty] = useState("");
  const [saving, setSaving] = useState(false);
  const suggested = row?.reorderQty ?? 0;

  async function submit(e: FormEvent) {
    e.preventDefault();
    const n = Number(qty);
    if (!Number.isFinite(n) || n <= 0) {
      toast.error("Enter a valid quantity.");
      return;
    }
    if (saving || !canReceiveStock || product.isActive === false) return;
    try {
      setSaving(true);
      await receiveStock(product.id, n);
      toast.success(`Received ${num(n, 3)} ${product.unit} of ${product.name}.`);
      onDone();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The delivery could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="grid gap-4" onSubmit={submit}>
      <div className="rounded-xl bg-surface-2 p-3 text-sm">
        <p className="font-medium">{product.name}</p>
        <p className="text-muted">
          On hand {num(product.currentStock)}
          {row && row.demandAvailable !== false && <> · ROP {num(Math.ceil(row.reorderPoint))}</>}
        </p>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="recv-qty">Quantity received</Label>
        <Input
          id="recv-qty"
          type="number"
          required
          min={0.001}
          step={0.001}
          placeholder={suggested > 0 ? String(suggested) : "Enter delivered quantity"}
          value={qty}
          onChange={(e) => setQty(e.target.value)}
        />
      </div>
      <Button type="submit" disabled={saving || !canReceiveStock || product.isActive === false}>
        Add to inventory
      </Button>
    </form>
  );
}
