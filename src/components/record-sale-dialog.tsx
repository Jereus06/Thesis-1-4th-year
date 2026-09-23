import { useState, type FormEvent, type ReactNode } from "react";
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
import { todayISO } from "@/lib/dates";
import { useAppStore } from "@/lib/store";

export function RecordSaleDialog({ trigger }: { trigger?: ReactNode }) {
  const products = useAppStore((s) => s.products);
  const recordSale = useAppStore((s) => s.recordSale);
  const [open, setOpen] = useState(false);
  const [productId, setProductId] = useState(products[0]?.id ?? "");
  const [date, setDate] = useState(todayISO());
  const [qty, setQty] = useState("1");

  function submit(e: FormEvent) {
    e.preventDefault();
    const n = Number(qty);
    if (!productId || !Number.isFinite(n) || n <= 0) {
      toast.error("Enter a valid quantity.");
      return;
    }
    recordSale(productId, date, n);
    const product = products.find((p) => p.id === productId);
    toast.success(`Recorded ${n} ${product?.unit ?? "unit"} of ${product?.name ?? "item"}.`);
    setOpen(false);
    setQty("1");
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger ?? <Button>Record sale</Button>}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record a sale</DialogTitle>
          <DialogDescription>Deducts from on-hand stock and feeds the next forecast run.</DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={submit}>
          <div className="grid gap-1.5">
            <Label htmlFor="sale-product">Product</Label>
            <Select
              id="sale-product"
              value={productId}
              onChange={(e) => setProductId(e.target.value)}
            >
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="sale-date">Date</Label>
            <Input id="sale-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="sale-qty">Quantity</Label>
            <Input
              id="sale-qty"
              type="number"
              min={1}
              value={qty}
              onChange={(e) => setQty(e.target.value)}
            />
          </div>
          <Button type="submit">Save sale</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
