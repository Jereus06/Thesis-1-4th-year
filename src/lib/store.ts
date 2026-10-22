import { create } from "zustand";
import { persist } from "zustand/middleware";
import { createSeedProducts, createSeedSales, defaultSettings } from "@/lib/data/seed";
import { businessDateISO, todayISO } from "@/lib/dates";
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
import { fromApiSettings, type ApiSettings } from "@/lib/settings";
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
  recordSale: (
    productId: string,
    date: string,
    qty: number,
    idempotencyKey?: string,
  ) => Promise<void>;
  receiveStock: (
    productId: string,
    qty: number,
    submission?: Pick<StockMovementInput, "idempotencyKey" | "movementDate">,
  ) => Promise<void>;
  recordStockMovement: (input: StockMovementInput) => Promise<void>;
  refreshInventoryMovements: () => Promise<void>;
  updateProduct: (id: string, patch: ProductPatch, idempotencyKey?: string) => Promise<void>;
  deleteProduct: (id: string) => Promise<{ deletedRows: number }>;
  addProduct: (
    product: Omit<Product, "id" | "sku"> & { sku?: string },
    idempotencyKey?: string,
  ) => Promise<void>;
  importInventory: (rows: InventoryImportRow[], idempotencyKey?: string) => Promise<void>;
  updateSettings: (patch: Partial<Settings>) => Promise<void>;
  importSales: (rows: Sale[], originalFilename?: string) => Promise<SalesImportResult>;
  deleteSale: (saleId: string) => Promise<{ deletedRows: number }>;
  deleteImportedSales: (saleId?: string) => Promise<{ deletedRows: number }>;
  resetDemo: () => void;
};

const dataMode = import.meta.env.VITE_DATA_MODE === "browser-demo" ? "browser-demo" : "api";
let movementRefreshSequence = 0;
let authRequestSequence = 0;
const pendingSales = new WeakMap<
  SessionUser,
  Map<string, { signature: string; originalProduct: Product }>
>();
const pendingStockMovements = new WeakMap<SessionUser, Map<string, string>>();

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
      recordSale: async (productId, date, qty, idempotencyKey) => {
        validateQuantity(qty);
        if (get().dataMode === "api") {
          const session = requireSession(get());
          let submissions = pendingSales.get(session);
          if (!submissions) {
            submissions = new Map();
            pendingSales.set(session, submissions);
          }
          const signature = JSON.stringify({ productId, date, qty });
          const pending = idempotencyKey ? submissions.get(idempotencyKey) : undefined;
          const retrying = pending?.signature === signature;
          const product = retrying
            ? pending.originalProduct
            : requireActiveProduct(get(), productId);
          if (!retrying && date > businessDateISO(get().settings.timezone)) {
            throw new Error(
              "Sales cannot be future-dated. Use the business's current date or an earlier date.",
            );
          }
          if (idempotencyKey && !submissions.has(idempotencyKey)) {
            submissions.set(idempotencyKey, { signature, originalProduct: product });
          }
          // A balance refreshed after a lost response already includes the saved sale.
          const originalProduct = product;
          const sale = await api.recordSale(
            session.businessId,
            productId,
            date,
            qty,
            idempotencyKey,
          );
          if (idempotencyKey) submissions.delete(idempotencyKey);
          if (get().session !== session) return;
          const alreadyLoaded = get().sales.some((row) => row.id === sale.id);
          set({
            sales: alreadyLoaded ? get().sales : [...get().sales, sale],
            products: get().products.map((p) =>
              p.id === productId && !alreadyLoaded && p === originalProduct
                ? { ...p, currentStock: stockBalance(p.currentStock - sale.qty) }
                : p,
            ),
            movementsStatus: "idle",
          });
          try {
            await refreshApiProducts(session, set, get);
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
        if (date > businessDateISO(get().settings.timezone)) {
          throw new Error(
            "Sales cannot be future-dated. Use the business's current date or an earlier date.",
          );
        }
        const product = requireActiveProduct(get(), productId);
        if (qty > product.currentStock) throw new Error("Sale quantity exceeds current stock.");
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
      receiveStock: async (productId, qty, submission) => {
        await get().recordStockMovement({
          productId,
          movementDate: submission?.movementDate ?? businessDateISO(get().settings.timezone),
          movementType: "receipt",
          quantityDelta: qty,
          idempotencyKey: submission?.idempotencyKey,
        });
      },
      recordStockMovement: async (input) => {
        validateQuantity(Math.abs(input.quantityDelta));
        const futureDated = input.movementDate > businessDateISO(get().settings.timezone);
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
        if (get().dataMode === "api") {
          const session = requireSession(get());
          let submissions = pendingStockMovements.get(session);
          if (!submissions) {
            submissions = new Map();
            pendingStockMovements.set(session, submissions);
          }
          const signature = JSON.stringify({
            productId: input.productId,
            movementDate: input.movementDate,
            movementType: input.movementType,
            quantityDelta: input.quantityDelta,
            note: input.note?.trim() || null,
          });
          const retrying =
            !!input.idempotencyKey && submissions.get(input.idempotencyKey) === signature;
          // An unchanged submitted request may already be saved. Let backend replay
          // confirm it before applying mutable product, date, or balance rules.
          const product = retrying ? null : requireActiveProduct(get(), input.productId);
          if (futureDated && !retrying) {
            throw new Error(
              "Stock movements cannot be future-dated. Use the business's current date or an earlier date.",
            );
          }
          // A refreshed balance may already include a submission whose response was lost.
          // Only its unchanged retry can bypass the local stock check; the server confirms it.
          if (product && stockBalance(product.currentStock + input.quantityDelta) < 0)
            throw new Error("Movement would make stock negative.");
          if (input.idempotencyKey && !submissions.has(input.idempotencyKey)) {
            submissions.set(input.idempotencyKey, signature);
          }
          const movement = await api.recordStockMovement(session.businessId, input);
          if (input.idempotencyKey) submissions.delete(input.idempotencyKey);
          if (get().session !== session) return;
          // Saved movement balances are historical, including on an idempotent replay.
          // Invalidate older catalog reads, then fetch current stock separately.
          set({
            products: [...get().products],
            inventoryMovements: [
              movement,
              ...get().inventoryMovements.filter((m) => m.id !== movement.id),
            ],
            movementsStatus: "idle",
            movementsError: null,
          });
          try {
            await refreshApiProducts(session, set, get);
          } catch {
            if (get().session === session)
              set({
                movementsStatus: "error",
                movementsError:
                  "Stock movement saved. Refresh stock movements to verify the latest balances.",
              });
          }
          return;
        }
        const product = requireActiveProduct(get(), input.productId);
        const balance = stockBalance(product.currentStock + input.quantityDelta);
        if (futureDated) {
          throw new Error(
            "Stock movements cannot be future-dated. Use the business's current date or an earlier date.",
          );
        }
        if (balance < 0) throw new Error("Movement would make stock negative.");
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
      updateProduct: async (id, patch, idempotencyKey) => {
        requireOwner(get());
        if (get().dataMode === "api") {
          const session = requireSession(get());
          const previousProduct = get().products.find((item) => item.id === id);
          const updated = await api.updateProduct(session.businessId, id, patch, idempotencyKey);
          if (get().session !== session) return;
          if (patch.currentStock !== undefined) {
            // A replay returns the original count, which may predate later sales.
            set({ movementsStatus: "idle", movementsError: null });
            try {
              await refreshApiProducts(session, set, get);
            } catch {
              if (get().session === session)
                set({
                  movementsStatus: "error",
                  movementsError:
                    "Stock count saved. Refresh stock movements to verify the latest balances.",
                });
            }
            return;
          }
          set({
            products: get().products.map((item) =>
              item.id === id && item === previousProduct
                ? { ...updated, currentStock: item.currentStock }
                : item,
            ),
            movementsStatus: "idle",
            movementsError: null,
          });
          try {
            await refreshApiProducts(session, set, get);
          } catch {
            if (get().session === session)
              set({
                movementsStatus: "error",
                movementsError:
                  "Product saved. Refresh stock movements to load the latest catalog.",
              });
          }
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
      deleteProduct: async (id) => {
        requireOwner(get());
        if (get().dataMode === "api") {
          const session = requireSession(get());
          const result = await api.deleteProduct(session.businessId, id);
          if (!sameSession(get().session, session)) return result;
          invalidatePipelineCache();
          set({ products: get().products.filter((product) => product.id !== id) });
          return result;
        }
        const product = get().products.find((row) => row.id === id);
        if (!product) return { deletedRows: 0 };
        if (
          product.currentStock !== 0 ||
          get().sales.some((sale) => sale.productId === id) ||
          get().inventoryMovements.some((movement) => movement.productId === id)
        )
          throw new Error(
            "This product has stock or saved history and cannot be deleted. You can deactivate it instead.",
          );
        invalidatePipelineCache();
        set({ products: get().products.filter((row) => row.id !== id) });
        return { deletedRows: 1 };
      },
      addProduct: async (product, idempotencyKey) => {
        requireOwner(get());
        if (get().dataMode === "api") {
          const session = requireSession(get());
          await api.createProduct(
            session.businessId,
            { ...product, sku: product.sku?.trim() || `SKU-${crypto.randomUUID()}` },
            idempotencyKey,
          );
          if (get().session !== session) return;
          set({ movementsStatus: "idle", movementsError: null });
          try {
            await refreshApiProducts(session, set, get);
          } catch {
            if (get().session === session)
              set({
                movementsStatus: "error",
                movementsError:
                  "Product saved. Refresh stock movements to load the latest catalog.",
              });
          }
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
            await refreshApiProducts(session, set, get);
            if (sameSession(get().session, session))
              set({ movementsStatus: "idle", importRefreshWarning: null });
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
        const previousSettings = get().settings;
        const settings = { ...previousSettings, ...patch, apiVersion: previousSettings.apiVersion };
        if (get().dataMode === "api") {
          const session = requireSession(get());
          try {
            const saved = await api.updateSettings(session.businessId, settings);
            if (get().session !== session) return;
            if (get().settings !== previousSettings) {
              await refreshApiSettings(session, set, get);
              return;
            }
            set(canonicalSettingsPatch(saved, settings, get().dataOrigin));
          } catch (failure) {
            if (failure instanceof ApiError && failure.status === 409) {
              if (get().session !== session) return;
              try {
                await refreshApiSettings(session, set, get);
              } catch {
                throw new Error(
                  "Settings changed in another browser. Your edits are kept, but the saved settings could not be reloaded. Refresh before saving again.",
                );
              }
              throw new Error(
                "Settings changed in another browser. Your edits are kept. Review the latest saved values and save again.",
              );
            }
            throw failure;
          }
          return;
        }
        set({ settings });
      },
      importSales: async (rows, originalFilename) => {
        requireOwner(get());
        if (!rows.length) return { acceptedRows: 0, rejectedRows: 0, errors: [] };
        const today = businessDateISO(get().settings.timezone);
        if (rows.some((row) => row.date > today)) {
          throw new Error(
            "Sales cannot be future-dated. Use the business's current date or an earlier date.",
          );
        }
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
            originalFilename,
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
      deleteSale: async (saleId) => {
        requireOwner(get());
        const sale = get().sales.find((row) => row.id === saleId);
        if (!sale) throw new Error("Sale not found. Reload saved records.");
        if (isImportedSale(sale)) return get().deleteImportedSales(saleId);
        if (sale.source !== "manual")
          throw new Error("Only imported or recorded sales can be deleted.");
        if (get().dataMode === "api") {
          const session = requireSession(get());
          const result = await api.deleteSale(session.businessId, saleId);
          if (!sameSession(get().session, session)) return result;
          invalidatePipelineCache();
          // Replacing these arrays invalidates any sales/catalog/movement read that
          // began before the committed reversal. Stock comes from the server below.
          set({
            sales: get().sales.filter((row) => row.id !== saleId),
            products: [...get().products],
            inventoryMovements: [...get().inventoryMovements],
            movementsStatus: "idle",
          });
          const [, inventoryRefresh] = await Promise.allSettled([
            refreshApiSales(
              session,
              set,
              get,
              "Sale deleted and stock restored, but the ledger could not be refreshed. Reload saved records; do not repeat the deletion.",
            ),
            get().refreshInventoryMovements(),
          ]);
          if (sameSession(get().session, session) && inventoryRefresh.status === "rejected")
            set({
              importRefreshWarning:
                "Sale deleted and stock restored, but inventory could not be refreshed. Reload saved records; do not repeat the deletion.",
            });
          return result;
        }
        const product = get().products.find((row) => row.id === sale.productId);
        if (!product)
          throw new Error("The sale's product could not be found. Reload saved records.");
        const balance = stockBalance(product.currentStock + sale.qty);
        invalidatePipelineCache();
        set({
          sales: get().sales.filter((row) => row.id !== saleId),
          products: get().products.map((row) =>
            row.id === product.id ? { ...row, currentStock: balance } : row,
          ),
          inventoryMovements: [
            demoMovement(
              product.id,
              todayISO(),
              "adjustment",
              sale.qty,
              balance,
              `Recorded sale deleted: ${saleId}`,
            ),
            ...get().inventoryMovements,
          ],
        });
        return { deletedRows: 1 };
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
          invalidatePipelineCache();
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

function sameValues(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function canonicalSettingsPatch(
  saved: ApiSettings,
  previous: Settings,
  dataOrigin: Store["dataOrigin"],
): Pick<Store, "settings" | "dataOrigin"> {
  const next = fromApiSettings(
    saved,
    { name: previous.storeName, location: previous.storeLocation },
    previous,
  );
  return {
    settings: sameValues(next, previous) ? previous : next,
    dataOrigin: saved.dataOrigin ?? dataOrigin,
  };
}

/** Publish dashboard inputs and a refreshed ledger in the same guarded store update. */
export function applyApiSharedState(
  inputs: { products: Product[]; settings: ApiSettings; sales?: Sale[] },
  expected: Pick<Store, "session" | "products" | "settings" | "sales">,
): boolean {
  const current = useAppStore.getState();
  if (
    current.dataMode !== "api" ||
    !expected.session ||
    current.session !== expected.session ||
    current.products !== expected.products ||
    current.settings !== expected.settings ||
    (inputs.sales !== undefined && current.sales !== expected.sales)
  )
    return false;
  const patch = canonicalSettingsPatch(inputs.settings, current.settings, current.dataOrigin);
  const products = sameValues(inputs.products, current.products)
    ? current.products
    : inputs.products;
  const sales =
    inputs.sales === undefined || sameValues(inputs.sales, current.sales)
      ? current.sales
      : inputs.sales;
  if (
    products !== current.products ||
    sales !== current.sales ||
    patch.settings !== current.settings ||
    patch.dataOrigin !== current.dataOrigin
  )
    useAppStore.setState({ products, sales, ...patch });
  return true;
}

async function refreshApiSettings(
  session: SessionUser,
  set: (patch: Partial<Store>) => void,
  get: () => Store,
) {
  for (;;) {
    const previous = get().settings;
    const saved = await api.settings(session.businessId);
    if (get().session !== session) return;
    if (get().settings !== previous) continue;
    set(canonicalSettingsPatch(saved, previous, get().dataOrigin));
    return;
  }
}

function requireSession(store: Store): SessionUser {
  if (!store.session) throw new Error("Your session has expired. Sign in again.");
  return store.session;
}

function sameSession(current: SessionUser | null, submitted: SessionUser): boolean {
  return current === submitted;
}

async function refreshApiProducts(
  session: SessionUser,
  set: (patch: Partial<Store>) => void,
  get: () => Store,
) {
  for (;;) {
    const previousProducts = get().products;
    const products = await api.products(session.businessId);
    if (!sameSession(get().session, session)) return;
    if (get().products !== previousProducts) continue;
    set({ products });
    return;
  }
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
