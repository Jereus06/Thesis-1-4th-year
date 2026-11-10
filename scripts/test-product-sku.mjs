import assert from "node:assert/strict";
import test from "node:test";
import { generateProductSku } from "../src/lib/product-sku.ts";

const product = (sku, category = "Beverages", extra = {}) => ({ sku, category, ...extra });

test("a new category gets a readable automatic SKU without catalog records", () => {
  assert.equal(generateProductSku("Staples", []), "STA-001");
  assert.equal(generateProductSku("Beverages", []), "BEV-001");
  assert.equal(generateProductSku("Personal care", []), "PER-001");
});

test("category punctuation and spacing do not enter a generated SKU", () => {
  assert.equal(generateProductSku("  Bath & Body  ", []), "BAT-001");
  assert.equal(generateProductSku("12-pack", []), "12P-001");
  assert.equal(generateProductSku("Crème", []), "CRE-001");
});

test("a category without ASCII letters or digits uses the ITEM fallback", () => {
  for (const category of ["", "   ", "!!!", "食品"]) {
    assert.equal(generateProductSku(category, []), "ITEM-001");
  }
});

test("a category-derived prefix continues even when only one product uses it", () => {
  assert.equal(generateProductSku("Beverages", [product("BEV-007")]), "BEV-008");
  assert.equal(generateProductSku("Beverages", [product("BEVERAGES-007")]), "BEVERAGES-008");
  assert.equal(generateProductSku("Personal care", [product("PC-007", "Personal care")]), "PC-008");
});

test("an established category sequence can use its own prefix", () => {
  const products = [product("DRINK-003"), product("DRINK-009")];
  assert.equal(generateProductSku("Beverages", products), "DRINK-010");
});

test("adjacent unpadded counters establish an arbitrary category prefix", () => {
  const products = [product("SHOP-40"), product("SHOP-41")];
  assert.equal(generateProductSku("Beverages", products), "SHOP-42");
});

test("an existing category counter does not require a separator", () => {
  assert.equal(generateProductSku("Beverages", [product("BEV009")]), "BEV010");
});

test("equally established unrelated prefixes do not select a category scheme arbitrarily", () => {
  const products = [
    product("DRINK-001"),
    product("DRINK-002"),
    product("WATER-001"),
    product("WATER-002"),
  ];
  assert.equal(generateProductSku("Beverages", products), "BEV-001");
  assert.equal(generateProductSku("Beverages", [...products].reverse()), "BEV-001");
});

test("equally established category-derived prefixes fall back to the default category code", () => {
  const products = [product("BEV-003"), product("BEVERAGES-005")];
  assert.equal(generateProductSku("Beverages", products), "BEV-004");
  assert.equal(generateProductSku("Beverages", [...products].reverse()), "BEV-004");
});

test("sequence continuation uses the highest number rather than product count or order", () => {
  const products = [product("BEV-010"), product("BEV-002"), product("BEV-006")];
  assert.equal(generateProductSku("Beverages", products), "BEV-011");
  assert.equal(generateProductSku("Beverages", [...products].reverse()), "BEV-011");
});

test("existing numeric padding is preserved across sequence growth", () => {
  assert.equal(generateProductSku("Beverages", [product("BEV-0009")]), "BEV-0010");
  assert.equal(generateProductSku("Beverages", [product("BEV-9")]), "BEV-10");
  assert.equal(generateProductSku("Beverages", [product("BEV-999")]), "BEV-1000");
});

test("category matching ignores leading and trailing space and letter case", () => {
  assert.equal(generateProductSku("  bEvErAgEs  ", [product("BEV-004", " beverages ")]), "BEV-005");
});

test("one unrelated product prefix does not define the category sequence", () => {
  assert.equal(generateProductSku("Beverages", [product("NS-500")]), "BEV-001");
});

test("multiple size-like product codes do not establish a category counter", () => {
  const products = [product("NS-500"), product("NS-1000")];
  assert.equal(generateProductSku("Beverages", products), "BEV-001");
});

test("UUID-style product SKUs do not become a category sequence", () => {
  const products = [
    product("a8d0b6b0-0033-4e8b-a77f-123456789000"),
    product("a8d0b6b0-0033-4e8b-a77f-123456789001"),
  ];
  assert.equal(generateProductSku("Beverages", products), "BEV-001");
});

test("other categories do not supply the selected category's sequence", () => {
  const products = [product("NS-500", "Snacks"), product("NS-501", "Snacks")];
  assert.equal(generateProductSku("Beverages", products), "BEV-001");
});

test("generated SKUs avoid case-insensitive collisions anywhere in the catalog", () => {
  const products = [
    product("bev-001", "Snacks", { isActive: false }),
    product("BeV-002", "Personal care"),
  ];
  assert.equal(generateProductSku("Beverages", products), "BEV-003");
});

test("a continued category sequence also avoids another category's next SKU", () => {
  const products = [product("BEV-009"), product("bev-010", "Snacks", { isActive: false })];
  assert.equal(generateProductSku("Beverages", products), "BEV-011");
});

test("reserved submitted previews remain unavailable before catalog refresh", () => {
  assert.equal(generateProductSku("Beverages", [], ["bev-001", "BEV-002"]), "BEV-003");
  assert.equal(
    generateProductSku("Beverages", [product("BEV-009")], ["BEV-010", "bev-011"]),
    "BEV-012",
  );
});

test("SKU generation does not change the catalog or submitted reservations", () => {
  const products = Object.freeze([
    Object.freeze(product("BEV-002")),
    Object.freeze(product("BEV-001", "Snacks", { isActive: false })),
  ]);
  const reservedSkus = Object.freeze(["BEV-003"]);
  const before = JSON.stringify({ products, reservedSkus });
  assert.equal(generateProductSku("Beverages", products, reservedSkus), "BEV-004");
  assert.equal(JSON.stringify({ products, reservedSkus }), before);
});

test("very large category sequences still produce a unique SKU within the API length limit", () => {
  const products = [product(`BEV-${"9".repeat(110)}`)];
  const sku = generateProductSku("Beverages", products);
  assert.ok(sku.length > 0 && sku.length <= 100);
  assert.equal(
    products.some((row) => row.sku.toUpperCase() === sku.toUpperCase()),
    false,
  );
  assert.equal(generateProductSku("Beverages", products), sku);
});

test("an overlong established prefix cannot exceed the API length limit", () => {
  const prefix = "A".repeat(120);
  const products = [product(`${prefix}-001`), product(`${prefix}-002`)];
  const sku = generateProductSku("Beverages", products);
  assert.ok(sku.length > 0 && sku.length <= 100);
  assert.equal(
    products.some((row) => row.sku.toUpperCase() === sku.toUpperCase()),
    false,
  );
});
