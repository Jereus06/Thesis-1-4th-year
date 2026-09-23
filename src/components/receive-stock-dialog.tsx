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
import { useAppStore } from "@/lib/store";
import type { ReorderRow } from "@/lib/types";

export function ReceiveStockDialog({
  row,
  open,
  onOpenChange,
}: {
  row: ReorderRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const receiveStock = useAppStore((s) => s.receiveStock);
  const [qty, setQty] = useState("");

  const suggested = row?.reorderQty ?? 0;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!row) return;
    const n = Number(qty || suggested);
    if (!Number.isFinite(n) || n <= 0) {
      toast.error("Enter a valid quantity.");
      return;
    }
    receiveStock(row.product.id, n);
    toast.success(`Received ${num(n)} ${row.product.unit} of ${row.product.name}.`);
    onOpenChange(false);
    setQty("");
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record delivery</DialogTitle>
          <DialogDescription>
            {row
              ? `Suggested reorder is ${num(suggested)} ${row.product.unit} to cover lead time, a week of demand, and safety stock.`
              : "Choose a product."}
          </DialogDescription>
        </DialogHeader>
        {row && (
          <form className="grid gap-4" onSubmit={submit}>
            <div className="rounded-xl bg-surface-2 p-3 text-sm">
              <p className="font-medium">{row.product.name}</p>
              <p className="text-muted">
                On hand {num(row.product.currentStock)} · ROP {num(Math.ceil(row.reorderPoint))}
              </p>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="recv-qty">Quantity received</Label>
              <Input
                id="recv-qty"
                type="number"
                min={1}
                placeholder={String(suggested)}
                value={qty}
                onChange={(e) => setQty(e.target.value)}
              />
            </div>
            <Button type="submit">Add to inventory</Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
