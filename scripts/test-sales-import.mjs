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

test("API store preserves uploaded filenames and source IDs without changing inventory", async (t) => {
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
  const filename = "Retail sales café October.csv";
  const result = await useAppStore.getState().importSales([sale("till:1"), sale("till:2")], filename);
  assert.deepEqual(result, outcome);
  assert.equal(requests[0].options.method, "POST");
  assert.equal(JSON.parse(requests[0].options.body).originalFilename, filename);
  assert.deepEqual(JSON.parse(requests[0].options.body).rows, [
    { sku: "SKU-1", saleDate: "2026-09-01", quantity: "3", sourceRecordKey: "till:1" },
    { sku: "SKU-1", saleDate: "2026-09-01", quantity: "3", sourceRecordKey: "till:2" },
  ]);
  assert.equal(useAppStore.getState().products[0].currentStock, 20);
  await useAppStore.getState().importSales([sale("pasted:1")]);
  const pastedRequest = requests.filter(({ options }) => options.method === "POST").at(-1);
  assert.equal(Object.hasOwn(JSON.parse(pastedRequest.options.body), "originalFilename"), false);
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
    const cursorId = requestUrl.searchParams.get("beforeId");
    const offset = cursorId
      ? savedRows.findIndex((row) => row.id === cursorId) + 1
      : Number(requestUrl.searchParams.get("offset") ?? 0);
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
  const reads = requests.filter(({ options }) => options.method === "GET");
  assert.equal(reads.length, 101);
  assert.ok(
    reads.every(({ url }) => new URL(url, "http://localhost").searchParams.get("limit") === "1000"),
  );
  assert.equal(
    new URL(reads[1].url, "http://localhost").searchParams.get("beforeId"),
    savedRows[999].id,
  );
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

test("inventory retry keeps its explicit key after a committed write loses its response", async (t) => {
  const store = await isolatedStore(t);
  const product = {
    id: "synthetic-retry-product",
    sku: "RETRY-1",
    name: "Synthetic retry product",
    category: "Synthetic",
    unit: "piece",
    currentStock: 5,
    leadTimeDays: 1,
    safetyStock: 0,
    unitCost: 1,
    isActive: true,
  };
  store.setState({
    dataMode: "api",
    session: { businessId: "synthetic-retry-business", userId: "synthetic-owner", role: "owner" },
    products: [product],
    sales: [],
    importRefreshWarning: null,
  });
  const rows = [{ sku: product.sku, currentStock: 10 }];
  const key = "synthetic-inventory-retry";
  const cached = new Map();
  const requests = [];
  const audit = [];
  let stock = 5;
  let loseResponse = true;
  globalThis.fetch = async (_url, options) => {
    if (options.method === "POST") {
      const requestKey = options.headers["idempotency-key"];
      requests.push({ key: requestKey, body: options.body });
      if (!cached.has(requestKey)) {
        const count = JSON.parse(options.body).rows[0].currentStock;
        audit.push({ type: "inventory", before: stock, after: count });
        stock = count;
        cached.set(requestKey, { body: options.body, result: { created: 0, updated: 1 } });
      }
      assert.equal(cached.get(requestKey).body, options.body);
      if (loseResponse) {
        loseResponse = false;
        throw new TypeError("Synthetic response lost after commit");
      }
      return new Response(JSON.stringify({ data: cached.get(requestKey).result }), { status: 201 });
    }
    return new Response(
      JSON.stringify({
        data: [{ ...product, currentStock: String(stock), safetyStock: "0", unitCost: "1" }],
      }),
    );
  };
  await assert.rejects(store.getState().importInventory(rows, key), /response lost/);
  assert.equal(stock, 10);
  assert.equal(
    store.getState().products[0].currentStock,
    5,
    "an unacknowledged write cannot invent a saved frontend result",
  );
  audit.push({ type: "sale", before: stock, after: stock - 2 });
  stock -= 2;
  await store.getState().importInventory(structuredClone(rows), key);
  assert.deepEqual(
    requests.map((request) => request.key),
    [key, key],
  );
  assert.equal(requests[0].body, requests[1].body);
  assert.deepEqual(audit, [
    { type: "inventory", before: 5, after: 10 },
    { type: "sale", before: 10, after: 8 },
  ]);
  assert.equal(stock, 8, "retry must not reapply the old count after an intervening sale");
  assert.equal(store.getState().products[0].currentStock, 8);
});

test("new inventory payloads forward fresh caller keys rather than reusing a completed operation", async (t) => {
  const store = await isolatedStore(t);
  const product = { id: "synthetic-product", sku: "SKU-1", currentStock: 5 };
  store.setState({
    dataMode: "api",
    session: { businessId: "synthetic-business", userId: "synthetic-owner", role: "owner" },
    products: [product],
    sales: [],
  });
  const requests = [];
  let stock = 5;
  globalThis.fetch = async (_url, options) => {
    if (options.method === "POST") {
      const rows = JSON.parse(options.body).rows;
      requests.push({ key: options.headers["idempotency-key"], rows });
      stock = rows[0].currentStock;
      return new Response(JSON.stringify({ data: { created: 0, updated: 1 } }), { status: 201 });
    }
    return new Response(
      JSON.stringify({
        data: [{ ...product, currentStock: String(stock), safetyStock: "0", unitCost: "1" }],
      }),
    );
  };
  await store.getState().importInventory([{ sku: "SKU-1", currentStock: 10 }], "first-count");
  await store.getState().importInventory([{ sku: "SKU-1", currentStock: 12 }], "second-count");
  assert.deepEqual(requests, [
    { key: "first-count", rows: [{ sku: "SKU-1", currentStock: 10 }] },
    { key: "second-count", rows: [{ sku: "SKU-1", currentStock: 12 }] },
  ]);
  assert.equal(store.getState().products[0].currentStock, 12);
});

test("inventory callers without a supplied key retain fresh UUID compatibility", async (t) => {
  const store = await isolatedStore(t);
  store.setState({
    dataMode: "api",
    session: { businessId: "synthetic-business", userId: "synthetic-owner", role: "owner" },
    products: [],
    sales: [],
  });
  const keys = [];
  globalThis.fetch = async (_url, options) => {
    if (options.method === "POST") {
      keys.push(options.headers["idempotency-key"]);
      return new Response(JSON.stringify({ data: { created: 0, updated: 1 } }), { status: 201 });
    }
    return new Response(JSON.stringify({ data: [] }));
  };
  await store.getState().importInventory([{ sku: "SKU-1", currentStock: 10 }]);
  await store.getState().importInventory([{ sku: "SKU-1", currentStock: 12 }]);
  assert.equal(keys.length, 2);
  for (const key of keys) assert.match(key, /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i);
  assert.notEqual(keys[0], keys[1]);
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

test("browser demonstration count-only inventory keeps product details and audits the change", async (t) => {
  const store = await isolatedStore(t);
  const product = {
    id: "count-only",
    sku: "COUNT-1",
    name: "Synthetic count product",
    category: "Synthetic",
    unit: "pc",
    currentStock: 20,
    leadTimeDays: 3,
    safetyStock: 2,
    unitCost: 4,
  };
  store.setState({
    dataMode: "browser-demo",
    session: null,
    products: [product],
    inventoryMovements: [],
    sales: [],
  });
  await store.getState().importInventory([{ sku: "COUNT-1", currentStock: 7.5 }]);
  assert.deepEqual(store.getState().products, [{ ...product, currentStock: 7.5, isActive: true }]);
  assert.equal(store.getState().inventoryMovements[0].quantityDelta, -12.5);
  assert.deepEqual(store.getState().sales, []);
});

test("browser demonstration rejects a mixed count-only import atomically when a new SKU lacks details", async (t) => {
  const store = await isolatedStore(t);
  const product = {
    id: "count-only",
    sku: "COUNT-1",
    name: "Synthetic count product",
    category: "Synthetic",
    unit: "pc",
    currentStock: 20,
    leadTimeDays: 3,
    safetyStock: 2,
    unitCost: 4,
  };
  store.setState({
    dataMode: "browser-demo",
    session: null,
    products: [product],
    inventoryMovements: [],
    sales: [],
  });
  await assert.rejects(
    store.getState().importInventory([
      { sku: "COUNT-1", currentStock: 2 },
      { sku: "NEW", currentStock: 3 },
    ]),
    /New SKU NEW needs/,
  );
  assert.deepEqual(store.getState().products, [product]);
  assert.deepEqual(store.getState().inventoryMovements, []);
});

for (const kind of ["inventory", "sales"]) {
  test(`a committed ${kind} import remains successful when the follow-up read fails`, async (t) => {
    const store = await isolatedStore(t);
    const product = {
      id: "synthetic-product",
      sku: "SKU-1",
      name: "Synthetic",
      category: "Synthetic",
      unit: "piece",
      currentStock: 20,
      leadTimeDays: 1,
      safetyStock: 0,
      unitCost: 1,
    };
    store.setState({
      dataMode: "api",
      session: { businessId: "synthetic-business", userId: "synthetic-owner", role: "owner" },
      products: [product],
      sales: [],
      importRefreshWarning: null,
    });
    let writes = 0;
    globalThis.fetch = async (_url, options) => {
      if (options.method === "POST") {
        writes++;
        if (kind === "inventory")
          assert.equal(options.headers["idempotency-key"], "acknowledged-inventory");
        return new Response(
          JSON.stringify({
            data:
              kind === "sales"
                ? { acceptedRows: 1, rejectedRows: 0, errors: [] }
                : { created: 1, updated: 0 },
          }),
          { status: 201 },
        );
      }
      return new Response(JSON.stringify({ detail: "Injected read failure" }), { status: 503 });
    };
    if (kind === "sales")
      assert.equal((await store.getState().importSales([sale("new")])).acceptedRows, 1);
    else {
      const { id: _id, ...row } = product;
      await store.getState().importInventory([row], "acknowledged-inventory");
    }
    assert.equal(writes, 1);
    assert.match(store.getState().importRefreshWarning, /was saved.*Reload saved records/);
    assert.deepEqual(store.getState().products, [product]);
    assert.deepEqual(store.getState().sales, []); // No invented server IDs or unsaved cache records.
  });
}

test("sales reload keeps the older 200-row API usable during an update", async (t) => {
  const store = await isolatedStore(t);
  const row = sale("stable");
  store.setState({
    dataMode: "api",
    session: { businessId: "synthetic-business", userId: "synthetic-owner", role: "owner" },
    products: [{ id: "synthetic-product", sku: "SKU-1" }],
    sales: [],
  });
  const limits = [];
  globalThis.fetch = async (url, options) => {
    if (options.method === "POST")
      return new Response(
        JSON.stringify({ data: { acceptedRows: 1, rejectedRows: 0, errors: [] } }),
        { status: 201 },
      );
    const limit = new URL(url, "http://localhost").searchParams.get("limit");
    limits.push(limit);
    return limit === "1000"
      ? new Response(JSON.stringify({ detail: "Legacy page limit" }), { status: 422 })
      : new Response(
          JSON.stringify({
            data: [
              {
                id: row.id,
                productId: row.productId,
                saleDate: row.date,
                quantity: String(row.qty),
              },
            ],
          }),
        );
  };
  await store.getState().importSales([row]);
  assert.deepEqual(limits, ["1000", "200"]);
  assert.equal(store.getState().sales.length, 1);
  assert.equal(store.getState().importRefreshWarning, null);
});

test("a non-advancing sales cursor stops safely instead of looping or repeating the import", async (t) => {
  const store = await isolatedStore(t);
  store.setState({
    dataMode: "api",
    session: { businessId: "synthetic-business", userId: "synthetic-owner", role: "owner" },
    products: [{ id: "synthetic-product", sku: "SKU-1" }],
    sales: [],
  });
  let reads = 0;
  globalThis.fetch = async (_url, options) => {
    if (options.method === "POST")
      return new Response(
        JSON.stringify({ data: { acceptedRows: 1, rejectedRows: 0, errors: [] } }),
        { status: 201 },
      );
    reads++;
    return new Response(
      JSON.stringify({
        data: Array.from({ length: 1000 }, (_, index) => ({
          id: `same:${index}`,
          productId: "synthetic-product",
          saleDate: "2026-10-05",
          quantity: "1",
        })),
      }),
    );
  };
  assert.equal((await store.getState().importSales([sale("new")])).acceptedRows, 1);
  assert.equal(reads, 2);
  assert.match(store.getState().importRefreshWarning, /was saved/);
});

test("late import reloads cannot replace another account's records or warnings", async (t) => {
  const store = await isolatedStore(t);
  const row = sale("stable");
  store.setState({
    dataMode: "api",
    session: { businessId: "synthetic-a", userId: "owner-a", role: "owner" },
    products: [{ id: "synthetic-product", sku: "SKU-1" }],
    sales: [],
  });
  let resolveRead;
  const pending = new Promise((resolve) => {
    resolveRead = resolve;
  });
  globalThis.fetch = async (_url, options) =>
    options.method === "POST"
      ? new Response(JSON.stringify({ data: { acceptedRows: 1, rejectedRows: 0, errors: [] } }), {
          status: 201,
        })
      : pending;
  const imported = store.getState().importSales([row]);
  await new Promise((resolve) => setImmediate(resolve));
  const otherSales = [{ ...row, id: "other-sale", productId: "other-product" }];
  store.setState({
    session: { businessId: "synthetic-b", userId: "owner-b", role: "owner" },
    sales: otherSales,
    importRefreshWarning: null,
  });
  resolveRead(
    new Response(
      JSON.stringify({
        data: [
          { id: row.id, productId: row.productId, saleDate: row.date, quantity: String(row.qty) },
        ],
      }),
    ),
  );
  await imported;
  assert.deepEqual(store.getState().sales, otherSales);
  assert.equal(store.getState().importRefreshWarning, null);
});
