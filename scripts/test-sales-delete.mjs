import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";

// Real frontend store/API modules, synthetic intercepted transport only.
// Backend transaction and authorization checks run separately in Python.
async function isolatedStore(t, { demo = false, persisted } = {}) {
  const { createServer } = await import("vite");
  const server = await createServer({
    root: fileURLToPath(new URL("../", import.meta.url)),
    configFile: false,
    define: { "import.meta.env.VITE_DATA_MODE": JSON.stringify(demo ? "browser-demo" : "api") },
    logLevel: "silent",
    server: { middlewareMode: true, watch: null },
    resolve: { alias: { "@": fileURLToPath(new URL("../src", import.meta.url)) } },
  });
  t.after(() => server.close());
  const originalFetch = globalThis.fetch;
  const originalDocument = globalThis.document;
  const originalStorage = globalThis.localStorage;
  const originalWindow = globalThis.window;
  t.after(() => {
    globalThis.fetch = originalFetch;
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
    if (originalStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = originalStorage;
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  });
  globalThis.document = { cookie: "stockcast_csrf=synthetic-token" };
  const storage = new Map(
    persisted ? [["stockcast-v5", JSON.stringify({ state: persisted, version: 5 })]] : [],
  );
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key),
  };
  globalThis.window = { localStorage: globalThis.localStorage };
  const { useAppStore } = await server.ssrLoadModule("/src/lib/store.ts");
  const { api } = await server.ssrLoadModule("/src/lib/api.ts");
  const { isImportedSale } = await server.ssrLoadModule("/src/lib/sales-import.ts");
  return { store: useAppStore, api, isImportedSale };
}

const owner = { businessId: "synthetic-business", userId: "synthetic-owner", role: "owner" };
const product = {
  id: "synthetic-product",
  sku: "SYNTHETIC-1",
  name: "Synthetic product",
  unit: "piece",
  currentStock: 17.125,
  isActive: true,
};
const movement = { id: "synthetic-stock-audit", productId: product.id, balanceAfter: 17.125 };
function sale(id, source = "csv_import", patch = {}) {
  return { id, source, productId: product.id, date: "2026-10-01", qty: 2.125, ...patch };
}
function envelope(data, status = 200) {
  return new Response(JSON.stringify({ data }), { status });
}
function apiSale(row) {
  return { ...row, saleDate: row.date, quantity: String(row.qty) };
}
function seed(store, sales, patch = {}) {
  store.setState({
    dataMode: "api",
    session: owner,
    products: [product],
    inventoryMovements: [movement],
    sales,
    importRefreshWarning: null,
    ...patch,
  });
}
function unchangedStock(store) {
  assert.deepEqual(store.getState().products, [product]);
  assert.deepEqual(store.getState().inventoryMovements, [movement]);
}

test("single imported sale deletion uses authenticated DELETE and preserves manual sales and stock", async (t) => {
  const { store } = await isolatedStore(t);
  const removed = sale("synthetic-csv-sale");
  const retained = [sale("synthetic-other-import", "pos_import"), sale("manual-sale", "manual")];
  seed(store, [removed, ...retained]);
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    return options.method === "DELETE"
      ? envelope({ deletedRows: 1 })
      : envelope(retained.map(apiSale));
  };
  assert.deepEqual(await store.getState().deleteImportedSales(removed.id), { deletedRows: 1 });
  const write = requests.find(({ options }) => options.method === "DELETE");
  assert.equal(write.url, `/api/v1/businesses/${owner.businessId}/sales/${removed.id}`);
  assert.equal(write.options.credentials, "include");
  assert.equal(write.options.headers["x-csrf-token"], "synthetic-token");
  assert.deepEqual(
    store.getState().sales.map((row) => row.id),
    retained.map((row) => row.id),
  );
  assert.equal(store.getState().importRefreshWarning, null);
  unchangedStock(store);
});

test("bulk deletion addresses imported history and retains protected demo/manual sales", async (t) => {
  const { store } = await isolatedStore(t);
  const retained = [sale("demo-sale", "demo"), sale("manual-sale", "manual")];
  seed(store, [
    sale("csv-sale"),
    sale("pos-sale", "pos_import"),
    sale("migration-sale", "migration"),
    ...retained,
  ]);
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    return options.method === "DELETE"
      ? envelope({ deletedRows: 3 })
      : envelope(retained.map(apiSale));
  };
  assert.deepEqual(await store.getState().deleteImportedSales(), { deletedRows: 3 });
  assert.equal(requests[0].url, `/api/v1/businesses/${owner.businessId}/sales/imported`);
  assert.equal(requests[0].options.method, "DELETE");
  assert.deepEqual(
    store.getState().sales.map((row) => row.id),
    retained.map((row) => row.id),
  );
  unchangedStock(store);
});

test("failed deletion leaves the ledger and inventory untouched", async (t) => {
  const { store } = await isolatedStore(t);
  const sales = [sale("csv-sale"), sale("manual-sale", "manual")];
  seed(store, sales);
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        error: { code: "temporary_failure", message: "Synthetic deletion failed" },
      }),
      { status: 503 },
    );
  await assert.rejects(
    store.getState().deleteImportedSales("csv-sale"),
    /Synthetic deletion failed/,
  );
  assert.deepEqual(store.getState().sales, sales);
  assert.equal(store.getState().importRefreshWarning, null);
  unchangedStock(store);
});

test("acknowledged deletion remains successful when ledger refresh fails", async (t) => {
  const { store } = await isolatedStore(t);
  const retained = sale("manual-sale", "manual");
  seed(store, [sale("csv-sale"), retained]);
  let writes = 0;
  globalThis.fetch = async (_url, options) => {
    if (options.method === "DELETE") {
      writes++;
      return envelope({ deletedRows: 1 });
    }
    return new Response(JSON.stringify({ detail: "Synthetic ledger read failed" }), {
      status: 503,
    });
  };
  assert.deepEqual(await store.getState().deleteImportedSales("csv-sale"), { deletedRows: 1 });
  assert.equal(writes, 1);
  assert.deepEqual(store.getState().sales, [retained]);
  assert.match(
    store.getState().importRefreshWarning,
    /Sales deleted.*Reload saved records.*do not repeat the deletion/i,
  );
  unchangedStock(store);
});

test("pending deletion does not remove local records before the write succeeds", async (t) => {
  const { store } = await isolatedStore(t);
  const sales = [sale("csv-sale"), sale("manual-sale", "manual")];
  seed(store, sales);
  let complete;
  const write = new Promise((resolve) => {
    complete = resolve;
  });
  globalThis.fetch = async (_url, options) =>
    options.method === "DELETE" ? write : envelope([apiSale(sales[1])]);
  const pending = store.getState().deleteImportedSales("csv-sale");
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(store.getState().sales, sales);
  unchangedStock(store);
  complete(envelope({ deletedRows: 1 }));
  await pending;
  assert.deepEqual(
    store.getState().sales.map((row) => row.id),
    ["manual-sale"],
  );
});

test("staff cannot delete imported records or send deletion requests", async (t) => {
  const { store } = await isolatedStore(t);
  seed(store, [sale("csv-sale")], { session: { ...owner, role: "staff" } });
  let requests = 0;
  globalThis.fetch = () => {
    requests++;
    throw new Error("Unexpected unauthorized request");
  };
  await assert.rejects(store.getState().deleteImportedSales("csv-sale"), /owner/i);
  await assert.rejects(store.getState().deleteImportedSales(), /owner/i);
  assert.equal(requests, 0);
  assert.deepEqual(
    store.getState().sales.map((row) => row.id),
    ["csv-sale"],
  );
});

test("late deletion results cannot replace another signed-in account's cache", async (t) => {
  const { store } = await isolatedStore(t);
  seed(store, [sale("csv-sale")]);
  let complete;
  const write = new Promise((resolve) => {
    complete = resolve;
  });
  let reads = 0;
  globalThis.fetch = async (_url, options) => {
    if (options.method === "DELETE") return write;
    reads++;
    return envelope([]);
  };
  const pending = store.getState().deleteImportedSales("csv-sale");
  await new Promise((resolve) => setImmediate(resolve));
  const otherSales = [sale("other-account-sale")];
  const otherSession = { ...owner, businessId: "other-synthetic-business", userId: "other-owner" };
  store.setState({
    session: otherSession,
    sales: otherSales,
    importRefreshWarning: "Other account notice",
  });
  complete(envelope({ deletedRows: 1 }));
  await pending;
  assert.deepEqual(store.getState().sales, otherSales);
  assert.equal(store.getState().session, otherSession);
  assert.equal(store.getState().importRefreshWarning, "Other account notice");
  assert.equal(reads, 0);
});

test("API sale mapping retains imported provenance for eligible ledger controls", async (t) => {
  const { api, isImportedSale } = await isolatedStore(t);
  const rows = [
    sale("csv-sale"),
    sale("pos-sale", "pos_import"),
    sale("migration-sale", "migration"),
    sale("manual-sale", "manual"),
    sale("demo-sale", "demo"),
  ];
  globalThis.fetch = async () => envelope(rows.map(apiSale));
  const mapped = await api.sales(owner.businessId);
  assert.deepEqual(
    mapped.map((row) => row.source),
    rows.map((row) => row.source),
  );
  assert.deepEqual(mapped.map(isImportedSale), [true, true, true, false, false]);
});

test("an older import refresh cannot resurrect sales deleted while its read was pending", async (t) => {
  const { store } = await isolatedStore(t);
  const removed = sale("old-import");
  const manual = sale("manual-sale", "manual");
  const added = sale("new-import");
  seed(store, [removed, manual]);
  let completeOldRead;
  let readStarted;
  const started = new Promise((resolve) => {
    readStarted = resolve;
  });
  const staleRead = new Promise((resolve) => {
    completeOldRead = resolve;
  });
  let reads = 0;
  globalThis.fetch = async (_url, options) => {
    if (options.method === "POST")
      return envelope({ acceptedRows: 1, rejectedRows: 0, errors: [] });
    if (options.method === "DELETE") return envelope({ deletedRows: 1 });
    reads++;
    if (reads === 1) {
      readStarted();
      return staleRead;
    }
    return envelope([manual, added].map(apiSale));
  };
  const importPending = store.getState().importSales([sale("prepared-new")]);
  await started;
  await store.getState().deleteImportedSales(removed.id);
  completeOldRead(envelope([removed, manual, added].map(apiSale)));
  await importPending;
  assert.deepEqual(
    store.getState().sales.map((row) => row.id),
    [manual.id, added.id],
  );
  assert.equal(reads, 3, "the older snapshot must be discarded and read again");
  unchangedStock(store);
});

test("browser-demo imports assign unique saved IDs and source while preserving unkeyed identical rows", async (t) => {
  const { store } = await isolatedStore(t);
  seed(store, [sale("demo-sale", "demo"), sale("manual-sale", "manual")], {
    dataMode: "browser-demo",
    session: null,
  });
  globalThis.fetch = () => {
    throw new Error("Browser demo must not call API");
  };
  const row = sale("prepared-0", undefined);
  const result = await store.getState().importSales([row, { ...row }]);
  assert.equal(result.acceptedRows, 2);
  const saved = store.getState().sales.filter((item) => item.source === "csv_import");
  assert.equal(saved.length, 2);
  assert.equal(new Set(saved.map((item) => item.id)).size, 2);
  assert.ok(saved.every((item) => item.id !== row.id));
  assert.deepEqual(await store.getState().deleteImportedSales(saved[0].id), { deletedRows: 1 });
  assert.equal(store.getState().sales.filter((item) => item.source === "csv_import").length, 1);
  await store.getState().deleteImportedSales();
  assert.deepEqual(
    store.getState().sales.map((item) => item.id),
    ["demo-sale", "manual-sale"],
  );
  unchangedStock(store);
});

test("known legacy import IDs stay deletable without guessing manual or demo provenance", async (t) => {
  const { store, isImportedSale } = await isolatedStore(t);
  const legacy = [sale("imp-0", undefined), sale("prepared-1", undefined)].map(
    ({ source: _source, ...row }) => row,
  );
  const protectedRows = [
    sale("s-product-date-100", undefined),
    sale("demo-sale", "demo"),
    sale("imp-explicit-manual", "manual"),
  ].map((row) => (row.id.startsWith("s-") ? (({ source: _source, ...other }) => other)(row) : row));
  assert.deepEqual([...legacy, ...protectedRows].map(isImportedSale), [
    true,
    true,
    false,
    false,
    false,
  ]);
  seed(store, [...legacy, ...protectedRows], { dataMode: "browser-demo", session: null });
  globalThis.fetch = () => {
    throw new Error("Browser demo must not call API");
  };
  assert.deepEqual(await store.getState().deleteImportedSales(), { deletedRows: 2 });
  assert.deepEqual(store.getState().sales, protectedRows);
  unchangedStock(store);
});

test("persisted legacy duplicate importer IDs preserve every row and acquire separate delete identities", async (t) => {
  const legacy = [
    sale("prepared-0", undefined, { qty: 2 }),
    sale("prepared-0", undefined, { qty: 3 }),
  ].map(({ source: _source, ...row }) => row);
  const manual = sale("manual-sale", "manual");
  const { store } = await isolatedStore(t, {
    demo: true,
    persisted: {
      products: [product],
      sales: [...legacy, manual],
      inventoryMovements: [movement],
      settings: { storeName: "Saved synthetic demonstration" },
    },
  });
  globalThis.fetch = () => {
    throw new Error("Browser demo must not call API");
  };
  const restored = store.getState().sales;
  assert.equal(restored.length, 3);
  assert.deepEqual(
    restored.map((row) => row.qty),
    [2, 3, manual.qty],
  );
  assert.equal(restored[0].id, "prepared-0");
  assert.notEqual(restored[1].id, restored[0].id);
  assert.deepEqual(
    restored.map((row) => row.source),
    ["csv_import", "csv_import", "manual"],
  );
  assert.equal(store.getState().settings.storeName, "Saved synthetic demonstration");
  unchangedStock(store);
  assert.deepEqual(await store.getState().deleteImportedSales(restored[0].id), { deletedRows: 1 });
  assert.deepEqual(
    store.getState().sales.map((row) => row.qty),
    [3, manual.qty],
  );
  unchangedStock(store);
});
