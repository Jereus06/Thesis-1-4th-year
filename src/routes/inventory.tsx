import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SEED_END, SEED_START } from "@/lib/data/seed";
import { num, peso } from "@/lib/format";
import { useAppStore } from "@/lib/store";
import type { Product, Sale } from "@/lib/types";

export const Route = createFileRoute("/inventory")({ component: InventoryPage });

function InventoryPage() {
  return (
    <div className="page-enter mx-auto flex max-w-6xl flex-col gap-6">
      <header>
        <h1 className="font-display text-3xl font-medium tracking-tight">Inventory & records</h1>
        <p className="mt-2 max-w-2xl text-muted">
          Products, lead times, and safety stock drive reorder points. Sales history is the only input the models need.
        </p>
      </header>
      <Tabs defaultValue="products">
        <TabsList className="w-full justify-start overflow-x-auto">
          <TabsTrigger value="products">Products</TabsTrigger>
          <TabsTrigger value="sales">Sales ledger</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>
        <TabsContent value="products">
          <ProductsPanel />
        </TabsContent>
        <TabsContent value="sales">
          <SalesPanel />
        </TabsContent>
        <TabsContent value="settings">
          <SettingsPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ProductsPanel() {
  const products = useAppStore((s) => s.products);
  const updateProduct = useAppStore((s) => s.updateProduct);
  const addProduct = useAppStore((s) => s.addProduct);
  const [open, setOpen] = useState(false);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button variant="outline" onClick={() => setOpen((v) => !v)}>
          {open ? "Close form" : "Add product"}
        </Button>
      </div>
      {open && <AddProductForm onAdd={addProduct} onDone={() => setOpen(false)} />}
      <div className="grid gap-3">
        {products.map((p) => (
          <ProductEditor key={`${p.id}-${p.currentStock}-${p.leadTimeDays}-${p.safetyStock}`} product={p} onSave={(patch) => updateProduct(p.id, patch)} />
        ))}
      </div>
    </div>
  );
}

function ProductEditor({
  product,
  onSave,
}: {
  product: Product;
  onSave: (patch: Partial<Product>) => void;
}) {
  const [lead, setLead] = useState(String(product.leadTimeDays));
  const [ss, setSs] = useState(String(product.safetyStock));
  const [stock, setStock] = useState(String(product.currentStock));

  function save() {
    onSave({
      leadTimeDays: Math.max(1, Number(lead) || 1),
      safetyStock: Math.max(0, Number(ss) || 0),
      currentStock: Math.max(0, Number(stock) || 0),
    });
    toast.success(`Updated ${product.name}`);
  }

  return (
    <Card>
      <CardContent className="grid gap-4 md:grid-cols-[1.4fr_repeat(3,minmax(0,1fr))_auto] md:items-end">
        <div>
          <p className="font-medium">{product.name}</p>
          <p className="text-xs text-muted">
            {product.sku} · {product.category} · {peso(product.unitCost)} / {product.unit}
          </p>
        </div>
        <Field label="On hand" value={stock} onChange={setStock} />
        <Field label="Lead time (days)" value={lead} onChange={setLead} />
        <Field label="Safety stock" value={ss} onChange={setSs} />
        <Button variant="secondary" onClick={save}>
          Save
        </Button>
      </CardContent>
    </Card>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="grid gap-1.5">
      <Label>{label}</Label>
      <Input type="number" min={0} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function AddProductForm({
  onAdd,
  onDone,
}: {
  onAdd: (p: Omit<Product, "id" | "sku"> & { sku?: string }) => void;
  onDone: () => void;
}) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState("Staples");
  const [unit, setUnit] = useState("pc");
  const [stock, setStock] = useState("0");
  const [lead, setLead] = useState("3");
  const [ss, setSs] = useState("5");
  const [cost, setCost] = useState("10");

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    onAdd({
      name: name.trim(),
      category,
      unit,
      currentStock: Number(stock) || 0,
      leadTimeDays: Number(lead) || 3,
      safetyStock: Number(ss) || 0,
      unitCost: Number(cost) || 0,
    });
    toast.success(`Added ${name.trim()}`);
    onDone();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>New product</CardTitle>
        <CardDescription>Needs a few weeks of sales before forecasts become reliable.</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="grid gap-3 md:grid-cols-2" onSubmit={submit}>
          <div className="grid gap-1.5 md:col-span-2">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="grid gap-1.5">
            <Label>Category</Label>
            <Input value={category} onChange={(e) => setCategory(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label>Unit</Label>
            <Input value={unit} onChange={(e) => setUnit(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label>On hand</Label>
            <Input type="number" value={stock} onChange={(e) => setStock(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label>Lead time</Label>
            <Input type="number" value={lead} onChange={(e) => setLead(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label>Safety stock</Label>
            <Input type="number" value={ss} onChange={(e) => setSs(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label>Unit cost (PHP)</Label>
            <Input type="number" value={cost} onChange={(e) => setCost(e.target.value)} />
          </div>
          <div className="md:col-span-2">
            <Button type="submit">Add to catalog</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function SalesPanel() {
  const sales = useAppStore((s) => s.sales);
  const products = useAppStore((s) => s.products);
  const importSales = useAppStore((s) => s.importSales);
  const [csv, setCsv] = useState("");
  const nameById = useMemo(() => Object.fromEntries(products.map((p) => [p.id, p.name])), [products]);
  const recent = [...sales].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 40);

  function importCsv() {
    const rows = parseCsv(csv, products);
    if (!rows.length) {
      toast.error("No matching rows. Use Date, Product, Quantity.");
      return;
    }
    importSales(rows);
    toast.success(`Imported ${rows.length} sales rows.`);
    setCsv("");
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
      <Card>
        <CardHeader>
          <CardTitle>Recent sales</CardTitle>
          <CardDescription>
            Seed history covers {SEED_START} to {SEED_END} ({num(sales.length)} rows).
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs tracking-wide text-muted uppercase">
              <tr>
                <th className="pb-2 font-medium">Date</th>
                <th className="pb-2 font-medium">Product</th>
                <th className="pb-2 font-medium">Qty</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((s) => (
                <tr key={s.id} className="border-t border-border">
                  <td className="py-2 pr-3 tabular">{s.date}</td>
                  <td className="pr-3">{nameById[s.productId] ?? s.productId}</td>
                  <td className="tabular">{num(s.qty)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Import CSV</CardTitle>
          <CardDescription>Columns: Date, Product, Quantity. Product can be name or SKU.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <textarea
            value={csv}
            onChange={(e) => setCsv(e.target.value)}
            rows={10}
            className="w-full rounded-xl border border-border bg-surface p-3 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            placeholder={"2026-09-18,Lucky Me Pancit Canton,12\n2026-09-18,Nature Spring Water 500ml,20"}
          />
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={importCsv}>
              Import rows
            </Button>
            <label className="inline-flex h-11 cursor-pointer items-center justify-center rounded-lg border border-border bg-surface px-4 text-sm font-medium hover:bg-surface-2">
              Upload file
              <input
                type="file"
                accept=".csv,text/csv,text/plain"
                className="sr-only"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const reader = new FileReader();
                  reader.onload = () => {
                    const text = String(reader.result ?? "");
                    setCsv(text);
                    toast.success(`Loaded ${file.name}`);
                  };
                  reader.readAsText(file);
                  e.target.value = "";
                }}
              />
            </label>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function parseCsv(text: string, products: Product[]): Sale[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const rows: Sale[] = [];
  for (const line of lines) {
    if (/^date/i.test(line)) continue;
    const parts = line.split(",").map((p) => p.trim());
    if (parts.length < 3) continue;
    const [date, productKey, qtyRaw] = parts;
    const qty = Number(qtyRaw);
    if (!date || !Number.isFinite(qty) || qty <= 0) continue;
    const match = products.find(
      (p) =>
        p.name.toLowerCase() === productKey.toLowerCase() ||
        p.sku.toLowerCase() === productKey.toLowerCase() ||
        p.id === productKey,
    );
    if (!match) continue;
    rows.push({
      id: `imp-${match.id}-${date}-${rows.length}-${Date.now()}`,
      productId: match.id,
      date,
      qty,
    });
  }
  return rows;
}

function SettingsPanel() {
  const settings = useAppStore((s) => s.settings);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const resetDemo = useAppStore((s) => s.resetDemo);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Store & model settings</CardTitle>
        <CardDescription>
          Safety stock and lead time stay on each product. Top N and the thin-data toggle belong to
          the two strategies.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid max-w-xl gap-4">
        <div className="grid gap-1.5">
          <Label>Store name</Label>
          <Input value={settings.storeName} onChange={(e) => updateSettings({ storeName: e.target.value })} />
        </div>
        <div className="grid gap-1.5">
          <Label>Location</Label>
          <Input
            value={settings.storeLocation}
            onChange={(e) => updateSettings({ storeLocation: e.target.value })}
          />
        </div>
        <div className="grid gap-1.5">
          <Label>Moving Average window (days)</Label>
          <Select
            value={String(settings.maWindow)}
            onChange={(e) => updateSettings({ maWindow: Number(e.target.value) })}
          >
            {[3, 7, 14].map((n) => (
              <option key={n} value={n}>
                {n} days
              </option>
            ))}
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label>Cover days after delivery</Label>
          <Select
            value={String(settings.coverDays)}
            onChange={(e) => updateSettings({ coverDays: Number(e.target.value) })}
          >
            {[3, 7, 10, 14].map((n) => (
              <option key={n} value={n}>
                {n} days
              </option>
            ))}
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label>Train only top N products</Label>
          <Select
            value={String(settings.topNProducts)}
            onChange={(e) => updateSettings({ topNProducts: Number(e.target.value) })}
          >
            {[5, 8, 12, 20].map((n) => (
              <option key={n} value={n}>
                Top {n} by units sold
              </option>
            ))}
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label>Sales history for this run</Label>
          <Select
            value={settings.dataScenario}
            onChange={(e) =>
              updateSettings({ dataScenario: e.target.value === "thin" ? "thin" : "partner" })
            }
          >
            <option value="partner">Partner history (~24 weeks)</option>
            <option value="thin">Simulate thin partner data (4 weeks → public fallback)</option>
          </Select>
        </div>
        <Button
          variant="outline"
          onClick={() => {
            resetDemo();
            toast.success("Demo data restored.");
          }}
        >
          Reset demo data
        </Button>
      </CardContent>
    </Card>
  );
}
