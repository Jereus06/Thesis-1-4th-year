import assert from "node:assert/strict";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const server = await createServer({
  root: fileURLToPath(new URL("../", import.meta.url)),
  configFile: false,
  logLevel: "silent",
  server: { middlewareMode: true, watch: null },
});
after(() => server.close());
const { summarizeDailySales } = await server.ssrLoadModule("/src/lib/daily-sales.ts");

const date = "2026-11-09";
const product = (id, unit = "piece", patch = {}) => ({
  id,
  sku: `SKU-${id}`,
  name: `Product ${id}`,
  category: "Synthetic test data",
  unit,
  currentStock: 10,
  leadTimeDays: 3,
  safetyStock: 2,
  unitCost: 1,
  ...patch,
});
const sale = (id, productId, qty = 1, patch = {}) => ({
  id,
  productId,
  qty,
  date,
  source: "manual",
  ...patch,
});
const empty = {
  products: [],
  rows: [],
  totals: [],
  recordCount: 0,
  recordedCount: 0,
  importedCount: 0,
  totalAmount: 0,
};

test("one selected day uses the sale date for recorded and imported records", () => {
  const records = [
    sale("recorded", "a", 2, { createdAt: "2026-11-10" }),
    sale("imported", "a", 3, { source: "csv_import", importedAt: "2026-11-10" }),
    sale("other-day", "a", 99, { date: "2026-11-10" }),
  ];
  assert.deepEqual(summarizeDailySales(records, [product("a")], date), {
    products: [
      {
        productId: "a",
        name: "Product a",
        sku: "SKU-a",
        unit: "piece",
        unitCost: 1,
        quantity: 5,
        totalAmount: 5,
        recordCount: 2,
        recordedCount: 1,
        importedCount: 1,
      },
    ],
    rows: [
      {
        productId: "a",
        name: "Product a",
        sku: "SKU-a",
        unit: "piece",
        unitCost: 1,
        date,
        quantity: 5,
        totalAmount: 5,
        recordCount: 2,
        recordedCount: 1,
        importedCount: 1,
      },
    ],
    totals: [{ unit: "piece", quantity: 5, totalAmount: 5 }],
    totalAmount: 5,
    recordCount: 2,
    recordedCount: 1,
    importedCount: 1,
  });
});

test("totals include records beyond the 40-row ledger page", () => {
  const records = Array.from({ length: 97 }, (_, index) =>
    sale(`row-${index}`, index === 96 ? "b" : "a", index === 96 ? 7 : 1),
  );
  const summary = summarizeDailySales(records, [product("a"), product("b")], date);
  assert.equal(summary.recordCount, 97);
  assert.deepEqual(
    summary.products.map((row) => [row.productId, row.quantity, row.recordCount]),
    [
      ["a", 96, 96],
      ["b", 7, 1],
    ],
  );
  assert.deepEqual(summary.totals, [{ unit: "piece", quantity: 103, totalAmount: 103 }]);
  assert.deepEqual(
    summary.rows.map((row) => [row.date, row.productId, row.quantity, row.recordCount]),
    [
      [date, "a", 96, 96],
      [date, "b", 7, 1],
    ],
  );
});

test("three-decimal quantities aggregate without floating-point artifacts", () => {
  const records = [0.1, 0.2, 0.333, 0.334].map((qty, index) => sale(`a-${index}`, "a", qty));
  records.push(...Array.from({ length: 1000 }, (_, index) => sale(`b-${index}`, "b", 0.001)));
  const summary = summarizeDailySales(records, [product("a", "kg"), product("b", "kg")], date);
  assert.deepEqual(
    summary.products.map((row) => row.quantity),
    [0.967, 1],
  );
  assert.deepEqual(summary.totals, [{ unit: "kg", quantity: 1.967, totalAmount: 1.967 }]);
  assert.deepEqual(
    summary.products.map((row) => row.totalAmount),
    [0.967, 1],
  );
  assert.equal(summary.totalAmount, 1.967);
  assert.deepEqual(
    summarizeDailySales([...records].reverse(), [product("a", "kg"), product("b", "kg")], date),
    summary,
  );
});

test("pieces, bottles, packs, and other units stay separate without conversion", () => {
  const catalog = [
    product("a", "piece"),
    product("b", "bottle"),
    product("c", "pack"),
    product("d", "kg"),
  ];
  const summary = summarizeDailySales(
    catalog.map((row, index) => sale(row.id, row.id, index + 1)),
    catalog,
    date,
  );
  assert.deepEqual(summary.totals, [
    { unit: "bottle", quantity: 2, totalAmount: 2 },
    { unit: "kg", quantity: 4, totalAmount: 4 },
    { unit: "pack", quantity: 3, totalAmount: 3 },
    { unit: "piece", quantity: 1, totalAmount: 1 },
  ]);
});

test("fractional sales preserve four-decimal costs across products, dates, units, and order", () => {
  const catalog = [
    product("a", "kg", { unitCost: 12.3456 }),
    product("b", "bottle", { unitCost: 0.1 }),
  ];
  const records = [
    sale("a-current", "a", 1.125),
    sale("a-earlier", "a", 0.125, { date: "2026-11-08", source: "csv_import" }),
    sale("b-first", "b", 0.1),
    sale("b-second", "b", 0.2),
  ];
  const summary = summarizeDailySales(records, catalog, "2026-11-08", date);
  assert.equal(summary.totalAmount, 15.462);
  assert.deepEqual(
    summary.products.map((row) => [row.unitCost, row.totalAmount]),
    [
      [12.3456, 15.432],
      [0.1, 0.03],
    ],
  );
  assert.deepEqual(
    summary.rows.map((row) => row.totalAmount),
    [13.8888, 0.03, 1.5432],
  );
  assert.deepEqual(summary.totals, [
    { unit: "bottle", quantity: 0.3, totalAmount: 0.03 },
    { unit: "kg", quantity: 1.25, totalAmount: 15.432 },
  ]);
  assert.deepEqual(
    summarizeDailySales([...records].reverse(), [...catalog].reverse(), "2026-11-08", date),
    summary,
  );
});

test("source counts follow existing explicit and legacy import provenance", () => {
  const records = [
    sale("manual", "a"),
    sale("demo", "a", 1, { source: "demo" }),
    sale("legacy-recorded", "a", 1, { source: undefined }),
    sale("csv", "a", 1, { source: "csv_import" }),
    sale("pos", "a", 1, { source: "pos_import" }),
    sale("migration", "a", 1, { source: "migration" }),
    sale("imp-legacy", "a", 1, { source: undefined }),
    sale("prepared-legacy", "a", 1, { source: undefined }),
    sale("imp-explicit-manual", "a"),
  ];
  const summary = summarizeDailySales(records, [product("a")], date);
  assert.equal(summary.recordCount, 9);
  assert.equal(summary.recordedCount, 4);
  assert.equal(summary.importedCount, 5);
  assert.equal(summary.products[0].recordedCount, 4);
  assert.equal(summary.products[0].importedCount, 5);
});

test("a range includes both boundary dates and excludes surrounding days", () => {
  const records = ["2026-11-06", "2026-11-07", "2026-11-08", "2026-11-09", "2026-11-10"].map(
    (recordDate, index) => sale(`range-${index}`, "a", 1, { date: recordDate }),
  );
  const summary = summarizeDailySales(records, [product("a")], "2026-11-07", "2026-11-09");
  assert.equal(summary.recordCount, 3);
  assert.equal(summary.products[0].quantity, 3);
  assert.deepEqual(
    summary.rows.map((row) => [row.date, row.quantity]),
    [
      ["2026-11-09", 1],
      ["2026-11-08", 1],
      ["2026-11-07", 1],
    ],
  );
});

test("invalid, incomplete, and reversed date selections return an empty summary", () => {
  for (const [start, end] of [
    ["", date],
    [date, ""],
    ["2026-02-30", date],
    ["2026-2-01", date],
    ["2026-11-09T00:00:00Z", date],
    [date, "2026-11-08"],
    ["0000-01-01", date],
    ["not-a-date", date],
    [date, "2026-13-01"],
  ]) {
    assert.deepEqual(summarizeDailySales([sale("a", "a")], [product("a")], start, end), empty);
  }
});

test("calendar validation accepts leap day only in a leap year", () => {
  const records = [sale("leap", "a", 2, { date: "2024-02-29" })];
  assert.equal(summarizeDailySales(records, [product("a")], "2024-02-29").recordCount, 1);
  assert.deepEqual(summarizeDailySales(records, [product("a")], "2026-02-29"), empty);
});

test("historical sales retain inactive products and their catalog units", () => {
  const summary = summarizeDailySales(
    [sale("inactive", "a", 4)],
    [product("a", "bottle", { isActive: false })],
    date,
  );
  assert.equal(summary.products[0].sku, "SKU-a");
  assert.equal(summary.products[0].quantity, 4);
  assert.deepEqual(summary.totals, [{ unit: "bottle", quantity: 4, totalAmount: 4 }]);
});

test("missing catalog entries retain quantities with explicit unavailable details", () => {
  const summary = summarizeDailySales([sale("missing", "orphan", 2.125)], [], date);
  assert.deepEqual(summary.products, [
    {
      productId: "orphan",
      name: "orphan",
      sku: "Unavailable",
      unit: "Unknown unit",
      unitCost: 0,
      quantity: 2.125,
      totalAmount: 0,
      recordCount: 1,
      recordedCount: 1,
      importedCount: 0,
    },
  ]);
  assert.deepEqual(summary.totals, [{ unit: "Unknown unit", quantity: 2.125, totalAmount: 0 }]);
});

test("saved zero-quantity records remain distinguishable from no matching records", () => {
  const summary = summarizeDailySales([sale("explicit-zero", "a", 0)], [product("a")], date);
  assert.equal(summary.recordCount, 1);
  assert.equal(summary.products[0].quantity, 0);
  assert.deepEqual(summary.totals, [{ unit: "piece", quantity: 0, totalAmount: 0 }]);
  assert.deepEqual(summarizeDailySales([], [product("a")], date), empty);
});

test("equal-looking separate transactions are counted independently", () => {
  const summary = summarizeDailySales(
    [sale("first", "a", 2), sale("second", "a", 2)],
    [product("a")],
    date,
  );
  assert.equal(summary.recordCount, 2);
  assert.equal(summary.products[0].quantity, 4);
});

test("input records and catalog remain immutable and output owns its summary rows", () => {
  const catalog = Object.freeze([Object.freeze(product("a"))]);
  const records = Object.freeze([Object.freeze(sale("first", "a", 2))]);
  const before = JSON.stringify({ catalog, records });
  const summary = summarizeDailySales(records, catalog, date);
  summary.products[0].quantity = 99;
  summary.products[0].name = "Changed result";
  summary.rows[0].quantity = 88;
  summary.rows[0].name = "Changed dated result";
  summary.totals[0].quantity = 99;
  assert.equal(JSON.stringify({ catalog, records }), before);
  assert.equal(summarizeDailySales(records, catalog, date).products[0].quantity, 2);
  assert.equal(summarizeDailySales(records, catalog, date).rows[0].quantity, 2);
});

test("product display order is stable regardless of sale or catalog ordering", () => {
  const catalog = [
    product("c", "piece", { name: "Zebra" }),
    product("b", "piece", { name: "Apple" }),
    product("a", "piece", { name: "Apple" }),
  ];
  const records = catalog.map((row) => sale(`sale-${row.id}`, row.id));
  const summary = summarizeDailySales(records, catalog, date);
  assert.deepEqual(
    summary.products.map((row) => row.productId),
    ["a", "b", "c"],
  );
  assert.deepEqual(
    summary.rows.map((row) => row.productId),
    ["a", "b", "c"],
  );
  assert.deepEqual(
    summarizeDailySales([...records].reverse(), [...catalog].reverse(), date),
    summary,
  );
});

test("a product keeps separate actual sale dates while summary products remain unique", () => {
  const catalog = [product("a", "kg", { name: "Rice" }), product("b", "pack")];
  const records = [
    sale("older-manual", "a", 0.1, { date: "2026-11-08", createdAt: date }),
    sale("older-import", "a", 0.2, {
      date: "2026-11-08",
      source: "pos_import",
      importedAt: "2026-11-10",
    }),
    sale("newer-manual", "a", 0.7),
    sale("other-product", "b", 2),
  ];
  const summary = summarizeDailySales(records, catalog, "2026-11-08", date);
  assert.equal(summary.products.length, 2);
  assert.equal(summary.rows.length, 3);
  assert.deepEqual(
    summary.rows.map((row) => [
      row.date,
      row.productId,
      row.quantity,
      row.recordCount,
      row.recordedCount,
      row.importedCount,
    ]),
    [
      [date, "b", 2, 1, 1, 0],
      [date, "a", 0.7, 1, 1, 0],
      ["2026-11-08", "a", 0.3, 2, 1, 1],
    ],
  );
  assert.equal(summary.products.find((row) => row.productId === "a").quantity, 1);
  assert.deepEqual(summary.totals, [
    { unit: "kg", quantity: 1, totalAmount: 1 },
    { unit: "pack", quantity: 2, totalAmount: 2 },
  ]);
  assert.deepEqual(
    summarizeDailySales([...records].reverse(), [...catalog].reverse(), "2026-11-08", date),
    summary,
  );
});

test("search matches product names case-insensitively and trims surrounding whitespace", () => {
  const catalog = [
    product("a", "bottle", { name: "Orange Juice" }),
    product("b", "pack", { name: "Orange biscuits" }),
    product("c", "kg", { name: "Rice" }),
  ];
  const records = [
    sale("a-manual", "a", 2),
    sale("a-import", "a", 3, { source: "csv_import" }),
    sale("a-older", "a", 4, { date: "2026-11-08" }),
    sale("b-import", "b", 5, { source: "pos_import" }),
    sale("c-excluded", "c", 99),
  ];
  const summary = summarizeDailySales(records, catalog, "2026-11-08", date, "  ORANGE  ");
  assert.deepEqual(
    summary.products.map((row) => row.productId),
    ["b", "a"],
  );
  assert.deepEqual(
    summary.rows.map((row) => [row.date, row.productId, row.quantity]),
    [
      [date, "b", 5],
      [date, "a", 5],
      ["2026-11-08", "a", 4],
    ],
  );
  assert.equal(summary.recordCount, 4);
  assert.equal(summary.recordedCount, 2);
  assert.equal(summary.importedCount, 2);
  assert.deepEqual(summary.totals, [
    { unit: "bottle", quantity: 9, totalAmount: 9 },
    { unit: "pack", quantity: 5, totalAmount: 5 },
  ]);
});

test("SKU search filters all saved pages and updates every total", () => {
  const catalog = [product("a"), product("b", "bottle", { sku: "DRINK-007" })];
  const records = Array.from({ length: 1000 }, (_, index) => sale(`non-match-${index}`, "a"));
  records.push(
    sale("matching-import", "b", 2, { source: "csv_import", importedAt: "2026-11-10" }),
    sale("matching-manual", "b", 3),
    sale("outside-date-range", "b", 99, { date: "2026-11-08" }),
  );
  const summary = summarizeDailySales(records, catalog, date, date, "  ink-00  ");
  assert.equal(summary.products.length, 1);
  assert.equal(summary.products[0].sku, "DRINK-007");
  assert.equal(summary.rows.length, 1);
  assert.equal(summary.rows[0].date, date);
  assert.equal(summary.rows[0].quantity, 5);
  assert.equal(summary.recordCount, 2);
  assert.equal(summary.recordedCount, 1);
  assert.equal(summary.importedCount, 1);
  assert.deepEqual(summary.totals, [{ unit: "bottle", quantity: 5, totalAmount: 5 }]);
});

test("blank search preserves all results and no match produces an empty summary", () => {
  const catalog = [product("a", "bottle", { name: "Juice", sku: "DRINK-001" })];
  const records = [sale("a", "a", 2)];
  const summary = summarizeDailySales(records, catalog, date);
  assert.deepEqual(summarizeDailySales(records, catalog, date, date, " \t "), summary);
  assert.deepEqual(summarizeDailySales(records, catalog, date, date, "unmatched"), empty);
  assert.deepEqual(summarizeDailySales(records, catalog, date, date, "bottle"), empty);
});

test("dated rows use deterministic name, SKU, and product ID tie breakers", () => {
  const catalog = [
    product("c", "piece", { name: "Same", sku: "SKU-Z" }),
    product("b", "piece", { name: "Same", sku: "SKU-A" }),
    product("a", "piece", { name: "Same", sku: "SKU-A" }),
  ];
  const records = catalog.flatMap((row) => [
    sale(`${row.id}-old`, row.id, 1, { date: "2026-11-08" }),
    sale(`${row.id}-new`, row.id),
  ]);
  const summary = summarizeDailySales(records, catalog, "2026-11-08", date);
  assert.deepEqual(
    summary.rows.map((row) => [row.date, row.productId]),
    [
      [date, "a"],
      [date, "b"],
      [date, "c"],
      ["2026-11-08", "a"],
      ["2026-11-08", "b"],
      ["2026-11-08", "c"],
    ],
  );
  assert.deepEqual(
    summarizeDailySales([...records].reverse(), [...catalog].reverse(), "2026-11-08", date),
    summary,
  );
});
