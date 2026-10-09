import { create } from "zustand";
import { persist } from "zustand/middleware";
import { createSeedProducts, createSeedSales, defaultSettings } from "@/lib/data/seed";
import { todayISO } from "@/lib/dates";
import { invalidatePipelineCache } from "@/lib/forecast/cache";
import {
  api,
  ApiError,
  type BusinessRegistration,
  type SessionUser,
  type SignUpRequest,
} from "@/lib/api";
import type {
  InventoryImportRow,
  InventoryMovement,
  Product,
  ProductPatch,
  Sale,
  SalesImportResult,
  Settings,
  StockMovementInput,
} from "@/lib/types";
import { fromApiSettings } from "@/lib/settings";
import { deduplicateSales, isImportedSale } from "@/lib/sales-import";

type Store = {
  dataOrigin: "demo" | "partner";
  dataMode: "browser-demo" | "api";
  session: SessionUser | null;
  apiStatus: "idle" | "loading" | "ready" | "error";
  apiError: string | null;
  products: Product[];
  sales: Sale[];
  importRefreshWarning: string | null;
  inventoryMovements: InventoryMovement[];
  movementsStatus: "idle" | "loading" | "ready" | "error";
  movementsError: string | null;
  settings: Settings;
  connectApi: () => Promise<void>;
  signIn: (businessId: string | undefined, email: string, password: string) => Promise<void>;
  signUp: (details: SignUpRequest) => Promise<void>;
  completeGoogle: (details: BusinessRegistration) => Promise<void>;
  signOut: () => Promise<void>;
  recordSale: (productId: string, date: string, qty: number) => Promise<void>;
  receiveStock: (productId: string, qty: number) => Promise<void>;
  recordStockMovement: (input: StockMovementInput) => Promise<void>;
  refreshInventoryMovements: () => Promise<void>;
  updateProduct: (id: string, patch: ProductPatch) => Promise<void>;
  addProduct: (product: Omit<Product, "id" | "sku"> & { sku?: string }) => Promise<void>;
  importInventory: (rows: InventoryImportRow[], idempotencyKey?: string) => Promise<void>;
  updateSettings: (patch: Partial<Settings>) => Promise<void>;
  importSales: (rows: Sale[]) => Promise<SalesImportResult>;
  deleteImportedSales: (saleId?: string) => Promise<{ deletedRows: number }>;
  resetDemo: () => void;
};

const dataMode = import.meta.env.VITE_DATA_MODE === "browser-demo" ? "browser-demo" : "api";
let movementRefreshSequence = 0;
let authRequestSequence = 0;

export const useAppStore = create<Store>()(
  persist(
    (set, get) => ({
      products: dataMode === "api" ? [] : createSeedProducts(),
      sales: dataMode === "api" ? [] : createSeedSales(),
      importRefreshWarning: null,
      inventoryMovements: [],
      movementsStatus: "idle",
      movementsError: null,
      settings:
        dataMode === "api"
          ? { ...defaultSettings, storeName: "StockCast Store", storeLocation: "" }
          : defaultSettings,
      dataMode,
      dataOrigin: "demo",
      session: null,
      apiStatus: "idle",
      apiError: null,
      connectApi: async () => {
        if (get().dataMode !== "api") return;
        const requestSequence = ++authRequestSequence;
        set({ apiStatus: "loading", apiError: null });
        try {
          const session = await api.me();
          if (requestSequence !== authRequestSequence) return;
          await loadApiState(session, set, () => requestSequence === authRequestSequence);
        } catch (error) {
          if (requestSequence !== authRequestSequence) return;
          const anonymous = error instanceof ApiError && error.status === 401;
          set({
            ...anonymousApiState(),
            apiStatus: anonymous ? "idle" : "error",
            apiError: anonymous
              ? null
              : error instanceof Error
                ? error.message
                : "Unable to connect",
          });
        }
      },
      signIn: async (businessId, email, password) => {
        const requestSequence = ++authRequestSequence;
        let authenticated = false;
        set({ apiStatus: "loading", apiError: null });
        try {
          const session = await api.signIn(businessId, email, password);
          authenticated = true;
          if (requestSequence !== authRequestSequence) return;
          await loadApiState(session, set, () => requestSequence === authRequestSequence);
        } catch (error) {
          if (requestSequence !== authRequestSequence) return;
          if (authenticated) {
            set({
              ...anonymousApiState(),
              apiStatus: "error",
              apiError:
                "You signed in, but store records could not be loaded. Reload this page to try loading your store.",
            });
            return;
          }
          set({
            apiStatus: "error",
            apiError: error instanceof Error ? error.message : "Sign-in failed",
          });
          throw error;
        }
      },
      signUp: async (details) => {
        const requestSequence = ++authRequestSequence;
        let authenticated = false;
        set({ apiStatus: "loading", apiError: null });
        try {
          const session = await api.signUp(details);
          authenticated = true;
          if (requestSequence !== authRequestSequence) return;
          await loadApiState(session, set, () => requestSequence === authRequestSequence);
        } catch (error) {
          if (requestSequence !== authRequestSequence) return;
          if (authenticated) {
            set({
              ...anonymousApiState(),
              apiStatus: "error",
              apiError:
                "Your account was created, but store records could not be loaded. Reload this page to try loading your store.",
            });
            return;
          }
          set({
            apiStatus: "error",
            apiError: error instanceof Error ? error.message : "Account creation failed",
          });
          throw error;
        }
      },
      completeGoogle: async (details) => {
        const requestSequence = ++authRequestSequence;
        let authenticated = false;
        set({ apiStatus: "loading", apiError: null });
        try {
          const session = await api.completeGoogle(details);
          authenticated = true;
          if (requestSequence !== authRequestSequence) return;
          await loadApiState(session, set, () => requestSequence === authRequestSequence);
        } catch (error) {
          if (requestSequence !== authRequestSequence) return;
          if (authenticated) {
            set({
              ...anonymousApiState(),
              apiStatus: "error",
              apiError:
                "Your Google account setup was completed, but store records could not be loaded. Reload this page to try loading your store.",
            });
            return;
          }
          set({
            apiStatus: "error",
            apiError: error instanceof Error ? error.message : "Google account setup failed",
          });
          throw error;
        }
      },
      signOut: async () => {
        if (get().dataMode !== "api") return;
        const requestSequence = ++authRequestSequence;
        try {
          await api.signOut();
        } catch (error) {
          // An expired or revoked session is already signed out on the server.
          if (!(error instanceof ApiError && error.status === 401)) throw error;
        }
        if (requestSequence === authRequestSequence) set(anonymousApiState());
      },
      recordSale: async (productId, date, qty) => {
        validateQuantity(qty);
        const product = requireActiveProduct(get(), productId);
        if (qty > product.currentStock) throw new Error("Sale quantity exceeds current stock.");
        if (get().dataMode === "api") {
          const session = requireSession(get());
          const sale = await api.recordSale(session.businessId, productId, date, qty);
          if (get().session !== session) return;
          set({
            sales: [...get().sales, sale],
            products: get().products.map((p) =>
              p.id === productId
                ? { ...p, currentStock: stockBalance(p.currentStock - sale.qty) }
                : p,
            ),
            movementsStatus: "idle",
          });
          try {
            const products = await api.products(session.businessId);
            if (get().session === session) set({ products });
          } catch {
            if (get().session === session)
              set({
                movementsStatus: "error",
                movementsError:
                  "Sale saved. Refresh stock movements to verify the latest balances.",
              });
          }
          return;
        }
        const sale: Sale = {
          id: `s-${productId}-${date}-${Date.now()}`,
          productId,
          date: date || todayISO(),
          qty,
          source: "manual",
        };
        set({
          sales: [...get().sales, sale],
          products: get().products.map((p) =>
            p.id === productId
              ? { ...p, currentStock: stockBalance(p.currentStock - sale.qty) }
              : p,
          ),
          inventoryMovements: [
            demoMovement(
              productId,
              date || todayISO(),
              "sale",
              -qty,
              stockBalance(product.currentStock - qty),
              null,
              sale.id,
            ),
            ...get().inventoryMovements,
          ],
        });
      },
      receiveStock: async (productId, qty) => {
        await get().recordStockMovement({
          productId,
          movementDate: todayISO(),
          movementType: "receipt",
          quantityDelta: qty,
        });
      },
      recordStockMovement: async (input) => {
        validateQuantity(Math.abs(input.quantityDelta));
        const product = requireActiveProduct(get(), input.productId);
        if (input.movementType === "write_off" || input.movementType === "adjustment") {
          requireOwner(get());
        }
        if (
          (input.movementType === "receipt" || input.movementType === "return") &&
          input.quantityDelta < 0
        ) {
          throw new Error("Deliveries and returns must increase stock.");
        }
        if (input.movementType === "write_off" && input.quantityDelta > 0) {
          throw new Error("Write-offs must decrease stock.");
        }
        const balance = stockBalance(product.currentStock + input.quantityDelta);
        if (balance < 0) throw new Error("Movement would make stock negative.");
        if (get().dataMode === "api") {
          const session = requireSession(get());
          const movement = await api.recordStockMovement(session.businessId, input);
          if (get().session !== session) return;
          // Use the saved balance directly: a failed follow-up read must not invite a duplicate write.
          set({
            products: get().products.map((p) =>
              p.id === input.productId ? { ...p, currentStock: movement.balanceAfter } : p,
            ),
            inventoryMovements: [
              movement,
              ...get().inventoryMovements.filter((m) => m.id !== movement.id),
            ],
          });
          return;
        }
        set({
          products: get().products.map((p) =>
            p.id === input.productId ? { ...p, currentStock: balance } : p,
          ),
          inventoryMovements: [
            demoMovement(
              input.productId,
              input.movementDate,
              input.movementType,
              input.quantityDelta,
              balance,
              input.note?.trim() || null,
            ),
            ...get().inventoryMovements,
          ],
        });
      },
      refreshInventoryMovements: async () => {
        if (get().dataMode === "browser-demo") {
          set({ movementsStatus: "ready", movementsError: null });
          return;
        }
        const session = requireSession(get());
        const requestSequence = ++movementRefreshSequence;
        set({ movementsStatus: "loading", movementsError: null });
        try {
          for (;;) {
            const previousProducts = get().products;
            const previousMovements = get().inventoryMovements;
            const [products, inventoryMovements] = await Promise.all([
              api.products(session.businessId),
              api.inventoryMovements(session.businessId),
            ]);
            if (get().session !== session || requestSequence !== movementRefreshSequence) return;
            // A write during this read makes its snapshot obsolete. Read again rather than
            // replacing a newly saved balance, audit entry, or product status with older data.
            if (
              get().products !== previousProducts ||
              get().inventoryMovements !== previousMovements
            ) {
              set({ movementsStatus: "loading" });
              continue;
            }
            set({ products, inventoryMovements, movementsStatus: "ready" });
            return;
          }
        } catch (error) {
          if (get().session !== session || requestSequence !== movementRefreshSequence) return;
          set({
            movementsStatus: "error",
            movementsError:
              error instanceof Error ? error.message : "Unable to load stock movements.",
          });
          throw error;
        }
      },
      updateProduct: async (id, patch) => {
        requireOwner(get());
        if (get().dataMode === "api") {
          const session = requireSession(get());
          const updated = await api.updateProduct(session.businessId, id, patch);
          if (get().session !== session) return;
          set({
            products: get().products.map((item) => (item.id === id ? updated : item)),
            movementsStatus: "idle",
          });
          return;
        }
        const previous = get().products.find((p) => p.id === id);
        if (!previous) throw new Error("Product not found.");
        const delta = stockBalance(
          (patch.currentStock ?? previous.currentStock) - previous.currentStock,
        );
        set({
          products: get().products.map((p) => (p.id === id ? { ...p, ...patch, id: p.id } : p)),
          inventoryMovements: delta
            ? [
                demoMovement(
                  id,
                  todayISO(),
                  "adjustment",
                  delta,
                  patch.currentStock!,
                  "Catalog stock count adjustment",
                ),
                ...get().inventoryMovements,
              ]
            : get().inventoryMovements,
        });
      },
      addProduct: async (product) => {
        requireOwner(get());
        if (get().dataMode === "api") {
          const session = requireSession(get());
          const created = await api.createProduct(session.businessId, {
            ...product,
            sku: product.sku?.trim() || `SKU-${Date.now()}`,
          });
          if (get().session !== session) return;
          set({ products: [...get().products, created], movementsStatus: "idle" });
          return;
        }
        const id = `p-${Date.now()}`;
        const sku = product.sku?.trim() || id.toUpperCase();
        set({
          products: [
            ...get().products,
            {
              id,
              sku,
              name: product.name,
              category: product.category,
              unit: product.unit,
              currentStock: product.currentStock,
              leadTimeDays: product.leadTimeDays,
              safetyStock: product.safetyStock,
              unitCost: product.unitCost,
              isActive: true,
            },
          ],
          inventoryMovements:
            product.currentStock > 0
              ? [
                  demoMovement(
                    id,
                    todayISO(),
                    "opening_balance",
                    product.currentStock,
                    product.currentStock,
                    "Initial product balance",
                  ),
                  ...get().inventoryMovements,
                ]
              : get().inventoryMovements,
        });
      },
      importInventory: async (rows, idempotencyKey) => {
        requireOwner(get());
        if (!rows.length) return;
        if (get().dataMode === "api") {
          const session = requireSession(get());
          await api.importInventory(session.businessId, rows, idempotencyKey);
          if (!sameSession(get().session, session)) return;
          set({ movementsStatus: "idle" });
          try {
            const products = await api.products(session.businessId);
            if (sameSession(get().session, session)) {
              set({ products, movementsStatus: "idle", importRefreshWarning: null });
            }
          } catch {
            if (sameSession(get().session, session)) {
              set({
                importRefreshWarning:
                  "Inventory import was saved, but the product list could not be refreshed. Reload saved records; do not repeat the import.",
              });
            }
          }
          return;
        }
        const importedBySku = new Map(rows.map((row) => [row.sku.toLowerCase(), row]));
        const existingSkus = new Set(get().products.map((product) => product.sku.toLowerCase()));
        const newRows = rows.filter((row) => !existingSkus.has(row.sku.toLowerCase()));
        // Check every new product before applying any part of the stock count.
        for (const row of newRows) {
          const required = [
            "name",
            "category",
            "unit",
            "leadTimeDays",
            "safetyStock",
            "unitCost",
          ] as const;
          if (required.some((field) => row[field] === undefined || row[field] === ""))
            throw new Error(
              `New SKU ${row.sku} needs its product details. Add it in Products first.`,
            );
        }
        const updated = get().products.map((product) => {
          const imported = importedBySku.get(product.sku.toLowerCase());
          return imported ? { ...product, ...imported, id: product.id, isActive: true } : product;
        });
        const added = newRows.map((row, index) => ({
          ...(row as Omit<Product, "id">),
          id: `p-import-${Date.now()}-${index}`,
          isActive: true,
        }));
        const movements: InventoryMovement[] = [];
        updated.forEach((product, index) => {
          const delta = stockBalance(product.currentStock - get().products[index].currentStock);
          if (delta)
            movements.push(
              demoMovement(
                product.id,
                todayISO(),
                "adjustment",
                delta,
                product.currentStock,
                "Catalog stock count adjustment",
              ),
            );
        });
        added.forEach((product) => {
          if (product.currentStock > 0)
            movements.push(
              demoMovement(
                product.id,
                todayISO(),
                "opening_balance",
                product.currentStock,
                product.currentStock,
                "Initial product balance",
              ),
            );
        });
        set({
          products: [...updated, ...added],
          inventoryMovements: [...movements, ...get().inventoryMovements],
        });
      },
      updateSettings: async (patch) => {
        requireOwner(get());
        const settings = { ...get().settings, ...patch };
        if (get().dataMode === "api") {
          const session = requireSession(get());
          const saved = await api.updateSettings(session.businessId, settings);
          if (get().session !== session) return;
          set({
            settings: fromApiSettings(
              saved,
              { name: settings.storeName, location: settings.storeLocation },
              settings,
            ),
          });
          return;
        }
        set({ settings });
      },
      importSales: async (rows) => {
        requireOwner(get());
        if (!rows.length) return { acceptedRows: 0, rejectedRows: 0, errors: [] };
        if (get().dataMode === "api") {
          const session = requireSession(get());
          const byId = new Map(get().products.map((product) => [product.id, product.sku]));
          const result = await api.importSales(
            session.businessId,
            rows.map((row) => ({
              sku: byId.get(row.productId) ?? row.productId,
              saleDate: row.date,
              quantity: String(row.qty),
              sourceRecordKey: row.sourceRecordKey,
            })),
          );
          if (!sameSession(get().session, session)) return result;
          await refreshApiSales(
            session,
            set,
            get,
            "Sales import was saved, but the ledger could not be refreshed. Reload saved records; do not repeat the import.",
          );
          return result;
        }
        const { accepted, result } = deduplicateSales(get().sales, rows);
        set({
          sales: [
            ...get().sales,
            ...accepted.map((sale) => ({
              ...sale,
              id: crypto.randomUUID(),
              source: "csv_import" as const,
            })),
          ],
        });
        return result;
      },
      deleteImportedSales: async (saleId) => {
        requireOwner(get());
        const selected = get().sales.filter(
          (sale) => isImportedSale(sale) && (saleId === undefined || sale.id === saleId),
        );
        if (saleId !== undefined && !selected.length)
          throw new Error("Only imported sales can be deleted.");
        const selectedIds = new Set(selected.map((sale) => sale.id));
        if (get().dataMode === "api") {
          const session = requireSession(get());
          const result = await api.deleteImportedSales(session.businessId, saleId);
          if (!sameSession(get().session, session)) return result;
          set({ sales: get().sales.filter((sale) => !selectedIds.has(sale.id)) });
          await refreshApiSales(
            session,
            set,
            get,
            "Sales deleted, but the ledger could not be refreshed. Reload saved records; do not repeat the deletion.",
          );
          return result;
        }
        if (
          get().inventoryMovements.some(
            (movement) => movement.saleId && selectedIds.has(movement.saleId),
          )
        )
          throw new Error("Sales linked to stock movements cannot be deleted.");
        invalidatePipelineCache();
        set({ sales: get().sales.filter((sale) => !selectedIds.has(sale.id)) });
        return { deletedRows: selected.length };
      },
      resetDemo: () => {
        if (get().dataMode !== "browser-demo") return;
        invalidatePipelineCache();
        set({
          products: createSeedProducts(),
          sales: createSeedSales(),
          inventoryMovements: [],
          movementsStatus: "idle",
          movementsError: null,
          settings: defaultSettings,
        });
      },
    }),
    {
      name: dataMode === "browser-demo" ? "stockcast-v5" : "stockcast-api-ui",
      version: 5,
      partialize: (state) =>
        state.dataMode === "browser-demo"
          ? {
              products: state.products,
              sales: state.sales,
              settings: state.settings,
              inventoryMovements: state.inventoryMovements,
            }
          : {},
      merge: (persisted, current) => {
        if (current.dataMode === "api") return current;
        const p = (persisted ?? {}) as Partial<Store>;
        const seenIds = new Set<string>();
        const sales = (p.sales ?? current.sales).map((sale) => {
          if (isImportedSale(sale)) {
            // Older preparations reused row-number IDs between separate uploads.
            // Retain every row while giving duplicate imported IDs their own identity.
            const id = seenIds.has(sale.id) ? crypto.randomUUID() : sale.id;
            seenIds.add(id);
            return { ...sale, id, source: sale.source ?? ("csv_import" as const) };
          }
          seenIds.add(sale.id);
          return sale;
        });
        return {
          ...current,
          ...p,
          sales,
          settings: { ...defaultSettings, ...(p.settings ?? {}) },
        };
      },
    },
  ),
);

function requireSession(store: Store): SessionUser {
  if (!store.session) throw new Error("Your session has expired. Sign in again.");
  return store.session;
}

function sameSession(current: SessionUser | null, submitted: SessionUser): boolean {
  return current === submitted;
}

async function refreshApiSales(
  session: SessionUser,
  set: (patch: Partial<Store>) => void,
  get: () => Store,
  warning: string,
) {
  try {
    for (;;) {
      const previousSales = get().sales;
      const sales = await api.sales(session.businessId);
      if (!sameSession(get().session, session)) return;
      if (get().sales !== previousSales) continue;
      set({ sales, importRefreshWarning: null });
      return;
    }
  } catch {
    if (sameSession(get().session, session)) set({ importRefreshWarning: warning });
  }
}

function anonymousApiState(): Partial<Store> {
  return {
    session: null,
    products: [],
    sales: [],
    importRefreshWarning: null,
    inventoryMovements: [],
    movementsStatus: "idle",
    movementsError: null,
    settings: { ...defaultSettings, storeName: "StockCast Store", storeLocation: "" },
    dataOrigin: "demo",
    apiStatus: "idle",
    apiError: null,
  };
}

function requireOwner(store: Store) {
  if (store.dataMode === "api" && requireSession(store).role !== "owner") {
    throw new Error("Owner role required.");
  }
}

function requireActiveProduct(store: Store, productId: string): Product {
  const product = store.products.find((item) => item.id === productId && item.isActive !== false);
  if (!product) throw new Error("Choose an active product.");
  return product;
}

function validateQuantity(quantity: number) {
  if (!Number.isFinite(quantity) || quantity <= 0 || Number(quantity.toFixed(3)) !== quantity) {
    throw new Error("Enter a positive quantity with up to three decimal places.");
  }
}

function stockBalance(value: number) {
  return Math.round(value * 1000) / 1000;
}

function demoMovement(
  productId: string,
  movementDate: string,
  movementType: InventoryMovement["movementType"],
  quantityDelta: number,
  balanceAfter: number,
  note: string | null,
  saleId: string | null = null,
): InventoryMovement {
  return {
    id: crypto.randomUUID(),
    productId,
    movementDate,
    movementType,
    quantityDelta,
    balanceAfter,
    dataOrigin: "demo",
    saleId,
    note,
    recordedBy: null,
  };
}

async function loadApiState(
  session: SessionUser,
  set: (patch: Partial<Store>) => void,
  isCurrent: () => boolean,
) {
  const [products, sales, rawSettings, business] = await Promise.all([
    api.products(session.businessId),
    api.sales(session.businessId),
    api.settings(session.businessId),
    api.business(session.businessId),
  ]);
  if (!isCurrent()) return;
  const settings = fromApiSettings(rawSettings, business, defaultSettings);
  set({
    session,
    products,
    sales,
    importRefreshWarning: null,
    inventoryMovements: [],
    movementsStatus: "idle",
    movementsError: null,
    settings,
    dataOrigin: business.dataOrigin,
    apiStatus: "ready",
    apiError: null,
  });
}
