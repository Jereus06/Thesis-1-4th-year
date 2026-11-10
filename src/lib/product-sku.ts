import type { Product } from "@/lib/types";

type CatalogSku = Pick<Product, "sku" | "category">;
type Sequence = {
  prefix: string;
  maximum: bigint;
  width: number;
  count: number;
  categoryCode: boolean;
  padded: boolean;
  numbers: Set<bigint>;
};

function normalizeCategory(category: string) {
  return category.normalize("NFKD").replace(/\p{M}/gu, "").trim().toUpperCase();
}

/** Suggest a unique catalog code without changing any saved product identifiers. */
export function generateProductSku(
  category: string,
  products: readonly CatalogSku[],
  reservedSkus: readonly string[] = [],
): string {
  const normalized = normalizeCategory(category);
  const letters = normalized.replace(/[^A-Z]/g, "");
  const initials =
    normalized
      .match(/[A-Z0-9]+/g)
      ?.map((word) => word[0])
      .join("") ?? "";
  const fallbackPrefix = `${normalized.replace(/[^A-Z0-9]/g, "").slice(0, 3) || "ITEM"}-`;
  const used = new Set(
    [...products.map((product) => product.sku), ...reservedSkus].map((sku) =>
      sku.trim().toUpperCase(),
    ),
  );
  const sequences = new Map<string, Sequence>();

  for (const product of products) {
    if (normalizeCategory(product.category) !== normalized) continue;
    // Only simple letter prefixes with a numeric counter are candidates. UUIDs
    // and codes with trailing unit names do not establish a category sequence.
    const match = /^([A-Z][A-Z_-]*)(\d+)$/i.exec(product.sku.trim());
    if (!match) continue;
    const prefix = match[1].toUpperCase();
    const code = prefix.replace(/[^A-Z]/g, "");
    const number = BigInt(match[2]);
    const sequence = sequences.get(prefix);
    if (sequence) {
      sequence.maximum = number > sequence.maximum ? number : sequence.maximum;
      sequence.width = Math.max(sequence.width, match[2].length);
      sequence.count += 1;
      sequence.padded ||= /^0\d/.test(match[2]);
      sequence.numbers.add(number);
    } else {
      sequences.set(prefix, {
        prefix,
        maximum: number,
        width: match[2].length,
        count: 1,
        categoryCode: (code.length >= 2 && letters.startsWith(code)) || code === initials,
        padded: /^0\d/.test(match[2]),
        numbers: new Set([number]),
      });
    }
  }

  const candidates = [...sequences.values()]
    .filter(
      (sequence) =>
        sequence.categoryCode ||
        (sequence.numbers.size >= 2 &&
          (sequence.padded ||
            [...sequence.numbers].some((number) => sequence.numbers.has(number - 1n)))),
    )
    .sort((a, b) => b.count - a.count || Number(b.categoryCode) - Number(a.categoryCode));
  const [first, second] = candidates;
  const preferred =
    first && (!second || first.count > second.count || (first.categoryCode && !second.categoryCode))
      ? first
      : undefined;

  function nextAvailable(prefix: string, width: number, start: bigint) {
    let number = start;
    let sku: string;
    do {
      sku = `${prefix}${String(number).padStart(width, "0")}`;
      if (sku.length > 100) return null;
      number += 1n;
    } while (used.has(sku));
    return sku;
  }

  if (preferred) {
    const sku = nextAvailable(preferred.prefix, preferred.width, preferred.maximum + 1n);
    if (sku) return sku;
  }
  // A fallback prefix may already be used by another category or an earlier
  // uncertain submission, so uniqueness always covers the entire catalog.
  let maximum = 0n;
  for (const sku of used) {
    if (!sku.startsWith(fallbackPrefix)) continue;
    const suffix = sku.slice(fallbackPrefix.length);
    if (!/^\d+$/.test(suffix)) continue;
    const number = BigInt(suffix);
    if (number > maximum && suffix.length <= 90) maximum = number;
  }
  return nextAvailable(fallbackPrefix, 3, maximum + 1n)!;
}
