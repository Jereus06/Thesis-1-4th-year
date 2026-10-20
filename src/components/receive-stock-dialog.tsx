import { useRef, useState, type FormEvent } from "react";
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
import { businessDateISO } from "@/lib/dates";
import { usePermissions } from "@/lib/permissions";
import { useAppStore } from "@/lib/store";
import type { SessionUser } from "@/lib/api";
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
        {product && (
          <ReceiveStockForm
            key={product.id}
            product={product}
            currentProduct={currentProduct}
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
  currentProduct,
  row,
  onDone,
}: {
  product: Product;
  currentProduct?: Product;
  row?: ReorderRow | null;
  onDone: () => void;
}) {
  const { canReceiveStock } = usePermissions();
  const receiveStock = useAppStore((s) => s.receiveStock);
  const timezone = useAppStore((s) => s.settings.timezone);
  const session = useAppStore((s) => s.session);
  const [qty, setQty] = useState("");
  const [saving, setSaving] = useState(false);
  const submitting = useRef(false);
  const retry = useRef<{
    signature: string;
    key: string;
    movementDate: string;
    session: SessionUser | null;
    product: Product;
  } | null>(null);
  const suggested = row?.reorderQty ?? 0;
  const signature = JSON.stringify({ productId: product.id, qty: Number(qty) });
  const retrying = retry.current?.session === session && retry.current.signature === signature;
  const active = Boolean(currentProduct && currentProduct.isActive !== false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const n = Number(qty);
    if (!qty.trim() || !Number.isFinite(n) || n <= 0 || Number(n.toFixed(3)) !== n) {
      toast.error("Enter a positive quantity with no more than three decimal places.");
      return;
    }
    if (
      saving ||
      submitting.current ||
      !canReceiveStock ||
      useAppStore.getState().session !== session
    )
      return;
    if (!retrying && !active) {
      toast.error("Choose an active product for a new delivery.");
      return;
    }
    if (!retrying) {
      retry.current = {
        signature,
        key: crypto.randomUUID(),
        movementDate: businessDateISO(timezone),
        session,
        product: currentProduct!,
      };
    }
    const attempt = retry.current!;
    submitting.current = true;
    try {
      setSaving(true);
      await receiveStock(product.id, n, {
        idempotencyKey: attempt.key,
        movementDate: attempt.movementDate,
      });
      if (useAppStore.getState().session !== session) return;
      retry.current = null;
      toast.success(`Received ${num(n, 3)} ${attempt.product.unit} of ${attempt.product.name}.`);
      onDone();
    } catch (error) {
      if (useAppStore.getState().session !== session) return;
      toast.error(error instanceof Error ? error.message : "The delivery could not be saved.");
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  }

  return (
    <form className="grid gap-4" onSubmit={submit}>
      <div className="rounded-xl bg-surface-2 p-3 text-sm">
        <p className="font-medium">{product.name}</p>
        <p className="text-muted">
          {currentProduct ? (
            <>On hand {num(currentProduct.currentStock)}</>
          ) : (
            "Current stock is unavailable."
          )}
          {row && row.demandAvailable !== false && <> · ROP {num(Math.ceil(row.reorderPoint))}</>}
        </p>
        {!active && (
          <p className="mt-1 text-muted">
            {retrying
              ? "This product is inactive or unavailable. Retry the unchanged submission to confirm whether it saved."
              : "This product is inactive or unavailable. An owner must activate it before recording a new delivery."}
          </p>
        )}
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
          disabled={saving}
          onChange={(e) => setQty(e.target.value)}
        />
      </div>
      <Button type="submit" disabled={saving || !canReceiveStock || (!active && !retrying)}>
        Add to inventory
      </Button>
    </form>
  );
}
