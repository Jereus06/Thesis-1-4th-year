import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { deduplicateSales } from "../src/lib/sales-import.ts";

let sequence = 0;
function sale(sourceRecordKey, patch = {}) {
  return {
    id: String(++sequence),
    productId: "synthetic-product",
    date: "2026-09-01",
    qty: 3,
    ...(sourceRecordKey === undefined ? {} : { sourceRecordKey }),
    ...patch,
  };
}

test("overlapping and reordered batches skip source IDs while preserving distinct identical sales", () => {
  const initial = deduplicateSales([], [sale("till:1"), sale("till:2")]);
  assert.equal(initial.accepted.length, 2);
  const overlap = deduplicateSales(initial.accepted, [
    sale("till:2"),
    sale("till:3"),
    sale("till:1"),
  ]);
  assert.deepEqual(
    overlap.accepted.map((row) => row.sourceRecordKey),
    ["till:3"],
  );
  assert.deepEqual(overlap.result, {
    acceptedRows: 1,
    rejectedRows: 2,
    errors: [
      { row: 1, code: "duplicate_source_record_key" },
      { row: 3, code: "duplicate_source_record_key" },
    ],
  });
  assert.equal(initial.accepted.length, 2);
});

test("reused source IDs with changed data reject the new row without changing the saved sale", () => {
  const saved = sale("till:1");
  const result = deduplicateSales([saved], [sale("till:1", { qty: 4 })]);
  assert.equal(result.accepted.length, 0);
  assert.deepEqual(result.result.errors, [{ row: 1, code: "source_record_key_conflict" }]);
  assert.equal(saved.qty, 3);
});

test("duplicates inside a batch are rejected and source IDs remain case sensitive", () => {
  const result = deduplicateSales([], [sale("Record-A"), sale("Record-A"), sale("record-a")]);
  assert.equal(result.result.acceptedRows, 2);
  assert.deepEqual(result.result.errors, [{ row: 2, code: "duplicate_source_record_key" }]);
});

test("equal-looking sales without source IDs remain separate transactions", () => {
  const result = deduplicateSales([sale()], [sale(), sale("   ")]);
  assert.equal(result.result.acceptedRows, 2);
  assert.equal(result.result.rejectedRows, 0);
});

test("legacy keys normalize surrounding whitespace and conflicting saved copies are not chosen arbitrarily", () => {
  const duplicate = deduplicateSales([sale("  till:1  ")], [sale("till:1")]);
  assert.equal(duplicate.result.errors[0].code, "duplicate_source_record_key");
  const conflict = deduplicateSales(
    [sale("till:1"), sale(" till:1 ", { qty: 4 })],
    [sale("till:1")],
  );
  assert.equal(conflict.result.errors[0].code, "source_record_key_conflict");
});

test("API store forwards source IDs and returns partial outcomes without changing inventory", async (t) => {
  const { createServer } = await import("vite");
  const server = await createServer({
    root: fileURLToPath(new URL("../", import.meta.url)),
    configFile: false,
    logLevel: "silent",
    server: { middlewareMode: true, watch: null },
    resolve: { alias: { "@": fileURLToPath(new URL("../src", import.meta.url)) } },
  });
  t.after(() => server.close());
  const originalFetch = globalThis.fetch;
  const originalDocument = globalThis.document;
  t.after(() => {
    globalThis.fetch = originalFetch;
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  });
  globalThis.document = { cookie: "stockcast_csrf=synthetic-token" };
  const requests = [];
  const outcome = {
    acceptedRows: 1,
    rejectedRows: 1,
    errors: [{ row: 1, code: "duplicate_source_record_key" }],
  };
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    const data = options.method === "POST" ? outcome : [];
    return new Response(JSON.stringify({ data }), {
      headers: { "content-type": "application/json" },
    });
  };
  const { useAppStore } = await server.ssrLoadModule("/src/lib/store.ts");
  useAppStore.setState({
    dataMode: "api",
    session: { businessId: "synthetic-business", userId: "synthetic-user", role: "owner" },
    products: [{ id: "synthetic-product", sku: "SKU-1", currentStock: 20 }],
    sales: [],
  });
  const result = await useAppStore.getState().importSales([sale("till:1"), sale("till:2")]);
  assert.deepEqual(result, outcome);
  assert.equal(requests[0].options.method, "POST");
  assert.deepEqual(JSON.parse(requests[0].options.body).rows, [
    { sku: "SKU-1", saleDate: "2026-09-01", quantity: "3", sourceRecordKey: "till:1" },
    { sku: "SKU-1", saleDate: "2026-09-01", quantity: "3", sourceRecordKey: "till:2" },
  ]);
  assert.equal(useAppStore.getState().products[0].currentStock, 20);
});
