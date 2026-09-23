import { create } from "zustand";
import { persist } from "zustand/middleware";
import { createSeedProducts, createSeedSales, defaultSettings } from "@/lib/data/seed";
import { todayISO } from "@/lib/dates";
import { invalidatePipelineCache } from "@/lib/forecast/cache";
import type { Product, Sale, Settings } from "@/lib/types";

type Store = {
  products: Product[];
  sales: Sale[];
  settings: Settings;
  recordSale: (productId: string, date: string, qty: number) => void;
  receiveStock: (productId: string, qty: number) => void;
  updateProduct: (id: string, patch: Partial<Product>) => void;
  addProduct: (product: Omit<Product, "id" | "sku"> & { sku?: string }) => void;
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
      recordSale: (productId, date, qty) => {
        if (qty <= 0) return;
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
      receiveStock: (productId, qty) => {
        if (qty <= 0) return;
        set({
          products: get().products.map((p) =>
            p.id === productId ? { ...p, currentStock: p.currentStock + Math.round(qty) } : p,
          ),
        });
      },
      updateProduct: (id, patch) => {
        set({
          products: get().products.map((p) => (p.id === id ? { ...p, ...patch, id: p.id } : p)),
        });
      },
      addProduct: (product) => {
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
