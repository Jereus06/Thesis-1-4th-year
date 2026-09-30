import { create } from "zustand";
import { persist } from "zustand/middleware";
import { createSeedProducts, createSeedSales, defaultSettings } from "@/lib/data/seed";
import { todayISO } from "@/lib/dates";
import { invalidatePipelineCache } from "@/lib/forecast/cache";
import { api, type SessionUser } from "@/lib/api";
import type { Product, Sale, Settings } from "@/lib/types";

type Store = {
  products: Product[];
  sales: Sale[];
  settings: Settings;
  recordSale: (productId: string, date: string, qty: number) => void;
  receiveStock: (productId: string, qty: number) => void;
  updateProduct: (id: string, patch: Partial<Product>) => void;
  addProduct: (product: Omit<Product, "id" | "sku"> & { sku?: string }) => void;
  importInventory: (rows: Omit<Product, "id">[]) => void;
  updateSettings: (patch: Partial<Settings>) => void;
  importSales: (rows: Sale[]) => void;
  resetDemo: () => void;
};

export const useAppStore = create<Store>()(
  persist(
    (set, get) => ({
      products: createSeedProducts(),
      sales: createSeedSales(),
      settings: defaultSettings,
      dataMode: import.meta.env.VITE_DATA_MODE === "api" ? "api" : "browser-demo",
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
          set({ session: null, apiStatus: error instanceof Error && "status" in error && error.status === 401 ? "idle" : "error", apiError: error instanceof Error ? error.message : "Unable to connect" });
        }
      },
      signIn: async (businessId, email, password) => {
        set({ apiStatus: "loading", apiError: null });
        try {
          const session = await api.signIn(businessId, email, password);
          await loadApiState(session, set);
        } catch (error) {
          set({ apiStatus: "error", apiError: error instanceof Error ? error.message : "Sign-in failed" });
          throw error;
        }
      },
      signOut: async () => {
        await api.signOut();
        set({ session: null, apiStatus: "idle", apiError: null });
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
          set({ products: get().products.map((item) => item.id === id ? updated : item) });
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
      importInventory: (rows) => {
        if (!rows.length) return;
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
      updateSettings: (patch) => {
        set({ settings: { ...get().settings, ...patch } });
      },
      importSales: (rows) => {
        if (!rows.length) return;
        set({ sales: [...get().sales, ...rows] });
      },
      resetDemo: () => {
        invalidatePipelineCache();
        set({
          products: createSeedProducts(),
          sales: createSeedSales(),
          settings: defaultSettings,
        });
      },
    }),
    {
      name: "stockcast-v5",
      version: 5,
      partialize: (state) =>
        state.dataMode === "browser-demo"
          ? { products: state.products, sales: state.sales, settings: state.settings }
          : {},
      merge: (persisted, current) => {
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
  const [products, sales, rawSettings] = await Promise.all([
    api.products(session.businessId),
    api.sales(session.businessId),
    api.settings(session.businessId),
  ]);
  const settings = {
    ...defaultSettings,
    maWindow: Number(rawSettings.movingAverageWindow),
    forecastHorizon: Number(rawSettings.forecastHorizonDays),
    coverDays: Number(rawSettings.targetCoverDays),
    minWeeks: Number(rawSettings.minimumHistoryWeeks),
    topNProducts: Number(rawSettings.topNProducts),
    cvFolds: Number(rawSettings.cvFolds),
    storeName: session.displayName,
  };
  set({ session, products, sales, settings, apiStatus: "ready", apiError: null });
}
