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

// These checks exercise the real frontend store/API adapter against a mock HTTP
// contract. They do not claim that PostgreSQL transactions or browser UI ran.
async function isolatedStore(t) {
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
  return (await server.ssrLoadModule("/src/lib/store.ts")).useAppStore;
}

test("mock API contract forwards all 100,000 sales in one request and reloads every page without changing stock", async (t) => {
  const store = await isolatedStore(t);
  const businessId = "isolated-synthetic-business";
  const rows = Array.from({ length: 100_000 }, (_, index) =>
    sale(`synthetic:row:${index}`, {
      qty: index % 2 ? 1.125 : 2,
      businessId: "untrusted-row-business",
    }),
  );
  const savedRows = rows.map((row) => ({
    id: row.id,
    productId: row.productId,
    saleDate: row.date,
    quantity: String(row.qty),
    sourceRecordKey: row.sourceRecordKey,
  }));
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    const requestUrl = new URL(url, "http://localhost");
    assert.ok(requestUrl.pathname.startsWith(`/api/v1/businesses/${businessId}/`));
    const offset = Number(requestUrl.searchParams.get("offset") ?? 0);
    const limit = Number(requestUrl.searchParams.get("limit") ?? 200);
    const data =
      options.method === "POST"
        ? { acceptedRows: rows.length, rejectedRows: 0, errors: [] }
        : savedRows.slice(offset, offset + limit);
    return new Response(JSON.stringify({ data }), {
      headers: { "content-type": "application/json" },
    });
  };
  const product = { id: "synthetic-product", sku: "SKU-1", currentStock: 20 };
  store.setState({
    dataMode: "api",
    session: { businessId, userId: "synthetic-owner", role: "owner" },
    products: [product],
    sales: [],
  });
  const result = await store.getState().importSales(rows);
  assert.equal(result.acceptedRows, rows.length);
  const writes = requests.filter(({ options }) => options.method === "POST");
  assert.equal(writes.length, 1, "The existing import remains one API transaction request");
  assert.equal(writes[0].options.headers["x-csrf-token"], "synthetic-token");
  const forwarded = JSON.parse(writes[0].options.body).rows;
  assert.deepEqual(
    forwarded,
    rows.map((row) => ({
      sku: "SKU-1",
      saleDate: row.date,
      quantity: String(row.qty),
      sourceRecordKey: row.sourceRecordKey,
    })),
  );
  assert.equal(store.getState().sales.length, rows.length);
  assert.equal(store.getState().sales.at(-1).id, rows.at(-1).id);
  assert.equal(store.getState().sales.at(-1).qty, rows.at(-1).qty);
  assert.deepEqual(store.getState().products, [product]);
});

test("isolated browser-demo store imports every keyed sales row and retry skips all duplicates while preserving stock", async (t) => {
  const store = await isolatedStore(t);
  globalThis.fetch = () => {
    throw new Error("Browser demonstration must not call the API");
  };
  const product = { id: "synthetic-product", sku: "SKU-1", currentStock: 20 };
  const rows = Array.from({ length: 100_000 }, (_, index) => sale(`synthetic:retry:${index}`));
  store.setState({ dataMode: "browser-demo", session: null, products: [product], sales: [] });
  const first = await store.getState().importSales(rows);
  assert.equal(first.acceptedRows, rows.length);
  assert.equal(store.getState().sales.length, rows.length);
  const retry = await store.getState().importSales([...rows].reverse());
  assert.equal(retry.acceptedRows, 0);
  assert.equal(retry.rejectedRows, rows.length);
  assert.ok(retry.errors.every((error) => error.code === "duplicate_source_record_key"));
  assert.equal(store.getState().sales.length, rows.length);
  assert.deepEqual(store.getState().products, [product]);
});

test("mock API contract forwards all 5,000 inventory snapshots in one request without recording sales", async (t) => {
  const store = await isolatedStore(t);
  const businessId = "isolated-inventory-business";
  const rows = Array.from({ length: 5_000 }, (_, index) => ({
    sku: `SYNTHETIC-${index}`,
    name: `Synthetic product ${index}`,
    category: "Synthetic",
    unit: "pc",
    currentStock: 10.125,
    leadTimeDays: 2,
    safetyStock: 1.125,
    unitCost: 12.1234,
  }));
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    assert.ok(String(url).startsWith(`/api/v1/businesses/${businessId}/`));
    const data =
      options.method === "POST"
        ? { created: rows.length, updated: 0 }
        : rows.map((row, index) => ({ ...row, id: `synthetic-product-${index}`, isActive: true }));
    return new Response(JSON.stringify({ data }), {
      headers: { "content-type": "application/json" },
    });
  };
  const existingSale = sale("keep-existing-history");
  store.setState({
    dataMode: "api",
    session: { businessId, userId: "synthetic-owner", role: "owner" },
    products: [],
    sales: [existingSale],
  });
  await store.getState().importInventory(rows);
  assert.equal(requests.length, 2);
  assert.ok(requests[0].url.endsWith("/inventory-imports"));
  assert.equal(requests[0].options.method, "POST");
  assert.deepEqual(JSON.parse(requests[0].options.body).rows, rows);
  assert.equal(store.getState().products.length, rows.length);
  assert.equal(store.getState().products.at(-1).sku, rows.at(-1).sku);
  assert.deepEqual(store.getState().sales, [existingSale]);
});

test("API owner permission remains required for inventory and historical sales imports", async (t) => {
  const store = await isolatedStore(t);
  let requests = 0;
  globalThis.fetch = () => {
    requests++;
    throw new Error("Unauthorized imports must not call the API");
  };
  store.setState({
    dataMode: "api",
    session: { businessId: "synthetic-staff-business", userId: "synthetic-staff", role: "staff" },
    products: [],
    sales: [],
  });
  await assert.rejects(store.getState().importSales([sale("unauthorized")]), /owner/i);
  await assert.rejects(store.getState().importInventory([{ sku: "unauthorized" }]), /owner/i);
  assert.equal(requests, 0);
});
