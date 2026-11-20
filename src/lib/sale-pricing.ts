import type { Sale } from "./types";

/** Blank prices mean unknown; zero is accepted only when explicitly supplied. */
export function salePricing(
  qty: number,
  sellingPrice?: number | null,
  salesAmount?: number | null,
) {
  if (
    !Number.isFinite(qty) ||
    qty < 0 ||
    Number(qty.toFixed(3)) !== qty ||
    !Number.isSafeInteger(Math.round(qty * 1000))
  )
    throw new Error(
      "Quantity must be nonnegative and exactly representable with at most three decimal places.",
    );
  if (sellingPrice == null) {
    if (salesAmount != null) throw new Error("Sales amount requires the actual selling price.");
    return { sellingPrice: null, salesAmount: null };
  }
  if (
    !Number.isFinite(sellingPrice) ||
    sellingPrice < 0 ||
    Number(sellingPrice.toFixed(4)) !== sellingPrice
  )
    throw new Error("Selling price must be nonnegative with at most four decimal places.");
  if (!Number.isSafeInteger(Math.round(sellingPrice * 10000)))
    throw new Error("Selling price is too large to transfer exactly.");
  const scaled = BigInt(Math.round(qty * 1000)) * BigInt(Math.round(sellingPrice * 10000));
  if (scaled > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error("Sales amount is too large to transfer exactly; it has not been rounded.");
  const amount = Number(scaled) / 1e7;
  if (salesAmount != null && (!Number.isFinite(salesAmount) || salesAmount !== amount))
    throw new Error("Sales amount must equal quantity times actual selling price.");
  return { sellingPrice, salesAmount: amount };
}

/** Historical revenue comes only from a saved price and amount, never catalog prices. */
export function saleRevenue(sale: Sale): number | null {
  if (
    sale.sellingPrice == null ||
    sale.salesAmount == null ||
    !Number.isFinite(sale.sellingPrice) ||
    sale.sellingPrice < 0 ||
    !Number.isFinite(sale.salesAmount) ||
    sale.salesAmount < 0
  )
    return null;
  return sale.salesAmount;
}
