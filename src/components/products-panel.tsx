import { memo, useCallback, useMemo, useRef, useState, type FormEvent } from "react";
import { ChevronDown, Layers3, Package2, Plus, Search, Upload } from "lucide-react";
import { toast } from "sonner";
import { ReceiveStockDialog } from "@/components/receive-stock-dialog";
import { CsvImporter } from "@/components/csv-importer";
import { ImportRefreshNotice } from "@/components/import-refresh-notice";
import { ProductPhotoForm } from "@/components/product-photo-form";
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
import { num, peso, quantity } from "@/lib/format";
import { CSV_API_ROW_LIMITS } from "@/lib/csv-preparation";
import { usePermissions } from "@/lib/permissions";
import { generateProductSku } from "@/lib/product-sku";
import { useAppStore } from "@/lib/store";
import { useProductPhotos } from "@/lib/use-product-photos";
import type { ProductPhoto, ProductPhotos } from "@/lib/product-photos";
import type { SessionUser } from "@/lib/api";
import type { InventoryImportRow, Product } from "@/lib/types";

type ProductAction = { productId: string; kind: "edit" | "count" | "status" | "delete" | "photo" };
const InventoryCsvImporter = memo(CsvImporter);
type ProductGroup = {
  name: string;
  products: Product[];
};

export function ProductsPanel() {
  const products = useAppStore((state) => state.products);
  const importInventory = useAppStore((state) => state.importInventory);
  const session = useAppStore((state) => state.session);
  const mode = useAppStore((state) => state.dataMode);
  const stockRefreshError = useAppStore((state) => state.movementsError);
  const productPhotos = useProductPhotos();
  const { canManageProducts, canImportRecords, canReceiveStock } = usePermissions();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("active");
  const [adding, setAdding] = useState(false);
  const [action, setAction] = useState<ProductAction | null>(null);
  const [deliverySelection, setDeliverySelection] = useState<{
    product: Product;
    session: SessionUser | null;
  } | null>(null);
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
      deliverySelection?.session === session
        ? (products.find((product) => product.id === deliverySelection.product.id) ??
          deliverySelection.product)
        : null,
    [products, deliverySelection, session],
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
    async (rows: InventoryImportRow[], idempotencyKey: string) => {
      if (!canImportRecords || busy)
        throw new Error("Inventory import is unavailable while another change is being saved.");
      setImporting(true);
      try {
        await importInventory(rows, idempotencyKey);
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
    <div className="flex flex-col gap-5">
      <ImportRefreshNotice />
      {productPhotos.error && (
        <p className="text-sm text-muted" role="status">
          {productPhotos.error}
        </p>
      )}
      {(stockRefreshError?.startsWith("Stock count saved.") ||
        stockRefreshError?.startsWith("Product saved.")) && (
        <p className="text-sm text-warning" role="status">
          {stockRefreshError}
        </p>
      )}
      <div className="relative overflow-hidden rounded-3xl bg-primary text-primary-foreground">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-32 -right-16 size-80 rounded-full border border-white/10"
        />
        <div className="relative flex flex-wrap items-center justify-between gap-5 p-5 sm:p-7">
          <div>
            <p className="mb-2 flex items-center gap-2 text-xs font-medium tracking-[0.18em] text-white/70 uppercase">
              <Package2 className="size-4" aria-hidden="true" /> Product catalog
            </p>
            <h2 className="font-display text-3xl font-medium tracking-tight">Products</h2>
            <p className="mt-2 text-sm text-white/75">
              Browse your categories and keep every item up to date.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-sm">
            <span className="rounded-xl border border-white/15 bg-white/10 px-4 py-2.5">
              <span className="font-semibold tabular">{num(activeCount)}</span>{" "}
              <span className="text-white/75">active</span>
            </span>
            <span className="rounded-xl border border-white/15 bg-white/5 px-4 py-2.5">
              <span className="font-semibold tabular">{num(products.length - activeCount)}</span>{" "}
              <span className="text-white/75">inactive</span>
            </span>
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-border bg-surface p-4 sm:p-5">
        <div className="grid min-w-0 flex-[1_1_18rem] gap-2">
          <Label htmlFor="inventory-product-search" className="text-xs text-muted">
            Find a product
          </Label>
          <div className="relative">
            <Search
              className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted"
              aria-hidden="true"
            />
            <Input
              id="inventory-product-search"
              className="rounded-xl pl-10"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by product, SKU, or category"
              aria-label="Search inventory products"
            />
          </div>
        </div>
        <div className="grid flex-[1_1_10rem] gap-2 sm:flex-none">
          <Label htmlFor="inventory-product-status" className="text-xs text-muted">
            Product status
          </Label>
          <Select
            id="inventory-product-status"
            className="rounded-xl sm:min-w-44"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            aria-label="Filter products by active status"
          >
            <option value="active">Active ({activeCount})</option>
            <option value="inactive">Inactive ({products.length - activeCount})</option>
            <option value="all">All products ({products.length})</option>
          </Select>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canImportRecords && (
            <Button
              variant="outline"
              className="rounded-xl"
              disabled={busy}
              onClick={() => setImportOpen((value) => !value)}
            >
              <Upload aria-hidden="true" />
              {importOpen ? "Close import" : "Import inventory"}
            </Button>
          )}
          {canManageProducts && (
            <Button className="rounded-xl" disabled={busy} onClick={() => setAdding(true)}>
              <Plus aria-hidden="true" />
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
              Review products and stock counts before importing. Existing products keep their saved
              details by default.
            </p>
            <InventoryCsvImporter
              key={session ? `${session.businessId}:${session.userId}` : "browser-demo"}
              kind="inventory"
              products={products}
              disabled={saving}
              rowLimit={mode === "api" ? CSV_API_ROW_LIMITS.inventory : null}
              importLabel="Upload CSV"
              placeholder={
                "SKU,Product,Category,Unit,On Hand,Lead Time,Safety Stock,Unit Cost\nNS-500,Nature Spring Water 500ml,Beverages,bottle,80,2,24,12"
              }
              onImport={importPreparedInventory}
            />
          </CardContent>
        </Card>
      )}
      <ProductCards
        photos={productPhotos.photos}
        products={filteredProducts}
        totalCount={products.length}
        canReceiveStock={canReceiveStock}
        canManageProducts={canManageProducts}
        busy={busy}
        onDelivery={(productId) => {
          const product = products.find((item) => item.id === productId);
          if (product && product.isActive !== false) setDeliverySelection({ product, session });
        }}
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
                : action?.kind === "photo"
                  ? "Product photo"
                  : action?.kind === "edit"
                    ? "Edit product details"
                    : action?.kind === "count"
                      ? "Correct stock count"
                      : action?.kind === "delete"
                        ? "Delete product"
                        : selectedProduct?.isActive === false
                          ? "Activate product"
                          : "Deactivate product"}
            </DialogTitle>
            <DialogDescription>
              {adding
                ? "Add catalog details and the opening stock balance."
                : action?.kind === "photo"
                  ? "Choose a photo or use your camera. Save to attach it to this product."
                  : action?.kind === "edit"
                    ? "Update this product's catalog details."
                    : action?.kind === "count"
                      ? "Enter the verified on-hand balance. Changes are recorded as stock-count adjustments."
                      : action?.kind === "delete"
                        ? "Permanently remove this product. Products with stock or saved history cannot be deleted."
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
          {canManageProducts && selectedProduct && action?.kind === "photo" && (
            <ProductPhotoForm
              key={selectedProduct.id}
              product={selectedProduct}
              photo={productPhotos.photos[selectedProduct.id]}
              save={productPhotos.save}
              remove={productPhotos.remove}
              onDone={() => setAction(null)}
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
          {canManageProducts && selectedProduct && action?.kind === "delete" && (
            <ProductDeleteForm
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
        open={canReceiveStock && deliveryProduct !== null}
        onOpenChange={(open) => {
          if (!open) setDeliverySelection(null);
        }}
      />
    </div>
  );
}

const ProductCards = memo(function ProductCards({
  photos,
  products,
  totalCount,
  canReceiveStock,
  canManageProducts,
  busy,
  onDelivery,
  onAction,
}: {
  photos: ProductPhotos;
  products: Product[];
  totalCount: number;
  canReceiveStock: boolean;
  canManageProducts: boolean;
  busy: boolean;
  onDelivery: (productId: string) => void;
  onAction: (action: ProductAction) => void;
}) {
  const groupedProducts = useMemo(() => {
    const groups = new Map<string, ProductGroup>();
    for (const product of products) {
      const key = product.category.trim().toLocaleLowerCase();
      const existing = groups.get(key);
      if (existing) {
        existing.products.push(product);
      } else {
        groups.set(key, { name: product.category, products: [product] });
      }
    }
    return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name, "en"));
  }, [products]);

  return (
    <div
      className="record-scroll catalog-scroll grid gap-3"
      tabIndex={0}
      role="region"
      aria-label="Product categories"
    >
      {groupedProducts.map((group) => {
        const content = group.products.map((product) => (
          <ProductCard
            photo={photos[product.id]}
            key={product.id}
            product={product}
            canReceiveStock={canReceiveStock}
            canManageProducts={canManageProducts}
            busy={busy}
            onDelivery={onDelivery}
            onAction={onAction}
          />
        ));
        return (
          <details
            key={group.name}
            className="group/category overflow-hidden rounded-2xl border border-border bg-surface transition-colors open:border-primary/25"
          >
            <summary className="flex cursor-pointer list-none items-center gap-3 rounded-2xl p-4 transition-colors hover:bg-primary/5 focus-visible:outline-2 focus-visible:outline-offset-[-3px] focus-visible:outline-primary group-open/category:rounded-b-none group-open/category:bg-primary group-open/category:text-primary-foreground group-open/category:hover:bg-primary group-open/category:focus-visible:outline-white/80 sm:gap-4 sm:px-5 [&::-webkit-details-marker]:hidden">
              <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary group-open/category:bg-white/15 group-open/category:text-white">
                <Layers3 className="size-5" aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1 font-display text-lg font-medium break-words sm:text-xl">
                {group.name}
              </span>
              <span className="shrink-0 rounded-full bg-surface-2 px-2.5 py-1 text-xs text-muted group-open/category:bg-white/15 group-open/category:text-white/90 sm:px-3">
                {group.products.length} {group.products.length === 1 ? "item" : "items"}
              </span>
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full text-muted group-open/category:bg-white/10 group-open/category:text-white">
                <ChevronDown
                  className="size-4 transition-transform duration-200 group-open/category:rotate-180 motion-reduce:transition-none"
                  aria-hidden="true"
                />
              </span>
            </summary>
            <div
              className="record-scroll category-scroll grid gap-3 bg-primary/[0.025] p-3 sm:p-4"
              tabIndex={0}
              role="region"
              aria-label={`${group.name} products`}
            >
              {content}
            </div>
          </details>
        );
      })}
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
  photo,
  product,
  canReceiveStock,
  canManageProducts,
  busy,
  onDelivery,
  onAction,
}: {
  photo?: ProductPhoto;
  product: Product;
  canReceiveStock: boolean;
  canManageProducts: boolean;
  busy: boolean;
  onDelivery: (productId: string) => void;
  onAction: (action: ProductAction) => void;
}) {
  return (
    <Card className="shadow-none">
      <CardContent className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center sm:p-5">
        <div className="grid min-w-0 gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {photo && (
              <img
                key={photo.updatedAt}
                src={photo.src}
                crossOrigin="use-credentials"
                loading="lazy"
                alt={`Photo of ${product.name}`}
                className="size-16 rounded-lg bg-surface-2 object-contain"
              />
            )}
            <p className="font-medium break-words">{product.name}</p>
            <Badge variant={product.isActive === false ? "outline" : "success"}>
              {product.isActive === false ? "Inactive" : "Active"}
            </Badge>
          </div>
          <p className="text-xs leading-relaxed break-words text-muted">
            {product.sku} · {product.category} · Cost {peso(product.unitCost)} · Sell{" "}
            {peso(product.unitCost)} / {product.unit}
          </p>
          <dl className="grid grid-cols-3 gap-2 rounded-xl bg-surface-2/70 p-3 text-center text-sm">
            <div className="min-w-0">
              <dt className="text-xs text-muted">On hand</dt>
              <dd className="mt-1 font-medium break-words text-primary tabular">
                {quantity(product.currentStock)}{" "}
                <span className="text-xs font-normal text-muted">{product.unit}</span>
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs text-muted">Lead time</dt>
              <dd className="mt-1 font-medium tabular">
                {num(product.leadTimeDays)}{" "}
                <span className="text-xs font-normal text-muted">days</span>
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs text-muted">Safety stock</dt>
              <dd className="mt-1 font-medium break-words tabular">
                {quantity(product.safetyStock)}{" "}
                <span className="text-xs font-normal text-muted">{product.unit}</span>
              </dd>
            </div>
          </dl>
        </div>
        <div className="flex flex-wrap gap-2 border-t border-border/70 pt-4 lg:max-w-80 lg:justify-end lg:border-t-0 lg:pt-0">
          {canReceiveStock && product.isActive !== false && (
            <Button variant="outline" disabled={busy} onClick={() => onDelivery(product.id)}>
              Record delivery
            </Button>
          )}
          {canManageProducts && (
            <>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => onAction({ productId: product.id, kind: "photo" })}
              >
                {photo ? "Change photo" : "Add photo"}
              </Button>
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
              <Button
                variant="outline"
                className="text-danger"
                disabled={busy}
                onClick={() => onAction({ productId: product.id, kind: "delete" })}
              >
                Delete
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
  const categories = useMemo(
    () =>
      [
        ...new Set(["Staples", ...products.map((item) => item.category.trim()).filter(Boolean)]),
      ].sort((a, b) => a.localeCompare(b, "en")),
    [products],
  );
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
  const [customCategory, setCustomCategory] = useState(
    Boolean(draft.category) && !categories.includes(draft.category),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const prefix = product?.id ?? "new-product";
  const submitting = useRef(false);
  const retry = useRef<{ signature: string; sku: string; key: string } | null>(null);
  const [reservedSkus, setReservedSkus] = useState<string[]>([]);
  const generatedSku = useMemo(
    () => generateProductSku(draft.category, products, reservedSkus),
    [draft.category, products, reservedSkus],
  );
  const displayedSku =
    product || draft.sku.trim() ? draft.sku : (retry.current?.sku ?? generatedSku);
  const edit = (key: keyof typeof draft, value: string) => {
    retry.current = null;
    setDraft((current) => ({
      ...current,
      [key]: value,
      ...(!product && key === "category" ? { sku: "" } : {}),
    }));
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting.current || !canManageProducts) return;
    setError(null);
    try {
      const sku = displayedSku.trim();
      if (!sku) throw new Error("SKU is required.");
      for (const [label, value] of [
        ["Name", draft.name],
        ["Category", draft.category],
        ["Unit", draft.unit],
      ]) {
        if (!value.trim()) throw new Error(`${label} is required.`);
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
      const signature = JSON.stringify({ ...details, currentStock: openingStock });
      const retrying = !product && retry.current?.signature === signature;
      if (
        !retrying &&
        sku &&
        products.some(
          (item) => item.id !== product?.id && item.sku.trim().toLowerCase() === sku.toLowerCase(),
        )
      ) {
        throw new Error("Another product already uses this SKU. Choose a unique SKU.");
      }
      if (!product && !retrying)
        retry.current = {
          signature,
          sku,
          key: crypto.randomUUID(),
        };
      submitting.current = true;
      if (!product && !retrying) setReservedSkus((current) => [...current, sku]);
      setSaving(true);
      onPendingChange(true);
      if (product) await updateProduct(product.id, details);
      else
        await addProduct(
          { ...details, sku: retry.current!.sku, currentStock: openingStock! },
          retry.current!.key,
        );
      retry.current = null;
      toast.success(`${product ? "Updated" : "Added"} ${details.name}.`);
      onDone();
    } catch (failure) {
      const message =
        failure instanceof Error ? failure.message : "The product could not be saved.";
      setError(message);
      toast.error(message);
    } finally {
      submitting.current = false;
      setSaving(false);
      onPendingChange(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <fieldset disabled={saving} className="grid gap-3 sm:grid-cols-2">
        <TextField
          id={`${prefix}-sku`}
          label="SKU"
          value={displayedSku}
          onChange={(value) => edit("sku", value)}
          required
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
        {customCategory ? (
          <div className="grid gap-1">
            <TextField
              id={`${prefix}-category`}
              label="New category"
              value={draft.category}
              onChange={(value) => edit("category", value)}
              required
              maxLength={100}
            />
            <button
              type="button"
              className="justify-self-start text-xs text-primary underline"
              onClick={() => {
                setCustomCategory(false);
                edit("category", categories[0] ?? "Staples");
              }}
            >
              Choose an existing category
            </button>
          </div>
        ) : (
          <div className="grid gap-1">
            <Label htmlFor={`${prefix}-category`}>Category</Label>
            <Select
              id={`${prefix}-category`}
              value={draft.category}
              onChange={(event) => {
                if (event.target.value === "__new__") {
                  setCustomCategory(true);
                  edit("category", "");
                } else {
                  edit("category", event.target.value);
                }
              }}
              required
            >
              {categories.length === 0 && <option value="Staples">Staples</option>}
              {categories.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
              <option value="__new__">+ Add new category...</option>
            </Select>
          </div>
        )}
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
        <p className="text-xs text-muted">
          SKU is generated from the category and updates when it changes. You can enter your own
          code.
        </p>
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
  const submitting = useRef(false);
  const retry = useRef<{ signature: string; key: string } | null>(null);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting.current || !canManageProducts) return;
    setError(null);
    try {
      const currentStock = nonnegativeNumber(stock, "Verified stock count", 3);
      const signature = JSON.stringify({ productId: product.id, currentStock });
      const retrying = retry.current?.signature === signature;
      if (!retrying && currentStock === product.currentStock)
        throw new Error("The count is unchanged. Enter a different verified balance or cancel.");
      if (!retrying) retry.current = { signature, key: crypto.randomUUID() };
      submitting.current = true;
      setSaving(true);
      onPendingChange(true);
      await updateProduct(product.id, { currentStock }, retry.current!.key);
      retry.current = null;
      toast.success(`Corrected stock count for ${product.name}.`);
      onDone();
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : "The count could not be saved.";
      setError(message);
      toast.error(message);
    } finally {
      submitting.current = false;
      setSaving(false);
      onPendingChange(false);
    }
  }
  return (
    <form onSubmit={submit} className="grid gap-4">
      <div className="rounded-xl bg-surface-2 p-3 text-sm">
        <p className="font-medium">{product.name}</p>
        <p className="text-muted">
          Current balance: {quantity(product.currentStock)} {product.unit}
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

function ProductDeleteForm({
  product,
  onDone,
  onPendingChange,
}: FormCallbacks & { product: Product }) {
  const deleteProduct = useAppStore((state) => state.deleteProduct);
  const { canManageProducts } = usePermissions();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitting = useRef(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting.current || !canManageProducts) return;
    submitting.current = true;
    setSaving(true);
    onPendingChange(true);
    setError(null);
    try {
      const result = await deleteProduct(product.id);
      toast.success(
        result.deletedRows ? `Deleted ${product.name}.` : "Product is no longer in the catalog.",
      );
      onDone();
    } catch (failure) {
      const message =
        failure instanceof Error ? failure.message : "The product could not be deleted.";
      setError(message);
      toast.error(message);
    } finally {
      submitting.current = false;
      setSaving(false);
      onPendingChange(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <p className="text-sm">
        <span className="font-medium">{product.name}</span> · {product.sku} · On hand{" "}
        {quantity(product.currentStock)} {product.unit}
      </p>
      <p className="text-sm text-muted">This cannot be undone.</p>
      {error && (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" variant="danger" disabled={saving || !canManageProducts}>
          {saving ? "Deleting…" : "Delete product"}
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
        {quantity(product.currentStock)} {product.unit}
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
