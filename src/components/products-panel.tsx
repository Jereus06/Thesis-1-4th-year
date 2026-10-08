import { memo, useCallback, useMemo, useState, type FormEvent } from "react";
import { Search } from "lucide-react";
import { toast } from "sonner";
import { ReceiveStockDialog } from "@/components/receive-stock-dialog";
import { CsvImporter } from "@/components/csv-importer";
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
import { num, peso } from "@/lib/format";
import { CSV_API_ROW_LIMITS } from "@/lib/csv-preparation";
import { usePermissions } from "@/lib/permissions";
import { useAppStore } from "@/lib/store";
import type { Product } from "@/lib/types";

type ProductAction = { productId: string; kind: "edit" | "count" | "status" };
const InventoryCsvImporter = memo(CsvImporter);

export function ProductsPanel() {
  const products = useAppStore((state) => state.products);
  const importInventory = useAppStore((state) => state.importInventory);
  const session = useAppStore((state) => state.session);
  const mode = useAppStore((state) => state.dataMode);
  const { canManageProducts, canImportRecords, canReceiveStock } = usePermissions();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("active");
  const [adding, setAdding] = useState(false);
  const [action, setAction] = useState<ProductAction | null>(null);
  const [deliveryProductId, setDeliveryProductId] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [saving, setSaving] = useState(false);
  const busy = importing || saving;
  const activeCount = useMemo(
    () => products.filter((product) => product.isActive !== false).length,
    [products],
  );
  const selectedProduct = useMemo(
    () => products.find((product) => product.id === action?.productId),
    [products, action?.productId],
  );
  const deliveryProduct = useMemo(
    () =>
      products.find((product) => product.id === deliveryProductId && product.isActive !== false) ??
      null,
    [products, deliveryProductId],
  );
  const filteredProducts = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return products.filter((product) => {
      const active = product.isActive !== false;
      return (
        (status === "all" || (status === "active" ? active : !active)) &&
        [product.name, product.sku, product.category].some((value) =>
          value.toLowerCase().includes(normalized),
        )
      );
    });
  }, [products, query, status]);

  const importPreparedInventory = useCallback(
    async (rows: Omit<Product, "id">[]) => {
      if (!canImportRecords || busy)
        throw new Error("Inventory import is unavailable while another change is being saved.");
      setImporting(true);
      try {
        await importInventory(rows);
        toast.success(`Imported ${rows.length} inventory rows.`);
        setImportOpen(false);
        return true;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Import failed.";
        toast.error(message);
        throw error;
      } finally {
        setImporting(false);
      }
    },
    [canImportRecords, busy, importInventory],
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-48 flex-1 sm:max-w-sm">
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
        <Select
          className="w-auto"
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          aria-label="Filter products by active status"
        >
          <option value="active">Active ({activeCount})</option>
          <option value="inactive">Inactive ({products.length - activeCount})</option>
          <option value="all">All products ({products.length})</option>
        </Select>
        <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
          {session && (
            <a
              className="text-sm text-primary underline"
              href={api.exportUrl(session.businessId, "inventory-movements")}
            >
              Export stock movements
            </a>
          )}
          {canImportRecords && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setImportOpen((value) => !value)}
            >
              {importOpen ? "Close import" : "Import inventory"}
            </Button>
          )}
          {canManageProducts && (
            <Button variant="outline" disabled={busy} onClick={() => setAdding(true)}>
              Add product
            </Button>
          )}
        </div>
      </div>
      {canImportRecords && importOpen && (
        <Card>
          <CardHeader>
            <CardTitle>Import inventory snapshot</CardTitle>
            <CardDescription>
              Updates matching SKUs, reactivates matching inactive products, and adds new products.
              On-hand changes are stock-count corrections. Import sales in the Sales ledger.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <p className="text-xs text-muted">
              Match your spreadsheet columns to the product fields below. Review counting units and
              verified current stock before saving.
            </p>
            <InventoryCsvImporter
              key={session ? `${session.businessId}:${session.userId}` : "browser-demo"}
              kind="inventory"
              products={products}
              disabled={saving}
              rowLimit={mode === "api" ? CSV_API_ROW_LIMITS.inventory : null}
              importLabel="Import inventory"
              placeholder={
                "SKU,Product,Category,Unit,On Hand,Lead Time,Safety Stock,Unit Cost\nNS-500,Nature Spring Water 500ml,Beverages,bottle,80,2,24,12"
              }
              onImport={importPreparedInventory}
            />
          </CardContent>
        </Card>
      )}
      <ProductCards
        products={filteredProducts}
        totalCount={products.length}
        canReceiveStock={canReceiveStock}
        canManageProducts={canManageProducts}
        busy={busy}
        onDelivery={setDeliveryProductId}
        onAction={setAction}
      />
      <Dialog
        open={canManageProducts && (adding || !!selectedProduct)}
        onOpenChange={(open) => {
          if (!open && !saving) {
            setAdding(false);
            setAction(null);
          }
        }}
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {adding
                ? "New product"
                : action?.kind === "edit"
                  ? "Edit product details"
                  : action?.kind === "count"
                    ? "Correct stock count"
                    : selectedProduct?.isActive === false
                      ? "Activate product"
                      : "Deactivate product"}
            </DialogTitle>
            <DialogDescription>
              {adding
                ? "Add catalog details and the opening stock balance."
                : action?.kind === "edit"
                  ? "Maintain the product details used in your catalog and restocking decisions."
                  : action?.kind === "count"
                    ? "Enter the verified on-hand balance. Changes are recorded as stock-count adjustments."
                    : selectedProduct?.isActive === false
                      ? "Make this product available for new sales and stock movements."
                      : "Inactive products are excluded from new sales, stock movements, and restocking advice. Existing records and the stock balance are retained."}
            </DialogDescription>
          </DialogHeader>
          {canManageProducts && adding && (
            <ProductDetailsForm
              key="new-product"
              onDone={() => setAdding(false)}
              onPendingChange={setSaving}
            />
          )}
          {canManageProducts && !adding && selectedProduct && action?.kind === "edit" && (
            <ProductDetailsForm
              key={selectedProduct.id}
              product={selectedProduct}
              onDone={() => setAction(null)}
              onPendingChange={setSaving}
            />
          )}
          {canManageProducts && selectedProduct && action?.kind === "count" && (
            <StockCountForm
              key={selectedProduct.id}
              product={selectedProduct}
              onDone={() => setAction(null)}
              onPendingChange={setSaving}
            />
          )}
          {canManageProducts && selectedProduct && action?.kind === "status" && (
            <ProductStatusForm
              key={selectedProduct.id}
              product={selectedProduct}
              onDone={() => setAction(null)}
              onPendingChange={setSaving}
            />
          )}
        </DialogContent>
      </Dialog>
      <ReceiveStockDialog
        product={deliveryProduct}
        open={canReceiveStock && deliveryProductId !== null}
        onOpenChange={(open) => {
          if (!open) setDeliveryProductId(null);
        }}
      />
    </div>
  );
}

const ProductCards = memo(function ProductCards({
  products,
  totalCount,
  canReceiveStock,
  canManageProducts,
  busy,
  onDelivery,
  onAction,
}: {
  products: Product[];
  totalCount: number;
  canReceiveStock: boolean;
  canManageProducts: boolean;
  busy: boolean;
  onDelivery: (productId: string) => void;
  onAction: (action: ProductAction) => void;
}) {
  return (
    <div className="grid gap-3">
      {products.map((product) => (
        <ProductCard
          key={product.id}
          product={product}
          canReceiveStock={canReceiveStock}
          canManageProducts={canManageProducts}
          busy={busy}
          onDelivery={onDelivery}
          onAction={onAction}
        />
      ))}
      {products.length === 0 && (
        <Card>
          <CardContent className="text-sm text-muted">
            {totalCount
              ? "No products match your search and status filter."
              : canManageProducts
                ? "Your catalog is empty. Add a product or import an inventory snapshot."
                : "Your catalog is empty. An owner can add products."}
          </CardContent>
        </Card>
      )}
    </div>
  );
});

const ProductCard = memo(function ProductCard({
  product,
  canReceiveStock,
  canManageProducts,
  busy,
  onDelivery,
  onAction,
}: {
  product: Product;
  canReceiveStock: boolean;
  canManageProducts: boolean;
  busy: boolean;
  onDelivery: (productId: string) => void;
  onAction: (action: ProductAction) => void;
}) {
  return (
    <Card>
      <CardContent className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-center">
        <div className="grid gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium">{product.name}</p>
            <Badge variant={product.isActive === false ? "outline" : "success"}>
              {product.isActive === false ? "Inactive" : "Active"}
            </Badge>
          </div>
          <p className="text-xs text-muted">
            {product.sku} · {product.category} · {peso(product.unitCost)} / {product.unit}
          </p>
          <dl className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
            <div>
              <dt className="inline text-muted">On hand: </dt>
              <dd className="inline tabular">
                {num(product.currentStock, 3)} {product.unit}
              </dd>
            </div>
            <div>
              <dt className="inline text-muted">Lead time: </dt>
              <dd className="inline tabular">{num(product.leadTimeDays)} days</dd>
            </div>
            <div>
              <dt className="inline text-muted">Safety stock: </dt>
              <dd className="inline tabular">
                {num(product.safetyStock, 3)} {product.unit}
              </dd>
            </div>
          </dl>
        </div>
        <div className="flex flex-wrap gap-2 sm:max-w-80 sm:justify-end">
          {canReceiveStock && product.isActive !== false && (
            <Button variant="outline" disabled={busy} onClick={() => onDelivery(product.id)}>
              Record delivery
            </Button>
          )}
          {canManageProducts && (
            <>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => onAction({ productId: product.id, kind: "edit" })}
              >
                Edit details
              </Button>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => onAction({ productId: product.id, kind: "count" })}
              >
                Correct stock count
              </Button>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => onAction({ productId: product.id, kind: "status" })}
              >
                {product.isActive === false ? "Activate" : "Deactivate"}
              </Button>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
});

type FormCallbacks = { onDone: () => void; onPendingChange: (pending: boolean) => void };

function ProductDetailsForm({
  product,
  onDone,
  onPendingChange,
}: FormCallbacks & { product?: Product }) {
  const addProduct = useAppStore((state) => state.addProduct);
  const updateProduct = useAppStore((state) => state.updateProduct);
  const products = useAppStore((state) => state.products);
  const { canManageProducts } = usePermissions();
  const [draft, setDraft] = useState({
    sku: product?.sku ?? "",
    name: product?.name ?? "",
    category: product?.category ?? "Staples",
    unit: product?.unit ?? "pc",
    currentStock: String(product?.currentStock ?? 0),
    leadTimeDays: String(product?.leadTimeDays ?? 3),
    safetyStock: String(product?.safetyStock ?? 5),
    unitCost: String(product?.unitCost ?? 10),
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const prefix = product?.id ?? "new-product";
  const edit = (key: keyof typeof draft, value: string) =>
    setDraft((current) => ({ ...current, [key]: value }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving || !canManageProducts) return;
    setError(null);
    try {
      const sku = draft.sku.trim();
      if (product && !sku) throw new Error("SKU is required.");
      for (const [label, value] of [
        ["Name", draft.name],
        ["Category", draft.category],
        ["Unit", draft.unit],
      ]) {
        if (!value.trim()) throw new Error(`${label} is required.`);
      }
      if (
        sku &&
        products.some(
          (item) => item.id !== product?.id && item.sku.trim().toLowerCase() === sku.toLowerCase(),
        )
      ) {
        throw new Error("Another product already uses this SKU. Choose a unique SKU.");
      }
      const details = {
        ...(sku ? { sku } : {}),
        name: draft.name.trim(),
        category: draft.category.trim(),
        unit: draft.unit.trim(),
        leadTimeDays: nonnegativeNumber(draft.leadTimeDays, "Lead time", 0),
        safetyStock: nonnegativeNumber(draft.safetyStock, "Safety stock", 3),
        unitCost: nonnegativeNumber(draft.unitCost, "Unit cost", 4),
      };
      const openingStock = product
        ? null
        : nonnegativeNumber(draft.currentStock, "Opening stock", 3);
      setSaving(true);
      onPendingChange(true);
      if (product) await updateProduct(product.id, details);
      else await addProduct({ ...details, currentStock: openingStock! });
      toast.success(`${product ? "Updated" : "Added"} ${details.name}.`);
      onDone();
    } catch (failure) {
      const message =
        failure instanceof Error ? failure.message : "The product could not be saved.";
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
      onPendingChange(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <fieldset disabled={saving} className="grid gap-3 sm:grid-cols-2">
        <TextField
          id={`${prefix}-sku`}
          label={product ? "SKU" : "SKU (optional)"}
          value={draft.sku}
          onChange={(value) => edit("sku", value)}
          required={!!product}
          maxLength={100}
        />
        <TextField
          id={`${prefix}-name`}
          label="Name"
          value={draft.name}
          onChange={(value) => edit("name", value)}
          required
          maxLength={200}
        />
        <TextField
          id={`${prefix}-category`}
          label="Category"
          value={draft.category}
          onChange={(value) => edit("category", value)}
          required
          maxLength={100}
        />
        <TextField
          id={`${prefix}-unit`}
          label="Unit"
          value={draft.unit}
          onChange={(value) => edit("unit", value)}
          required
          maxLength={50}
        />
        {!product && (
          <NumericField
            id={`${prefix}-stock`}
            label="Opening stock"
            value={draft.currentStock}
            onChange={(value) => edit("currentStock", value)}
          />
        )}
        <NumericField
          id={`${prefix}-lead`}
          label="Lead time (days)"
          value={draft.leadTimeDays}
          onChange={(value) => edit("leadTimeDays", value)}
          step={1}
        />
        <NumericField
          id={`${prefix}-safety`}
          label="Safety stock"
          value={draft.safetyStock}
          onChange={(value) => edit("safetyStock", value)}
        />
        <NumericField
          id={`${prefix}-cost`}
          label="Unit cost (PHP)"
          value={draft.unitCost}
          onChange={(value) => edit("unitCost", value)}
          step={0.0001}
        />
      </fieldset>
      {!product && (
        <p className="text-xs text-muted">Leave SKU blank to generate one automatically.</p>
      )}
      {product && (
        <p className="text-xs text-muted">
          Changing the unit label does not convert existing stock or sales quantities. Keep one
          consistent counting unit.
        </p>
      )}
      {error && (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={saving || !canManageProducts}>
          {saving ? "Saving…" : product ? "Save details" : "Add to catalog"}
        </Button>
        <Button type="button" variant="outline" disabled={saving} onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function StockCountForm({
  product,
  onDone,
  onPendingChange,
}: FormCallbacks & { product: Product }) {
  const updateProduct = useAppStore((state) => state.updateProduct);
  const { canManageProducts } = usePermissions();
  const [stock, setStock] = useState(String(product.currentStock));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving || !canManageProducts) return;
    setError(null);
    try {
      const currentStock = nonnegativeNumber(stock, "Verified stock count", 3);
      if (currentStock === product.currentStock)
        throw new Error("The count is unchanged. Enter a different verified balance or cancel.");
      setSaving(true);
      onPendingChange(true);
      await updateProduct(product.id, { currentStock });
      toast.success(`Corrected stock count for ${product.name}.`);
      onDone();
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : "The count could not be saved.";
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
      onPendingChange(false);
    }
  }
  return (
    <form onSubmit={submit} className="grid gap-4">
      <div className="rounded-xl bg-surface-2 p-3 text-sm">
        <p className="font-medium">{product.name}</p>
        <p className="text-muted">
          Current balance: {num(product.currentStock, 3)} {product.unit}
        </p>
      </div>
      <fieldset disabled={saving}>
        <NumericField
          id={`count-${product.id}`}
          label={`Verified on-hand count (${product.unit})`}
          value={stock}
          onChange={setStock}
        />
      </fieldset>
      <p className="text-xs text-muted">
        Use Record delivery, Return, or Write-off for actual stock movements. This corrects the
        recorded balance after a stock count.
      </p>
      {error && (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" disabled={saving || !canManageProducts}>
          {saving ? "Saving…" : "Save count correction"}
        </Button>
        <Button type="button" variant="outline" disabled={saving} onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function ProductStatusForm({
  product,
  onDone,
  onPendingChange,
}: FormCallbacks & { product: Product }) {
  const updateProduct = useAppStore((state) => state.updateProduct);
  const { canManageProducts } = usePermissions();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activating = product.isActive === false;
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving || !canManageProducts) return;
    setError(null);
    setSaving(true);
    onPendingChange(true);
    try {
      await updateProduct(product.id, { isActive: activating });
      toast.success(`${activating ? "Activated" : "Deactivated"} ${product.name}.`);
      onDone();
    } catch (failure) {
      const message =
        failure instanceof Error ? failure.message : "The product status could not be saved.";
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
      onPendingChange(false);
    }
  }
  return (
    <form onSubmit={submit} className="grid gap-4">
      <p className="text-sm">
        <span className="font-medium">{product.name}</span> · {product.sku} · On hand{" "}
        {num(product.currentStock, 3)} {product.unit}
      </p>
      {error && (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" disabled={saving || !canManageProducts}>
          {saving ? "Saving…" : activating ? "Activate product" : "Deactivate product"}
        </Button>
        <Button type="button" variant="outline" disabled={saving} onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function nonnegativeNumber(raw: string, label: string, precision: number) {
  const value = Number(raw);
  if (!raw.trim() || !Number.isFinite(value) || value < 0)
    throw new Error(`${label} must be a nonnegative number.`);
  if (precision === 0 && !Number.isSafeInteger(value))
    throw new Error(`${label} must be a whole number.`);
  if (precision > 0 && Number(value.toFixed(precision)) !== value) {
    throw new Error(`${label} supports up to ${precision} decimal places.`);
  }
  return value;
}

function TextField({
  id,
  label,
  value,
  onChange,
  required,
  maxLength,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  maxLength: number;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required={required}
        maxLength={maxLength}
      />
    </div>
  );
}

function NumericField({
  id,
  label,
  value,
  onChange,
  step = 0.001,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  step?: number;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="number"
        required
        min={0}
        step={step}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}
