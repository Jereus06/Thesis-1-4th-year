import { addDays, enumerateDays, formatISO } from "@/lib/dates";
import type { Product, Sale, Settings } from "@/lib/types";

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type ProductSeed = Product & {
  base: number;
  weekendLift: number;
  paydayLift: number;
  noise: number;
};

const PRODUCT_SEEDS: ProductSeed[] = [
  {
    id: "p-rice",
    sku: "RICE-5KG",
    name: "Sinandomeng Rice 5kg",
    category: "Staples",
    unit: "bag",
    currentStock: 38,
    leadTimeDays: 5,
    safetyStock: 8,
    unitCost: 285,
    base: 3.1,
    weekendLift: 1.18,
    paydayLift: 1.85,
    noise: 0.35,
  },
  {
    id: "p-canton",
    sku: "LM-CANTON",
    name: "Lucky Me Pancit Canton",
    category: "Instant meals",
    unit: "pack",
    currentStock: 32,
    leadTimeDays: 3,
    safetyStock: 24,
    unitCost: 16,
    base: 13.4,
    weekendLift: 1.38,
    paydayLift: 1.45,
    noise: 0.28,
  },
  {
    id: "p-coffee",
    sku: "NES-ORIG",
    name: "Nescafe Original 25g",
    category: "Beverages",
    unit: "sachet",
    currentStock: 48,
    leadTimeDays: 4,
    safetyStock: 30,
    unitCost: 9,
    base: 11.2,
    weekendLift: 0.92,
    paydayLift: 1.25,
    noise: 0.3,
  },
  {
    id: "p-soy",
    sku: "SS-SOY",
    name: "Silver Swan Soy Sauce 1L",
    category: "Condiments",
    unit: "bottle",
    currentStock: 21,
    leadTimeDays: 4,
    safetyStock: 6,
    unitCost: 42,
    base: 2.4,
    weekendLift: 1.12,
    paydayLift: 1.4,
    noise: 0.4,
  },
  {
    id: "p-magic",
    sku: "MG-SARAP",
    name: "Maggi Magic Sarap 8g",
    category: "Condiments",
    unit: "sachet",
    currentStock: 90,
    leadTimeDays: 3,
    safetyStock: 40,
    unitCost: 6,
    base: 16.8,
    weekendLift: 1.2,
    paydayLift: 1.3,
    noise: 0.25,
  },
  {
    id: "p-soap",
    sku: "SG-WHITE",
    name: "Safeguard White 135g",
    category: "Personal care",
    unit: "bar",
    currentStock: 26,
    leadTimeDays: 5,
    safetyStock: 10,
    unitCost: 38,
    base: 3.6,
    weekendLift: 1.05,
    paydayLift: 1.55,
    noise: 0.32,
  },
  {
    id: "p-shampoo",
    sku: "PM-SACHET",
    name: "Palmolive Shampoo 12ml",
    category: "Personal care",
    unit: "sachet",
    currentStock: 18,
    leadTimeDays: 4,
    safetyStock: 20,
    unitCost: 8,
    base: 7.4,
    weekendLift: 1.08,
    paydayLift: 1.5,
    noise: 0.3,
  },
  {
    id: "p-c2",
    sku: "C2-APPLE",
    name: "C2 Apple Tea 355ml",
    category: "Beverages",
    unit: "bottle",
    currentStock: 14,
    leadTimeDays: 2,
    safetyStock: 18,
    unitCost: 22,
    base: 9.6,
    weekendLift: 1.55,
    paydayLift: 1.2,
    noise: 0.34,
  },
  {
    id: "p-water",
    sku: "NS-500",
    name: "Nature Spring Water 500ml",
    category: "Beverages",
    unit: "bottle",
    currentStock: 64,
    leadTimeDays: 2,
    safetyStock: 24,
    unitCost: 12,
    base: 18.5,
    weekendLift: 1.48,
    paydayLift: 1.15,
    noise: 0.22,
  },
  {
    id: "p-tuna",
    sku: "CT-FLAKES",
    name: "Century Tuna Flakes 155g",
    category: "Canned goods",
    unit: "can",
    currentStock: 7,
    leadTimeDays: 4,
    safetyStock: 12,
    unitCost: 36,
    base: 4.2,
    weekendLift: 1.1,
    paydayLift: 1.6,
    noise: 0.38,
  },
  {
    id: "p-bread",
    sku: "GD-LOAF",
    name: "Gardenia Classic Loaf",
    category: "Bakery",
    unit: "loaf",
    currentStock: 6,
    leadTimeDays: 1,
    safetyStock: 6,
    unitCost: 62,
    base: 7.8,
    weekendLift: 1.42,
    paydayLift: 1.18,
    noise: 0.26,
  },
  {
    id: "p-milk",
    sku: "NL-1L",
    name: "Nestle Fresh Milk 1L",
    category: "Dairy",
    unit: "carton",
    currentStock: 9,
    leadTimeDays: 2,
    safetyStock: 8,
    unitCost: 98,
    base: 4.6,
    weekendLift: 1.22,
    paydayLift: 1.35,
    noise: 0.3,
  },
  {
    id: "p-oil",
    sku: "MINOLA-1L",
    name: "Minola Cooking Oil 1L",
    category: "Staples",
    unit: "bottle",
    currentStock: 11,
    leadTimeDays: 5,
    safetyStock: 6,
    unitCost: 89,
    base: 2.2,
    weekendLift: 1.15,
    paydayLift: 1.7,
    noise: 0.42,
  },
  {
    id: "p-eggs",
    sku: "EGG-12",
    name: "Fresh Eggs (tray of 12)",
    category: "Dairy",
    unit: "tray",
    currentStock: 4,
    leadTimeDays: 1,
    safetyStock: 5,
    unitCost: 95,
    base: 5.4,
    weekendLift: 1.28,
    paydayLift: 1.25,
    noise: 0.28,
  },
  {
    id: "p-olive",
    sku: "OLV-500",
    name: "Extra Virgin Olive Oil 500ml",
    category: "Specialty",
    unit: "bottle",
    currentStock: 8,
    leadTimeDays: 10,
    safetyStock: 2,
    unitCost: 220,
    base: 0.12,
    weekendLift: 1.06,
    paydayLift: 1.25,
    noise: 0.55,
  },
  {
    id: "p-candles",
    sku: "BCD-PK",
    name: "Birthday Candles pack",
    category: "Seasonal",
    unit: "pack",
    currentStock: 14,
    leadTimeDays: 7,
    safetyStock: 3,
    unitCost: 35,
    base: 0.08,
    weekendLift: 1.1,
    paydayLift: 1.4,
    noise: 0.6,
  },
  {
    id: "p-wrap",
    sku: "GFT-WRAP",
    name: "Gift Wrap roll",
    category: "Seasonal",
    unit: "roll",
    currentStock: 11,
    leadTimeDays: 7,
    safetyStock: 2,
    unitCost: 45,
    base: 0.1,
    weekendLift: 1.15,
    paydayLift: 1.3,
    noise: 0.5,
  },
  {
    id: "p-sardine-p",
    sku: "SRD-GOLD",
    name: "Premium Spanish Sardines",
    category: "Canned goods",
    unit: "can",
    currentStock: 6,
    leadTimeDays: 8,
    safetyStock: 2,
    unitCost: 89,
    base: 0.18,
    weekendLift: 1.08,
    paydayLift: 1.35,
    noise: 0.48,
  },
];

export const SEED_START = "2026-03-01";
export const SEED_END = "2026-09-19";
export const AS_OF = "2026-09-20";

export const defaultSettings: Settings = {
  storeName: "Cruz Mini Mart",
  storeLocation: "Brgy. Holy Spirit, Quezon City",
  maWindow: 7,
  forecastHorizon: 14,
  holdoutDays: 28,
  coverDays: 7,
  topNProducts: 8,
  minWeeks: 8,
  cvFolds: 3,
  useFallbackIfThin: true,
  dataScenario: "partner",
};

function poissonLike(rand: () => number, lambda: number): number {
  const L = Math.exp(-Math.max(0.05, lambda));
  let k = 0;
  let p = 1;
  do {
    k += 1;
    p *= rand();
  } while (p > L && k < 80);
  return k - 1;
}

export function createSeedProducts(): Product[] {
  return PRODUCT_SEEDS.map(
    ({ base: _b, weekendLift: _w, paydayLift: _p, noise: _n, ...product }) => ({
      ...product,
    }),
  );
}

export function createSeedSales(): Sale[] {
  const rand = mulberry32(20260920);
  const days = enumerateDays(SEED_START, SEED_END);
  const sales: Sale[] = [];

  for (const product of PRODUCT_SEEDS) {
    for (let i = 0; i < days.length; i++) {
      const date = days[i];
      const dt = new Date(date + "T12:00:00");
      const dow = dt.getDay();
      const dom = dt.getDate();
      const isWeekend = dow === 0 || dow === 6;
      const isPayday = (dom >= 14 && dom <= 16) || dom >= 29;
      const seasonal = 1 + 0.08 * Math.sin((2 * Math.PI * (i + 10)) / 365);
      const slowMonday = dow === 1 ? 0.82 : 1;
      const rainDip = rand() < 0.06 ? 0.7 : 1;
      const mean =
        product.base *
        seasonal *
        slowMonday *
        rainDip *
        (isWeekend ? product.weekendLift : 1) *
        (isPayday ? product.paydayLift : 1) *
        (1 + (rand() - 0.5) * product.noise);

      const qty = poissonLike(rand, Math.max(0.2, mean));
      if (qty <= 0) continue;
      sales.push({
        id: `s-${product.id}-${date}`,
        productId: product.id,
        date,
        qty,
      });
    }
  }

  return sales;
}

export const seedGeneratedOn = formatISO(new Date(AS_OF + "T00:00:00"));

export function daysCovered(): number {
  return enumerateDays(SEED_START, SEED_END).length;
}

export { addDays };
