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
import type { Product, Sale, Settings } from "@/lib/types";

type Store = {
  dataOrigin: "demo" | "partner";
  dataMode: "browser-demo" | "api";
  session: SessionUser | null;
  apiStatus: "idle" | "loading" | "ready" | "error";
  apiError: string | null;
  products: Product[];
  sales: Sale[];
  settings: Settings;
  connectApi: () => Promise<void>;
  signIn: (businessId: string | undefined, email: string, password: string) => Promise<void>;
  signUp: (details: SignUpRequest) => Promise<void>;
  completeGoogle: (details: BusinessRegistration) => Promise<void>;
  signOut: () => Promise<void>;
  recordSale: (productId: string, date: string, qty: number) => Promise<void>;
  receiveStock: (productId: string, qty: number) => Promise<void>;
  updateProduct: (id: string, patch: Partial<Product>) => Promise<void>;
  addProduct: (product: Omit<Product, "id" | "sku"> & { sku?: string }) => Promise<void>;
  importInventory: (rows: Omit<Product, "id">[]) => Promise<void>;
  updateSettings: (patch: Partial<Settings>) => Promise<void>;
  importSales: (rows: Sale[]) => Promise<void>;
  resetDemo: () => void;
};

const dataMode = import.meta.env.VITE_DATA_MODE === "browser-demo" ? "browser-demo" : "api";

export const useAppStore = create<Store>()(
  persist(
    (set, get) => ({
      products: dataMode === "api" ? [] : createSeedProducts(),
      sales: dataMode === "api" ? [] : createSeedSales(),
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
        set({ apiStatus: "loading", apiError: null });
        try {
          const session = await api.me();
          await loadApiState(session, set);
        } catch (error) {
          const anonymous = error instanceof ApiError && error.status === 401;
          set({
            session: null,
            products: [],
            sales: [],
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
        set({ apiStatus: "loading", apiError: null });
        try {
          const session = await api.signIn(businessId, email, password);
          await loadApiState(session, set);
        } catch (error) {
          set({
            apiStatus: "error",
            apiError: error instanceof Error ? error.message : "Sign-in failed",
          });
          throw error;
        }
      },
      signUp: async (details) => {
        set({ apiStatus: "loading", apiError: null });
        try {
          const session = await api.signUp(details);
          await loadApiState(session, set);
        } catch (error) {
          set({
            apiStatus: "error",
            apiError: error instanceof Error ? error.message : "Account creation failed",
          });
          throw error;
        }
      },
      completeGoogle: async (details) => {
        set({ apiStatus: "loading", apiError: null });
        try {
          const session = await api.completeGoogle(details);
          await loadApiState(session, set);
        } catch (error) {
          set({
            apiStatus: "error",
            apiError: error instanceof Error ? error.message : "Google account setup failed",
          });
          throw error;
        }
      },
      signOut: async () => {
        await api.signOut();
        set({ session: null, products: [], sales: [], apiStatus: "idle", apiError: null });
      },
      recordSale: async (productId, date, qty) => {
        if (qty <= 0) return;
        if (get().dataMode === "api") {
          const session = requireSession(get());
          const sale = await api.recordSale(session.businessId, productId, date, qty);
          const products = await api.products(session.businessId);
          set({ sales: [...get().sales, sale], products });
          return;
        }
        const sale: Sale = {
          id: `s-${productId}-${date}-${Date.now()}`,
          productId,
          date: date || todayISO(),
          qty: Math.round(qty),
        };
        set({
          sales: [...get().sales, sale],
          products: get().products.map((p) =>
            p.id === productId ? { ...p, currentStock: Math.max(0, p.currentStock - sale.qty) } : p,
          ),
        });
      },
      receiveStock: async (productId, qty) => {
        if (qty <= 0) return;
        if (get().dataMode === "api") {
          const session = requireSession(get());
          await api.receiveStock(session.businessId, productId, qty, todayISO());
          set({ products: await api.products(session.businessId) });
          return;
        }
        set({
          products: get().products.map((p) =>
            p.id === productId ? { ...p, currentStock: p.currentStock + Math.round(qty) } : p,
          ),
        });
      },
      updateProduct: async (id, patch) => {
        if (get().dataMode === "api") {
          const session = requireSession(get());
          const updated = await api.updateProduct(session.businessId, id, patch);
          set({ products: get().products.map((item) => (item.id === id ? updated : item)) });
          return;
        }
        set({
          products: get().products.map((p) => (p.id === id ? { ...p, ...patch, id: p.id } : p)),
        });
      },
      addProduct: async (product) => {
        if (get().dataMode === "api") {
          const session = requireSession(get());
          const created = await api.createProduct(session.businessId, {
            ...product,
            sku: product.sku?.trim() || `SKU-${Date.now()}`,
          });
          set({ products: [...get().products, created] });
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
            },
          ],
        });
      },
      importInventory: async (rows) => {
        if (!rows.length) return;
        if (get().dataMode === "api") {
          const session = requireSession(get());
          await api.importInventory(session.businessId, rows);
          set({ products: await api.products(session.businessId) });
          return;
        }
        const importedBySku = new Map(rows.map((row) => [row.sku.toLowerCase(), row]));
        const existingSkus = new Set(get().products.map((product) => product.sku.toLowerCase()));
        const updated = get().products.map((product) => {
          const imported = importedBySku.get(product.sku.toLowerCase());
          return imported ? { ...product, ...imported, id: product.id } : product;
        });
        const added = rows
          .filter((row) => !existingSkus.has(row.sku.toLowerCase()))
          .map((row, index) => ({ ...row, id: `p-import-${Date.now()}-${index}` }));
        set({ products: [...updated, ...added] });
      },
      updateSettings: async (patch) => {
        const settings = { ...get().settings, ...patch };
        if (get().dataMode === "api") {
          const session = requireSession(get());
          await api.updateSettings(session.businessId, settings);
        }
        set({ settings });
      },
      importSales: async (rows) => {
        if (!rows.length) return;
        if (get().dataMode === "api") {
          const session = requireSession(get());
          const byId = new Map(get().products.map((product) => [product.id, product.sku]));
          const result = await api.importSales(
            session.businessId,
            rows.map((row) => ({
              sku: byId.get(row.productId) ?? row.productId,
              saleDate: row.date,
              quantity: String(row.qty),
            })),
          );
          set({ sales: await api.sales(session.businessId) });
          if (result.rejectedRows)
            throw new Error(
              `Imported ${result.acceptedRows} rows; ${result.rejectedRows} rejected. Check the product SKUs.`,
            );
          return;
        }
        set({ sales: [...get().sales, ...rows] });
      },
      resetDemo: () => {
        if (get().dataMode !== "browser-demo") return;
        invalidatePipelineCache();
        set({
          products: createSeedProducts(),
          sales: createSeedSales(),
          settings: defaultSettings,
        });
      },
    }),
    {
      name: dataMode === "browser-demo" ? "stockcast-v5" : "stockcast-api-ui",
      version: 5,
      partialize: (state) =>
        state.dataMode === "browser-demo"
          ? { products: state.products, sales: state.sales, settings: state.settings }
          : {},
      merge: (persisted, current) => {
        if (current.dataMode === "api") return current;
        const p = (persisted ?? {}) as Partial<Store>;
        return {
          ...current,
          ...p,
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

async function loadApiState(session: SessionUser, set: (patch: Partial<Store>) => void) {
  const [products, sales, rawSettings, business] = await Promise.all([
    api.products(session.businessId),
    api.sales(session.businessId),
    api.settings(session.businessId),
    api.business(session.businessId),
  ]);
  const settings = {
    ...defaultSettings,
    maWindow: Number(rawSettings.movingAverageWindow),
    forecastHorizon: Number(rawSettings.forecastHorizonDays),
    coverDays: Number(rawSettings.targetCoverDays),
    minWeeks: Number(rawSettings.minimumHistoryWeeks),
    topNProducts: Number(rawSettings.topNProducts),
    cvFolds: Number(rawSettings.cvFolds),
    storeName: business.name,
    storeLocation: business.location ?? "",
  };
  set({
    session,
    products,
    sales,
    settings,
    dataOrigin: business.dataOrigin,
    apiStatus: "ready",
    apiError: null,
  });
}
