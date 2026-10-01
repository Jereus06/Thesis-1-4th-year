import { createFileRoute } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { AccountAccessCard } from "@/components/account-access-card";
import { useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatShort, parseDate } from "@/lib/dates";
import { num, peso } from "@/lib/format";
import { useAppStore } from "@/lib/store";
import type { Product, Sale } from "@/lib/types";
import { api } from "@/lib/api";

export const Route = createFileRoute("/inventory")({ component: InventoryPage });

function InventoryPage() {
  return (
    <div className="page-enter mx-auto flex max-w-6xl flex-col gap-6">
      <header>
        <h1 className="font-display text-3xl font-medium tracking-tight">Inventory & records</h1>
        <p className="mt-2 max-w-2xl text-muted">
          Products, lead times, and safety stock drive reorder points. Sales history is the only
          input the models need.
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
          <div className="grid gap-6">
            <AccountAccessCard />
            <SettingsPanel />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ProductsPanel() {
  const products = useAppStore((s) => s.products);
  const updateProduct = useAppStore((s) => s.updateProduct);
  const addProduct = useAppStore((s) => s.addProduct);
  const importInventory = useAppStore((s) => s.importInventory);
  const [open, setOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [inventoryCsv, setInventoryCsv] = useState("");
  const [importing, setImporting] = useState(false);
  const session = useAppStore((s) => s.session);
  const [query, setQuery] = useState("");
  const filteredProducts = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return products;
    return products.filter((product) =>
      [product.name, product.sku, product.category].some((value) =>
        value.toLowerCase().includes(normalized),
      ),
    );
  }, [products, query]);

  async function importInventoryCsv() {
    try {
      const rows = parseInventoryCsv(inventoryCsv);
      if (!rows.length) {
        toast.error("No valid inventory rows. Check the required CSV columns and values.");
        return;
      }
      setImporting(true);
      await importInventory(rows);
      toast.success(`Imported ${rows.length} inventory rows.`);
      setInventoryCsv("");
      setImportOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Import failed");
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-sm">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
          <Input
            className="pl-9"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by product, SKU, or category"
            aria-label="Search inventory products"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {session && (
            <a
              className="self-center text-sm text-primary underline"
              href={api.exportUrl(session.businessId, "inventory-movements")}
            >
              Export stock movements
            </a>
          )}
          <Button variant="outline" onClick={() => setImportOpen((value) => !value)}>
            {importOpen ? "Close import" : "Import inventory"}
          </Button>
          <Button variant="outline" onClick={() => setOpen((v) => !v)}>
            {open ? "Close form" : "Add product"}
          </Button>
        </div>
      </div>
      {importOpen && (
        <Card>
          <CardHeader>
            <CardTitle>Import inventory snapshot</CardTitle>
            <CardDescription>
              This updates matching SKUs or adds new products. It records the current catalog and
              on-hand quantities only—not sales or stock deliveries.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <p className="text-xs text-muted">
              Columns: SKU, Product, Category, Unit, On Hand, Lead Time, Safety Stock, Unit Cost.
            </p>
            <textarea
              value={inventoryCsv}
              onChange={(event) => setInventoryCsv(event.target.value)}
              rows={7}
              className="w-full rounded-xl border border-border bg-surface p-3 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
              placeholder={
                "SKU,Product,Category,Unit,On Hand,Lead Time,Safety Stock,Unit Cost\nNS-500,Nature Spring Water 500ml,Beverages,bottle,80,2,24,12"
              }
            />
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={importInventoryCsv} disabled={importing}>
                Import inventory
              </Button>
              <CsvFileButton onLoad={setInventoryCsv} />
            </div>
          </CardContent>
        </Card>
      )}
      {open && <AddProductForm onAdd={addProduct} onDone={() => setOpen(false)} />}
      <div className="grid gap-3">
        {filteredProducts.map((p) => (
          <ProductEditor
            key={`${p.id}-${p.currentStock}-${p.leadTimeDays}-${p.safetyStock}`}
            product={p}
            onSave={(patch) => updateProduct(p.id, patch)}
          />
        ))}
        {filteredProducts.length === 0 && (
          <Card>
            <CardContent className="text-sm text-muted">
              {products.length
                ? `No products match “${query.trim()}”.`
                : "Your catalog is empty. Add a product or import an inventory snapshot."}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

function ProductEditor({
  product,
  onSave,
}: {
  product: Product;
  onSave: (patch: Partial<Product>) => Promise<void>;
}) {
  const [lead, setLead] = useState(String(product.leadTimeDays));
  const [ss, setSs] = useState(String(product.safetyStock));
  const [stock, setStock] = useState(String(product.currentStock));
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await onSave({
        leadTimeDays: Math.max(0, Number(lead) || 0),
        safetyStock: Math.max(0, Number(ss) || 0),
        currentStock: Math.max(0, Number(stock) || 0),
      });
      toast.success(`Updated ${product.name}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Save failed");
    } finally {
      setSaving(false);
    }
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
        <Field label="Lead time (days)" value={lead} onChange={setLead} step={1} />
        <Field label="Safety stock" value={ss} onChange={setSs} />
        <Button variant="secondary" onClick={save} disabled={saving}>
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
  step = 0.001,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  step?: number;
}) {
  return (
    <div className="grid gap-1.5">
      <Label>{label}</Label>
      <Input
        type="number"
        min={0}
        step={step}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

function AddProductForm({
  onAdd,
  onDone,
}: {
  onAdd: (p: Omit<Product, "id" | "sku"> & { sku?: string }) => Promise<void>;
  onDone: () => void;
}) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState("Staples");
  const [unit, setUnit] = useState("pc");
  const [stock, setStock] = useState("0");
  const [lead, setLead] = useState("3");
  const [ss, setSs] = useState("5");
  const [cost, setCost] = useState("10");
  const [saving, setSaving] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      await onAdd({
        name: name.trim(),
        category,
        unit,
        currentStock: Number(stock) || 0,
        leadTimeDays: Number(lead),
        safetyStock: Number(ss) || 0,
        unitCost: Number(cost) || 0,
      });
      toast.success(`Added ${name.trim()}`);
      onDone();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>New product</CardTitle>
        <CardDescription>
          Needs a few weeks of sales before forecasts become reliable.
        </CardDescription>
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
            <Button type="submit" disabled={saving}>
              Add to catalog
            </Button>
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
  const [importing, setImporting] = useState(false);
  const session = useAppStore((s) => s.session);
  const nameById = useMemo(
    () => Object.fromEntries(products.map((p) => [p.id, p.name])),
    [products],
  );
  const recent = [...sales].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 40);

  async function importCsv() {
    try {
      const rows = parseCsv(csv, products);
      if (!rows.length) {
        toast.error("No matching rows. Use Date, Product, Quantity.");
        return;
      }
      setImporting(true);
      await importSales(rows);
      toast.success(`Imported ${rows.length} sales rows.`);
      setCsv("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Import failed");
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
      <Card>
        <CardHeader>
          <CardTitle>Recent sales</CardTitle>
          <CardDescription>
            {num(sales.length)} sales rows ·{" "}
            {session ? "saved in PostgreSQL" : "browser demonstration"}
          </CardDescription>
          {session && (
            <a
              className="text-sm text-primary underline"
              href={api.exportUrl(session.businessId, "sales")}
            >
              Export sales CSV
            </a>
          )}
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
          <CardDescription>
            Columns: Date, Product, Quantity. Product can be name or SKU.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <textarea
            value={csv}
            onChange={(e) => setCsv(e.target.value)}
            rows={10}
            className="w-full rounded-xl border border-border bg-surface p-3 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            placeholder={
              "2026-09-18,Lucky Me Pancit Canton,12\n2026-09-18,Nature Spring Water 500ml,20"
            }
          />
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={importCsv} disabled={importing}>
              Import rows
            </Button>
            <CsvFileButton onLoad={setCsv} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function CsvFileButton({ onLoad }: { onLoad: (text: string) => void }) {
  return (
    <label className="inline-flex h-11 cursor-pointer items-center justify-center rounded-lg border border-border bg-surface px-4 text-sm font-medium hover:bg-surface-2">
      Upload CSV file
      <input
        type="file"
        accept=".csv,text/csv,text/plain"
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = () => {
            onLoad(String(reader.result ?? ""));
            toast.success(`Loaded ${file.name}`);
          };
          reader.readAsText(file);
          event.target.value = "";
        }}
      />
    </label>
  );
}

function parseInventoryCsv(text: string): Omit<Product, "id">[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const rows: Omit<Product, "id">[] = [];
  for (const line of lines) {
    if (/^sku\s*,/i.test(line)) continue;
    const [sku, name, category, unit, stockRaw, leadRaw, safetyRaw, costRaw] = line
      .split(",")
      .map((part) => part.trim());
    const values = [stockRaw, leadRaw, safetyRaw, costRaw].map(Number);
    if (!sku || !name || !category || !unit || values.some((value) => !Number.isFinite(value)))
      throw new Error(`Invalid inventory row: ${line}`);
    const [currentStock, leadTimeDays, safetyStock, unitCost] = values;
    if (
      currentStock < 0 ||
      !Number.isInteger(leadTimeDays) ||
      leadTimeDays < 0 ||
      safetyStock < 0 ||
      unitCost < 0
    )
      throw new Error(`Invalid inventory quantities: ${sku}`);
    rows.push({
      sku,
      name,
      category,
      unit,
      currentStock,
      leadTimeDays,
      safetyStock,
      unitCost,
    });
  }
  return rows;
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
    if (parts.length !== 3) throw new Error(`Expected Date, Product, Quantity: ${line}`);
    const [date, productKey, qtyRaw] = parts;
    const qty = Number(qtyRaw);
    if (!date || !Number.isFinite(qty) || qty <= 0) throw new Error(`Invalid sales row: ${line}`);
    const match = products.find(
      (p) =>
        p.name.toLowerCase() === productKey.toLowerCase() ||
        p.sku.toLowerCase() === productKey.toLowerCase() ||
        p.id === productKey,
    );
    if (!match) throw new Error(`Unknown product: ${productKey}`);
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
  const sales = useAppStore((s) => s.sales);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const resetDemo = useAppStore((s) => s.resetDemo);
  const mode = useAppStore((s) => s.dataMode);
  const [draft, setDraft] = useState(settings);
  const [saving, setSaving] = useState(false);
  const edit = (patch: Partial<typeof settings>) =>
    setDraft((current) => ({ ...current, ...patch }));
  async function saveSettings() {
    setSaving(true);
    try {
      await updateSettings(draft);
      toast.success("Settings saved.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }
  const history = useMemo(() => getSalesHistory(sales), [sales]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Store & model settings</CardTitle>
        <CardDescription>
          Business planning settings are separated from advanced forecasting controls.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid max-w-xl gap-4">
        <div className="grid gap-1.5">
          <Label>Store name</Label>
          <Input value={draft.storeName} onChange={(e) => edit({ storeName: e.target.value })} />
        </div>
        <div className="grid gap-1.5">
          <Label>Location</Label>
          <Input
            value={draft.storeLocation}
            onChange={(e) => edit({ storeLocation: e.target.value })}
          />
        </div>
        <div className="grid gap-1.5">
          <Label>Forecast horizon</Label>
          <Select
            value={String(draft.forecastHorizon)}
            onChange={(e) => edit({ forecastHorizon: Number(e.target.value) })}
          >
            {[7, 14, 21, 30].map((n) => (
              <option key={n} value={n}>
                {n} days
              </option>
            ))}
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label>Cover days after delivery</Label>
          <Select
            value={String(draft.coverDays)}
            onChange={(e) => edit({ coverDays: Number(e.target.value) })}
          >
            {[3, 7, 10, 14].map((n) => (
              <option key={n} value={n}>
                {n} days
              </option>
            ))}
          </Select>
        </div>
        <div className="rounded-xl border border-border bg-surface-2 p-4">
          <p className="text-sm font-medium">
            {history.limited ? "Limited history" : "Available sales history"}
          </p>
          {history.start && history.end ? (
            <>
              <p className="mt-1 text-sm">
                {formatShort(history.start)}, {parseDate(history.start).getFullYear()} –{" "}
                {formatShort(history.end)}, {parseDate(history.end).getFullYear()}
              </p>
              <p className="text-sm text-muted">
                {history.days} days / about {history.months} month{history.months === 1 ? "" : "s"}
              </p>
              {history.limited && (
                <p className="mt-2 text-sm text-warning">
                  Only about {history.weeks} week{history.weeks === 1 ? "" : "s"} of sales are
                  available. XGBoost eligibility may be unavailable and a simpler forecasting method
                  may be used.
                </p>
              )}
            </>
          ) : (
            <p className="mt-1 text-sm text-warning">
              No sales history is available. Add or import sales before forecasting.
            </p>
          )}
        </div>
        <div className="grid gap-4 rounded-xl border border-border p-4">
          <div>
            <p className="font-medium">Advanced forecasting settings</p>
            <p className="text-sm text-muted">
              Model controls for forecast experiments and eligibility.
            </p>
          </div>
          <div className="grid gap-1.5">
            <Label>Moving Average window (days)</Label>
            <Select
              value={String(draft.maWindow)}
              onChange={(e) => edit({ maWindow: Number(e.target.value) })}
            >
              {[3, 7, 14].map((n) => (
                <option key={n} value={n}>
                  {n} days
                </option>
              ))}
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label>ML product limit</Label>
            <Select
              value={String(draft.topNProducts)}
              onChange={(e) => edit({ topNProducts: Number(e.target.value) })}
            >
              {[5, 8, 12, 20].map((n) => (
                <option key={n} value={n}>
                  Top {n} eligible products
                </option>
              ))}
            </Select>
            <p className="text-xs text-muted">
              This is the maximum ML scope. Products must still pass data sufficiency and
              eligibility checks.
            </p>
          </div>
        </div>
        <Button onClick={saveSettings} disabled={saving}>
          {saving ? "Saving…" : "Save settings"}
        </Button>
        {mode === "browser-demo" && (
          <Button
            variant="outline"
            onClick={() => {
              resetDemo();
              toast.success("Demo data restored.");
            }}
          >
            Reset demo data
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function getSalesHistory(sales: Sale[]) {
  if (!sales.length) return { start: "", end: "", days: 0, weeks: 0, months: 0, limited: true };
  const dates = sales
    .map((sale) => sale.date)
    .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date))
    .sort();
  if (!dates.length) return { start: "", end: "", days: 0, weeks: 0, months: 0, limited: true };
  const start = dates[0];
  const end = dates[dates.length - 1];
  const days = Math.floor((parseDate(end).getTime() - parseDate(start).getTime()) / 86_400_000) + 1;
  return {
    start,
    end,
    days,
    weeks: Math.max(1, Math.round(days / 7)),
    months: Math.max(1, Math.round(days / 30.44)),
    limited: days < 56,
  };
}
