import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

const root = fileURLToPath(new URL("../", import.meta.url));
const alias = { "@": fileURLToPath(new URL("../src", import.meta.url)) };
const serverOptions = {
  root,
  configFile: false,
  logLevel: "silent",
  server: { middlewareMode: true, watch: null },
  resolve: { alias },
};
const storeServer = await createServer(serverOptions);
const { useAppStore } = await storeServer.ssrLoadModule("/src/lib/store.ts");
const { invalidatePipelineCache, peekStalePipeline, putPipeline } = await storeServer.ssrLoadModule(
  "/src/lib/forecast/cache.ts",
);
const storePath = fileURLToPath(new URL("../src/lib/store.ts", import.meta.url)).replaceAll(
  "\\",
  "/",
);
const renderServer = await createServer({
  ...serverOptions,
  plugins: [
    {
      name: "maintenance-render-state",
      load(id) {
        if (id.replaceAll("\\", "/") !== storePath) return;
        return `
        let state;
        export function setTestState(value) { state = value; }
        export const useAppStore = (selector) => selector(state);
      `;
      },
    },
  ],
});
const { setTestState } = await renderServer.ssrLoadModule("/src/lib/store.ts");
const { ProductsPanel } = await renderServer.ssrLoadModule("/src/components/products-panel.tsx");
const { StockMovementsPanel } = await renderServer.ssrLoadModule(
  "/src/components/stock-movements-panel.tsx",
);
const { getPermissions } = await renderServer.ssrLoadModule("/src/lib/permissions.ts");
const originalFetch = globalThis.fetch;
const originalDocument = globalThis.document;
after(async () => {
  globalThis.fetch = originalFetch;
  if (originalDocument === undefined) delete globalThis.document;
  else globalThis.document = originalDocument;
  await Promise.all([storeServer.close(), renderServer.close()]);
});

const product = {
  id: "synthetic-product",
  sku: "PRACTICE-001",
  name: "Practice rice",
  category: "Staples",
  unit: "kg",
  currentStock: 10,
  leadTimeDays: 3,
  safetyStock: 2,
  unitCost: 45,
  isActive: true,
};
const session = {
  businessId: "synthetic-business",
  userId: "synthetic-user",
  displayName: "Practice user",
  email: "practice@example.test",
  role: "owner",
};
const input = {
  productId: product.id,
  movementDate: "2026-10-04",
  movementType: "return",
  quantityDelta: 1.25,
  note: "  Unopened item  ",
  idempotencyKey: "synthetic-retry-key",
};
const movement = {
  id: "synthetic-movement",
  businessId: session.businessId,
  productId: product.id,
  movementDate: input.movementDate,
  movementType: "return",
  quantityDelta: "1.25",
  balanceAfter: "11.25",
  dataOrigin: "demo",
  saleId: null,
  note: "Unopened item",
  recordedBy: session.userId,
};
function envelope(data, status = 200) {
  return new Response(JSON.stringify({ data }), {
    status,
    headers: { "content-type": "application/json" },
  });
}
function catalogEnvelope(currentStock, rows = [product]) {
  return envelope(
    rows.map((row) => ({
      ...row,
      currentStock: String(currentStock),
      safetyStock: String(row.safetyStock),
      unitCost: String(row.unitCost),
    })),
  );
}
function deferred() {
  let resolve;
  const promise = new Promise((finish) => {
    resolve = finish;
  });
  return { promise, resolve };
}
beforeEach(() => {
  globalThis.document = { cookie: "stockcast_csrf=synthetic-csrf" };
  globalThis.fetch = async () => {
    throw new Error("Unexpected network request");
  };
  useAppStore.setState({
    dataMode: "api",
    session: { ...session },
    products: [{ ...product }],
    sales: [],
    inventoryMovements: [],
    movementsStatus: "idle",
    movementsError: null,
  });
});

test("a count retry confirms the first correction without replacing current stock with its old response", async () => {
  for (const refreshed of [false, true]) {
    useAppStore.setState({ products: [{ ...product, currentStock: 20 }] });
    let saved;
    let databaseStock = 20;
    let writes = 0;
    const keys = [];
    globalThis.fetch = async (_url, options) => {
      if (options.method === "GET") return catalogEnvelope(databaseStock);
      assert.equal(options.method, "PATCH");
      assert.deepEqual(JSON.parse(options.body), { currentStock: 8 });
      keys.push(options.headers["idempotency-key"]);
      if (!saved) {
        writes++;
        databaseStock = 8;
        saved = { ...product, currentStock: "8" };
        throw new TypeError("Synthetic lost count response");
      }
      return envelope(saved);
    };
    await assert.rejects(
      useAppStore.getState().updateProduct(product.id, { currentStock: 8 }, "count-retry"),
      /lost count response/,
    );
    databaseStock = 7;
    if (refreshed) useAppStore.setState({ products: [{ ...product, currentStock: 7 }] });
    await useAppStore.getState().updateProduct(product.id, { currentStock: 8 }, "count-retry");
    assert.deepEqual(keys, ["count-retry", "count-retry"]);
    assert.equal(writes, 1);
    assert.equal(databaseStock, 7);
    assert.equal(useAppStore.getState().products[0].currentStock, 7);
  }
});

test("a confirmed count stays successful when current stock cannot be read", async () => {
  useAppStore.setState({ products: [{ ...product, currentStock: 7 }] });
  globalThis.fetch = async (_url, options) => {
    if (options.method === "GET") throw new TypeError("Synthetic stock read failure");
    assert.equal(options.headers["idempotency-key"], "saved-count");
    return envelope({ ...product, currentStock: "8" });
  };
  await useAppStore.getState().updateProduct(product.id, { currentStock: 8 }, "saved-count");
  const state = useAppStore.getState();
  assert.equal(
    state.products[0].currentStock,
    7,
    "a historical count must not overwrite known stock",
  );
  assert.equal(state.movementsStatus, "error");
  assert.match(state.movementsError, /Stock count saved.*Refresh stock movements/);
});

test("a product creation replay reads one current product without duplicating a preloaded result", async () => {
  const { id: _id, ...creation } = { ...product, sku: "SKU-stable", currentStock: 20 };
  const created = { ...creation, id: "created-product" };
  for (const preloaded of [false, true]) {
    useAppStore.setState({ products: [] });
    let saved;
    let writes = 0;
    const keys = [];
    globalThis.fetch = async (_url, options) => {
      if (options.method === "GET") return catalogEnvelope(15, [created]);
      keys.push(options.headers["idempotency-key"]);
      assert.deepEqual(JSON.parse(options.body), creation);
      if (!saved) {
        writes++;
        saved = { ...created, currentStock: "20" };
        throw new TypeError("Synthetic lost creation response");
      }
      return envelope(saved);
    };
    await assert.rejects(
      useAppStore.getState().addProduct(creation, "creation-retry"),
      /lost creation response/,
    );
    if (preloaded) useAppStore.setState({ products: [{ ...created, currentStock: 15 }] });
    await useAppStore.getState().addProduct(creation, "creation-retry");
    assert.deepEqual(keys, ["creation-retry", "creation-retry"]);
    assert.equal(writes, 1);
    assert.equal(useAppStore.getState().products.length, 1);
    assert.equal(useAppStore.getState().products[0].currentStock, 15);
  }
});

test("a confirmed product creation remains successful without inserting a historical catalog balance", async () => {
  const before = useAppStore.getState().products;
  globalThis.fetch = async (_url, options) => {
    if (options.method === "GET") throw new TypeError("Synthetic catalog failure");
    return envelope({ ...product, id: "new-product", sku: "NEW-1", currentStock: "20" });
  };
  await useAppStore.getState().addProduct({ ...product, sku: "NEW-1" }, "acknowledged-create");
  assert.equal(useAppStore.getState().products, before);
  assert.match(useAppStore.getState().movementsError, /Product saved.*latest catalog/);
});

test("a return posts signed decimal quantities and audit notes, then reads current catalog stock", async () => {
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    if (options.method === "GET") return catalogEnvelope(15);
    return envelope({ ...movement, balanceAfter: "14.75" }, 201);
  };
  await useAppStore.getState().recordStockMovement(input);
  assert.equal(requests.length, 2);
  assert.match(requests[0].url, /synthetic-business\/inventory-movements$/);
  assert.equal(requests[0].options.headers["x-csrf-token"], "synthetic-csrf");
  assert.equal(requests[0].options.headers["idempotency-key"], input.idempotencyKey);
  assert.deepEqual(JSON.parse(requests[0].options.body), {
    productId: product.id,
    movementDate: input.movementDate,
    movementType: "return",
    quantityDelta: "1.25",
    note: "Unopened item",
  });
  assert.match(requests[1].url, /synthetic-business\/products$/);
  assert.equal(requests[1].options.method, "GET");
  const state = useAppStore.getState();
  assert.equal(
    state.products[0].currentStock,
    15,
    "the current catalog can differ from the movement's historical balance",
  );
  assert.equal(state.inventoryMovements[0].recordedBy, session.userId);
  assert.equal(state.inventoryMovements[0].note, "Unopened item");
  assert.equal(state.inventoryMovements[0].balanceAfter, 14.75);
  assert.equal(state.sales.length, 0, "a stock return must not create or rewrite sales history");
});

test("failed write-off leaves balances and audit unchanged; retry reuses its key and saves once", async () => {
  const keys = [];
  let fail = true;
  globalThis.fetch = async (_url, options) => {
    if (options.method === "GET") return catalogEnvelope(7.5);
    keys.push(options.headers["idempotency-key"]);
    assert.equal(JSON.parse(options.body).quantityDelta, "-2.5");
    if (fail) return new Response(JSON.stringify({ detail: "Temporary failure" }), { status: 503 });
    return envelope({
      ...movement,
      movementType: "write_off",
      quantityDelta: "-2.5",
      balanceAfter: "7.5",
    });
  };
  const writeOff = {
    ...input,
    movementType: "write_off",
    quantityDelta: -2.5,
    note: "Expired stock",
  };
  await assert.rejects(useAppStore.getState().recordStockMovement(writeOff), /Temporary failure/);
  assert.equal(useAppStore.getState().products[0].currentStock, 10);
  assert.equal(useAppStore.getState().inventoryMovements.length, 0);
  fail = false;
  await useAppStore.getState().recordStockMovement(writeOff);
  await useAppStore.getState().recordStockMovement(writeOff);
  assert.deepEqual(keys, Array(3).fill(input.idempotencyKey));
  assert.equal(useAppStore.getState().products[0].currentStock, 7.5);
  assert.equal(
    useAppStore.getState().inventoryMovements.length,
    1,
    "an idempotent response is not duplicated in the ledger",
  );
});

test("a lost delivery response replays its audit without restoring the delivery's old stock balance", async () => {
  const receipt = { ...movement, movementType: "receipt", quantityDelta: "10", balanceAfter: "30" };
  const submission = { idempotencyKey: "lost-delivery-key", movementDate: input.movementDate };
  useAppStore.setState({ products: [{ ...product, currentStock: 20 }] });
  const posts = [];
  let finishCatalog;
  let retrying = false;
  globalThis.fetch = async (url, options) => {
    if (options.method === "POST") {
      posts.push({ key: options.headers["idempotency-key"], body: JSON.parse(options.body) });
      if (posts.length === 1) throw new Error("Delivery response lost");
      return envelope(receipt);
    }
    if (url.endsWith("/products")) {
      if (retrying)
        return new Promise((resolve) => {
          finishCatalog = () => resolve(catalogEnvelope(25));
        });
      return catalogEnvelope(25);
    }
    return envelope([receipt]);
  };
  await assert.rejects(
    useAppStore.getState().receiveStock(product.id, 10, submission),
    /Delivery response lost/,
  );
  assert.equal(useAppStore.getState().products[0].currentStock, 20);
  await useAppStore.getState().refreshInventoryMovements();
  assert.equal(useAppStore.getState().products[0].currentStock, 25);
  retrying = true;
  const retry = useAppStore.getState().receiveStock(product.id, 10, submission);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(typeof finishCatalog, "function", "a replay requests the latest catalog stock");
  assert.equal(
    useAppStore.getState().products[0].currentStock,
    25,
    "even while the catalog read is pending, the replay must not display historical stock 30",
  );
  finishCatalog();
  await retry;
  assert.deepEqual(posts[0], posts[1]);
  assert.equal(useAppStore.getState().products[0].currentStock, 25);
  assert.equal(useAppStore.getState().inventoryMovements.length, 1);
  assert.equal(useAppStore.getState().inventoryMovements[0].balanceAfter, 30);
});

test("a committed movement stays successful when catalog refresh fails, preserving current stock and one audit", async () => {
  useAppStore.setState({ products: [{ ...product, currentStock: 25 }] });
  const balances = [];
  const unsubscribe = useAppStore.subscribe((state) =>
    balances.push(state.products[0].currentStock),
  );
  let posted = 0;
  let reads = 0;
  globalThis.fetch = async (_url, options) => {
    if (options.method === "POST") {
      posted++;
      return envelope({
        ...movement,
        movementType: "receipt",
        quantityDelta: "10",
        balanceAfter: "30",
      });
    }
    reads++;
    throw new Error("Catalog unavailable");
  };
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      await useAppStore.getState().receiveStock(product.id, 10, {
        movementDate: input.movementDate,
        idempotencyKey: "saved-delivery-key",
      });
      assert.equal(useAppStore.getState().products[0].currentStock, 25);
      assert.equal(useAppStore.getState().inventoryMovements.length, 1);
      assert.equal(useAppStore.getState().inventoryMovements[0].balanceAfter, 30);
      assert.equal(useAppStore.getState().movementsStatus, "error");
      assert.equal(
        useAppStore.getState().movementsError,
        "Stock movement saved. Refresh stock movements to verify the latest balances.",
      );
    }
  } finally {
    unsubscribe();
  }
  assert.equal(posted, 2);
  assert.equal(reads, 2);
  assert.ok(
    balances.every((balance) => balance === 25),
    "historical balances are never rendered",
  );
});

test("a lost write-off can retry after stock refreshes to zero, but changed submissions still need stock", async () => {
  const writeOff = {
    ...input,
    movementType: "write_off",
    quantityDelta: -5,
    note: "  Damaged package  ",
    idempotencyKey: "lost-write-off-key",
  };
  const saved = {
    ...movement,
    movementType: "write_off",
    quantityDelta: "-5",
    balanceAfter: "0",
    note: "Damaged package",
  };
  const otherProduct = { ...product, id: "other-product", sku: "OTHER-001", currentStock: 0 };
  useAppStore.setState({ products: [{ ...product, currentStock: 5 }, otherProduct] });
  const posts = [];
  globalThis.fetch = async (url, options) => {
    if (options.method === "POST") {
      posts.push({ key: options.headers["idempotency-key"], body: JSON.parse(options.body) });
      if (posts.length === 1) throw new Error("Write-off response lost");
      return envelope(saved);
    }
    return url.endsWith("/products")
      ? catalogEnvelope(0, [product, otherProduct])
      : envelope([saved]);
  };
  await assert.rejects(useAppStore.getState().recordStockMovement(writeOff), /response lost/);
  await useAppStore.getState().refreshInventoryMovements();
  assert.equal(useAppStore.getState().products[0].currentStock, 0);
  for (const changed of [
    { productId: otherProduct.id },
    { movementDate: "2026-10-03" },
    { movementType: "adjustment" },
    { quantityDelta: -4 },
    { note: "Different reason" },
    { idempotencyKey: "new-write-off-key" },
    { idempotencyKey: undefined },
  ]) {
    await assert.rejects(
      useAppStore.getState().recordStockMovement({ ...writeOff, ...changed }),
      /negative/,
    );
  }
  assert.equal(posts.length, 1, "changed submissions never bypass local stock validation");
  await useAppStore.getState().recordStockMovement({ ...writeOff, note: "Damaged package" });
  assert.deepEqual(posts[0], posts[1], "normalized notes identify the same submitted request");
  assert.equal(useAppStore.getState().products[0].currentStock, 0);
  assert.equal(useAppStore.getState().inventoryMovements.length, 1);
  await assert.rejects(useAppStore.getState().recordStockMovement(writeOff), /negative/);
  assert.equal(posts.length, 2, "a completed submission no longer grants the pending retry bypass");
});

test("saved sale retries retain their original product after deactivation or removal", async () => {
  for (const removed of [false, true]) {
    const other = { ...product, id: "still-active-product", sku: "ACTIVE-002", currentStock: 30 };
    useAppStore.setState({ session: { ...session }, products: [{ ...product }, other], sales: [] });
    const posts = [];
    const current = removed ? [other] : [{ ...product, isActive: false, currentStock: 0 }, other];
    globalThis.fetch = async (_url, options) => {
      if (options.method === "GET")
        return envelope(
          current.map((row) => ({
            ...row,
            currentStock: String(row.currentStock),
            safetyStock: String(row.safetyStock),
            unitCost: String(row.unitCost),
          })),
        );
      posts.push({ key: options.headers["idempotency-key"], body: JSON.parse(options.body) });
      if (posts.length === 1) throw new Error("Synthetic lost sale response");
      return envelope({
        id: "saved-inactive-sale",
        productId: product.id,
        saleDate: input.movementDate,
        quantity: "5",
      });
    };
    const save = (qty = 5, key = "inactive-sale") =>
      useAppStore.getState().recordSale(product.id, input.movementDate, qty, key);
    await assert.rejects(save(), /lost sale response/);
    useAppStore.setState({ products: current });
    await assert.rejects(save(4), /active product/);
    await assert.rejects(save(5, "new-inactive-sale"), /active product/);
    await save();
    assert.deepEqual(posts[0], posts[1]);
    assert.equal(posts.length, 2);
    assert.equal(useAppStore.getState().sales[0].productId, product.id);
    assert.equal(
      useAppStore.getState().products.find((row) => row.id === other.id).currentStock,
      30,
    );
    assert.equal(
      useAppStore.getState().products.some((row) => row.id === product.id),
      !removed,
    );
    await assert.rejects(save(), /active product/);
  }
});

test("only exact pending movement retries bypass changed product activity", async () => {
  for (const removed of [false, true]) {
    for (const movementType of ["receipt", "return", "write_off"]) {
      useAppStore.setState({
        session: { ...session },
        products: [{ ...product }],
        inventoryMovements: [],
      });
      const request = {
        ...input,
        movementType,
        quantityDelta: movementType === "write_off" ? -5 : 2,
        note: "Saved reason",
        idempotencyKey: "inactive-movement",
      };
      const posts = [];
      const current = removed ? [] : [{ ...product, currentStock: 0, isActive: false }];
      globalThis.fetch = async (_url, options) => {
        if (options.method === "GET") return catalogEnvelope(0, current);
        posts.push({ key: options.headers["idempotency-key"], body: JSON.parse(options.body) });
        if (posts.length === 1) throw new Error("Synthetic lost movement response");
        return envelope({
          ...movement,
          movementType,
          quantityDelta: String(request.quantityDelta),
          balanceAfter: "0",
        });
      };
      await assert.rejects(
        useAppStore.getState().recordStockMovement(request),
        /lost movement response/,
      );
      useAppStore.setState({ products: current });
      await assert.rejects(
        useAppStore.getState().recordStockMovement({ ...request, note: "Changed" }),
        /active product/,
      );
      await assert.rejects(
        useAppStore.getState().recordStockMovement({ ...request, idempotencyKey: "new-attempt" }),
        /active product/,
      );
      await useAppStore.getState().recordStockMovement({ ...request, note: "  Saved reason  " });
      assert.deepEqual(posts[0], posts[1]);
      assert.equal(posts.length, 2);
      assert.equal(useAppStore.getState().inventoryMovements.length, 1);
      assert.deepEqual(useAppStore.getState().products, current);
      await assert.rejects(useAppStore.getState().recordStockMovement(request), /active product/);
    }
  }
});

test("pending sale and movement dates survive a backwards business-day change", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-10-20T00:30:00Z") });
  const previous = useAppStore.getState().settings;
  t.after(() => useAppStore.setState({ settings: previous }));
  for (const kind of ["sale", "movement"]) {
    useAppStore.setState({
      session: { ...session },
      products: [{ ...product }],
      sales: [],
      inventoryMovements: [],
      settings: { ...previous, timezone: "Asia/Manila" },
    });
    const posts = [];
    const save = (qty = 1, key = "timezone-attempt") =>
      kind === "sale"
        ? useAppStore.getState().recordSale(product.id, "2026-10-20", qty, key)
        : useAppStore
            .getState()
            .recordStockMovement({
              ...input,
              movementDate: "2026-10-20",
              quantityDelta: qty,
              idempotencyKey: key,
            });
    globalThis.fetch = async (_url, options) => {
      if (options.method === "GET") return catalogEnvelope(9);
      posts.push({ key: options.headers["idempotency-key"], body: JSON.parse(options.body) });
      if (posts.length === 1) throw new Error("Synthetic lost response");
      return kind === "sale"
        ? envelope({
            id: "timezone-sale",
            productId: product.id,
            saleDate: "2026-10-20",
            quantity: "1",
          })
        : envelope({ ...movement, movementDate: "2026-10-20" });
    };
    await assert.rejects(save(), /lost response/);
    useAppStore.setState({ settings: { ...previous, timezone: "Pacific/Honolulu" } });
    await assert.rejects(save(2), /future-dated/);
    await assert.rejects(save(1, "new-timezone-attempt"), /future-dated/);
    await save();
    assert.deepEqual(posts[0], posts[1]);
    assert.equal(posts.length, 2);
    await assert.rejects(save(), /future-dated/);
  }
});

test("an uncached retry reaches backend validation without claiming a saved write", async () => {
  for (const kind of ["sale", "movement"]) {
    useAppStore.setState({
      session: { ...session },
      products: [{ ...product }],
      sales: [],
      inventoryMovements: [],
    });
    let posts = 0;
    globalThis.fetch = async (_url, options) => {
      assert.equal(options.method, "POST");
      posts++;
      if (posts === 1) throw new Error("Request never saved");
      return new Response(JSON.stringify({ detail: "Product is inactive; nothing saved" }), {
        status: 422,
      });
    };
    const save = () =>
      kind === "sale"
        ? useAppStore.getState().recordSale(product.id, input.movementDate, 1, "never-saved")
        : useAppStore.getState().recordStockMovement({ ...input, idempotencyKey: "never-saved" });
    await assert.rejects(save(), /never saved/);
    useAppStore.setState({ products: [{ ...product, isActive: false }] });
    await assert.rejects(save(), /inactive; nothing saved/);
    assert.equal(posts, 2);
    assert.equal(useAppStore.getState().sales.length, 0);
    assert.equal(useAppStore.getState().inventoryMovements.length, 0);
  }
});

test("pending write-off retry permission belongs to its original session", async () => {
  for (const nextSession of [
    { ...session, userId: "other-owner", businessId: "other-business" },
    { ...session },
  ]) {
    const originalSession = { ...session };
    const writeOff = { ...input, movementType: "write_off", quantityDelta: -5 };
    useAppStore.setState({ session: originalSession, products: [{ ...product, currentStock: 5 }] });
    let posts = 0;
    globalThis.fetch = async () => {
      posts++;
      throw new Error("Response lost");
    };
    await assert.rejects(useAppStore.getState().recordStockMovement(writeOff), /Response lost/);
    useAppStore.setState({ session: nextSession, products: [{ ...product, currentStock: 0 }] });
    await assert.rejects(useAppStore.getState().recordStockMovement(writeOff), /negative/);
    assert.equal(posts, 1, "another session cannot reuse an earlier session's pending payload");
  }
});

test("a late movement response cannot update a different session or request its catalog", async () => {
  let finish;
  let requests = 0;
  globalThis.fetch = () => {
    requests++;
    return new Promise((resolve) => {
      finish = resolve;
    });
  };
  const save = useAppStore.getState().recordStockMovement(input);
  const products = [{ ...product, currentStock: 25 }];
  const inventoryMovements = [{ ...movement, id: "other-session-audit" }];
  const nextSession = { ...session };
  useAppStore.setState({ session: nextSession, products, inventoryMovements });
  finish(envelope(movement));
  await save;
  assert.equal(requests, 1);
  assert.equal(useAppStore.getState().products, products);
  assert.equal(useAppStore.getState().inventoryMovements, inventoryMovements);
});

test("a movement's late catalog read cannot overwrite a fresh session's stock", async () => {
  let finish;
  globalThis.fetch = async (_url, options) => {
    if (options.method === "POST") return envelope(movement);
    return new Promise((resolve) => {
      finish = resolve;
    });
  };
  const save = useAppStore.getState().recordStockMovement(input);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(typeof finish, "function");
  const products = [{ ...product, currentStock: 25 }];
  const inventoryMovements = [{ ...movement, id: "new-session-audit" }];
  useAppStore.setState({ session: { ...session }, products, inventoryMovements });
  finish(catalogEnvelope(11.25));
  await save;
  assert.equal(useAppStore.getState().products, products);
  assert.equal(useAppStore.getState().inventoryMovements, inventoryMovements);
});

test("a catalog read from an earlier movement retries after a later movement changes stock", async () => {
  let finishEarlierCatalog;
  let posts = 0;
  let reads = 0;
  globalThis.fetch = async (_url, options) => {
    if (options.method === "POST") {
      posts++;
      return envelope({
        ...movement,
        id: `saved-movement-${posts}`,
        quantityDelta: "1",
        balanceAfter: String(10 + posts),
      });
    }
    reads++;
    if (reads === 1)
      return new Promise((resolve) => {
        finishEarlierCatalog = () => resolve(catalogEnvelope(11));
      });
    return catalogEnvelope(12);
  };
  const earlierSave = useAppStore.getState().recordStockMovement({
    ...input,
    quantityDelta: 1,
    idempotencyKey: "earlier-movement-key",
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(typeof finishEarlierCatalog, "function");
  await useAppStore.getState().recordStockMovement({
    ...input,
    quantityDelta: 1,
    idempotencyKey: "later-movement-key",
  });
  assert.equal(useAppStore.getState().products[0].currentStock, 12);
  finishEarlierCatalog();
  await earlierSave;
  assert.equal(reads, 3, "an older catalog read is repeated after the later committed movement");
  assert.equal(useAppStore.getState().products[0].currentStock, 12);
  assert.equal(useAppStore.getState().inventoryMovements.length, 2);
});

test("staff can record returns and receipts while owner management calls are rejected before sending", async () => {
  useAppStore.setState({ session: { ...session, role: "staff" } });
  let requests = 0;
  globalThis.fetch = async (_url, options) => {
    if (options.method === "GET") return catalogEnvelope(11.25);
    requests++;
    const body = JSON.parse(options.body);
    return envelope({ ...movement, movementType: body.movementType });
  };
  await useAppStore.getState().recordStockMovement(input);
  await useAppStore.getState().receiveStock(product.id, 1);
  const state = useAppStore.getState();
  for (const operation of [
    () => state.recordStockMovement({ ...input, movementType: "write_off", quantityDelta: -1 }),
    () => state.recordStockMovement({ ...input, movementType: "adjustment" }),
    () => state.updateProduct(product.id, { name: "Changed" }),
    () => state.deleteProduct(product.id),
    () => state.addProduct(product),
    () => state.importInventory([product]),
    () => state.importSales([]),
    () => state.updateSettings({ coverDays: 3 }),
  ])
    await assert.rejects(operation(), /Owner role required/);
  assert.equal(requests, 2);
});

test("inactive products, excessive write-offs and unsupported quantity precision leave stock unchanged", async () => {
  const state = useAppStore.getState();
  await assert.rejects(
    state.recordStockMovement({ ...input, movementType: "write_off", quantityDelta: -11 }),
    /negative/,
  );
  await assert.rejects(
    state.recordStockMovement({ ...input, quantityDelta: 0.0001 }),
    /three decimal places/,
  );
  await assert.rejects(
    state.recordStockMovement({ ...input, quantityDelta: 0.0000000001 }),
    /three decimal places/,
  );
  await assert.rejects(
    state.recordStockMovement({ ...input, quantityDelta: -1 }),
    /increase stock/,
  );
  useAppStore.setState({ products: [{ ...product, isActive: false }] });
  await assert.rejects(state.recordStockMovement(input), /active product/);
  await assert.rejects(state.receiveStock(product.id, 1), /active product/);
  await assert.rejects(state.recordSale(product.id, input.movementDate, 1), /active product/);
  assert.equal(useAppStore.getState().products[0].currentStock, 10);
});

test("a committed sale remains successful when the follow-up catalog read fails", async () => {
  let posted = 0;
  globalThis.fetch = async (_url, options) => {
    if (options.method === "POST") {
      posted++;
      return envelope({
        id: "new-sale",
        productId: product.id,
        saleDate: input.movementDate,
        quantity: "1.5",
      });
    }
    throw new Error("Catalog unavailable");
  };
  await useAppStore.getState().recordSale(product.id, input.movementDate, 1.5);
  assert.equal(posted, 1);
  assert.equal(useAppStore.getState().sales[0].qty, 1.5);
  assert.equal(useAppStore.getState().products[0].currentStock, 8.5);
  assert.match(useAppStore.getState().movementsError, /Sale saved/);
});

test("movement pagination converts all saved decimal balances, and read failure remains retryable", async () => {
  const offsets = [];
  globalThis.fetch = async (url) => {
    if (url.includes("/products"))
      return envelope([{ ...product, currentStock: "10", safetyStock: "2", unitCost: "45" }]);
    const offset = new URL(url, "http://practice.test").searchParams.get("offset");
    offsets.push(offset);
    return envelope(
      offset === "0"
        ? Array.from({ length: 200 }, (_, i) => ({ ...movement, id: `movement-${i}` }))
        : [{ ...movement, id: "last-movement" }],
    );
  };
  await useAppStore.getState().refreshInventoryMovements();
  assert.deepEqual(offsets, ["0", "200"]);
  assert.equal(useAppStore.getState().inventoryMovements.length, 201);
  assert.equal(useAppStore.getState().inventoryMovements[200].quantityDelta, 1.25);
  globalThis.fetch = async () => {
    throw new Error("Connection unavailable");
  };
  await assert.rejects(
    useAppStore.getState().refreshInventoryMovements(),
    /Connection unavailable/,
  );
  assert.equal(useAppStore.getState().movementsStatus, "error");
  assert.equal(useAppStore.getState().inventoryMovements.length, 201);
  assert.equal(useAppStore.getState().movementsError, "Connection unavailable");
});

test("a slow ledger refresh cannot replace a movement saved while it was loading", async () => {
  const pending = [];
  let reads = 0;
  const apiProduct = { ...product, currentStock: "10", safetyStock: "2", unitCost: "45" };
  globalThis.fetch = async (url, options) => {
    if (options.method === "POST") return envelope(movement);
    reads++;
    if (reads <= 2)
      return new Promise((resolve) => {
        pending.push(() => resolve(envelope(url.includes("/products") ? [apiProduct] : [])));
      });
    return envelope(
      url.includes("/products") ? [{ ...apiProduct, currentStock: "11.25" }] : [movement],
    );
  };
  const refresh = useAppStore.getState().refreshInventoryMovements();
  assert.equal(pending.length, 2);
  await useAppStore.getState().recordStockMovement(input);
  pending.forEach((resolve) => resolve());
  await refresh;
  assert.equal(reads, 5, "the write refreshes current stock and obsolete ledger reads run again");
  assert.equal(useAppStore.getState().products[0].currentStock, 11.25);
  assert.equal(useAppStore.getState().inventoryMovements[0].id, movement.id);
  assert.equal(useAppStore.getState().movementsStatus, "ready");
});

test("demo maintenance preserves history, audits count changes, and snapshot imports reactivate products", async () => {
  const historicSale = { id: "historic-sale", productId: product.id, date: "2026-09-01", qty: 2 };
  useAppStore.setState({ dataMode: "browser-demo", session: null, sales: [historicSale] });
  await useAppStore.getState().recordStockMovement(input);
  await useAppStore.getState().recordStockMovement({
    ...input,
    movementType: "write_off",
    quantityDelta: -0.25,
    note: "Damaged",
  });
  assert.equal(useAppStore.getState().products[0].currentStock, 11);
  await useAppStore
    .getState()
    .updateProduct(product.id, { name: "Updated rice", unitCost: 50, isActive: false });
  assert.equal(useAppStore.getState().products[0].isActive, false);
  assert.equal(
    useAppStore.getState().inventoryMovements.length,
    2,
    "detail and status edits don't invent stock movements",
  );
  await useAppStore.getState().importInventory([{ ...product, currentStock: 9 }]);
  assert.equal(useAppStore.getState().products[0].isActive, true);
  assert.equal(useAppStore.getState().inventoryMovements[0].movementType, "adjustment");
  assert.equal(useAppStore.getState().inventoryMovements[0].quantityDelta, -2);
  assert.equal(useAppStore.getState().inventoryMovements[0].balanceAfter, 9);
  assert.equal(useAppStore.getState().inventoryMovements[0].dataOrigin, "demo");
  assert.deepEqual(useAppStore.getState().sales, [historicSale]);
  await useAppStore.getState().recordSale(product.id, input.movementDate, 0.125);
  assert.equal(useAppStore.getState().products[0].currentStock, 8.875);
  assert.equal(
    useAppStore.getState().inventoryMovements[0].saleId,
    useAppStore.getState().sales[1].id,
  );
});

test("product API edits send supported details and active status without rewriting stock or sales", async () => {
  const patch = {
    sku: "NEW-001",
    name: "Updated rice",
    category: "Food",
    unit: "bag",
    leadTimeDays: 4,
    safetyStock: 3.5,
    unitCost: 50.125,
    isActive: false,
  };
  const catalog = deferred();
  const catalogStarted = deferred();
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push(options.method);
    if (options.method === "GET") {
      assert.match(url, /\/products$/);
      catalogStarted.resolve();
      return catalog.promise;
    }
    assert.match(url, /products\/synthetic-product$/);
    assert.equal(options.method, "PATCH");
    assert.deepEqual(JSON.parse(options.body), patch);
    return envelope({
      ...product,
      ...patch,
      currentStock: "20",
      safetyStock: "3.5",
      unitCost: "50.125",
    });
  };
  const saving = useAppStore.getState().updateProduct(product.id, patch);
  await catalogStarted.promise;
  assert.deepEqual(
    useAppStore.getState().products[0],
    { ...product, ...patch },
    "the metadata acknowledgment updates details but cannot set its historical balance",
  );
  catalog.resolve(catalogEnvelope(10, [{ ...product, ...patch }]));
  await saving;
  assert.deepEqual(requests, ["PATCH", "GET"]);
  assert.deepEqual(useAppStore.getState().products[0], { ...product, ...patch });
  assert.equal(useAppStore.getState().sales.length, 0);
  assert.equal(useAppStore.getState().inventoryMovements.length, 0);
});

test("a held metadata acknowledgment cannot undo an intervening delivery or fresher product details", async () => {
  useAppStore.setState({ products: [{ ...product, currentStock: 20 }] });
  const acknowledgment = deferred();
  const catalog = deferred();
  const catalogStarted = deferred();
  const requests = [];
  globalThis.fetch = async (_url, options) => {
    requests.push(options.method);
    if (options.method === "PATCH") return acknowledgment.promise;
    assert.equal(options.method, "GET");
    catalogStarted.resolve();
    return catalog.promise;
  };
  const saving = useAppStore.getState().updateProduct(product.id, { name: "Earlier edited name" });
  const deliveredProduct = { ...product, name: "Newer catalog name", currentStock: 30 };
  useAppStore.setState({ products: [deliveredProduct] });
  const observed = [];
  const unsubscribe = useAppStore.subscribe((state) => observed.push(state.products[0]));
  try {
    acknowledgment.resolve(
      envelope({ ...product, name: "Earlier edited name", currentStock: "20" }),
    );
    await catalogStarted.promise;
    assert.equal(useAppStore.getState().products[0], deliveredProduct);
    catalog.resolve(catalogEnvelope(30, [deliveredProduct]));
    await saving;
  } finally {
    unsubscribe();
  }
  assert.deepEqual(requests, ["PATCH", "GET"]);
  assert.equal(useAppStore.getState().products[0].currentStock, 30);
  assert.equal(useAppStore.getState().products[0].name, "Newer catalog name");
  assert.ok(observed.every((row) => row.currentStock === 30 && row.name === "Newer catalog name"));
});

test("a late metadata acknowledgment cannot resurrect a product removed from the current catalog", async () => {
  const acknowledgment = deferred();
  const catalog = deferred();
  const catalogStarted = deferred();
  const retained = { ...product, id: "retained-product", sku: "RETAINED-1", currentStock: 30 };
  globalThis.fetch = async (_url, options) => {
    if (options.method === "PATCH") return acknowledgment.promise;
    assert.equal(options.method, "GET");
    catalogStarted.resolve();
    return catalog.promise;
  };
  const saving = useAppStore.getState().updateProduct(product.id, { name: "Earlier edited name" });
  useAppStore.setState({ products: [retained] });
  acknowledgment.resolve(envelope({ ...product, name: "Earlier edited name", currentStock: "20" }));
  await catalogStarted.promise;
  assert.deepEqual(useAppStore.getState().products, [retained]);
  catalog.resolve(catalogEnvelope(30, [retained]));
  await saving;
  assert.deepEqual(useAppStore.getState().products, [retained]);
});

test("a committed metadata edit stays successful when catalog refresh fails and preserves newer stock", async () => {
  const acknowledgment = deferred();
  const requests = [];
  globalThis.fetch = async (_url, options) => {
    requests.push(options.method);
    if (options.method === "PATCH") return acknowledgment.promise;
    throw new TypeError("Synthetic current catalog unavailable");
  };
  const saving = useAppStore.getState().updateProduct(product.id, { name: "Earlier edited name" });
  const current = { ...product, currentStock: 30, name: "Newer catalog name" };
  useAppStore.setState({ products: [current] });
  acknowledgment.resolve(envelope({ ...product, name: "Earlier edited name", currentStock: "20" }));
  await saving;
  assert.deepEqual(requests, ["PATCH", "GET"]);
  assert.equal(useAppStore.getState().products[0], current);
  assert.equal(useAppStore.getState().movementsStatus, "error");
  assert.equal(
    useAppStore.getState().movementsError,
    "Product saved. Refresh stock movements to load the latest catalog.",
  );
});

test("late metadata acknowledgments cannot update a replacement session or request its catalog", async () => {
  for (const nextSession of [
    { ...session, businessId: "other-business", userId: "other-owner" },
    { ...session },
    null,
  ]) {
    useAppStore.setState({ session: { ...session }, products: [{ ...product }] });
    const acknowledgment = deferred();
    let requests = 0;
    globalThis.fetch = async (_url, options) => {
      requests++;
      assert.equal(options.method, "PATCH");
      return acknowledgment.promise;
    };
    const saving = useAppStore
      .getState()
      .updateProduct(product.id, { name: "Earlier edited name" });
    const products = nextSession
      ? [{ ...product, name: "New session product", currentStock: 30 }]
      : [];
    useAppStore.setState({ session: nextSession, products });
    const before = useAppStore.getState();
    acknowledgment.resolve(
      envelope({ ...product, name: "Earlier edited name", currentStock: "20" }),
    );
    await saving;
    assert.equal(requests, 1);
    assert.equal(useAppStore.getState(), before);
  }
});

test("a metadata edit's late catalog read cannot replace a fresh same-account session's stock", async () => {
  const catalog = deferred();
  const catalogStarted = deferred();
  globalThis.fetch = async (_url, options) => {
    if (options.method === "PATCH")
      return envelope({ ...product, name: "Edited name", currentStock: "20" });
    catalogStarted.resolve();
    return catalog.promise;
  };
  const saving = useAppStore.getState().updateProduct(product.id, { name: "Edited name" });
  await catalogStarted.promise;
  const products = [{ ...product, name: "New session product", currentStock: 30 }];
  useAppStore.setState({ session: { ...session }, products });
  const before = useAppStore.getState();
  catalog.resolve(catalogEnvelope(20, [{ ...product, name: "Edited name" }]));
  await saving;
  assert.equal(useAppStore.getState(), before);
  assert.equal(useAppStore.getState().products, products);
});

test("permanent product deletion waits for authenticated DELETE, preserves other records and clears forecasts", async () => {
  const removed = { ...product, id: "draft / café", currentStock: 0 };
  const products = [removed, { ...product }];
  const sales = [{ id: "retained-sale", productId: product.id, date: input.movementDate, qty: 1 }];
  const inventoryMovements = [{ ...movement, quantityDelta: 1.25, balanceAfter: 11.25 }];
  useAppStore.setState({ products, sales, inventoryMovements });
  const cachedForecast = { id: "synthetic-cached-forecast" };
  putPipeline(products, sales, useAppStore.getState().settings, cachedForecast);
  let finish;
  const requests = [];
  globalThis.fetch = (url, options) => {
    requests.push({ url, options });
    return new Promise((resolve) => {
      finish = resolve;
    });
  };
  const deletion = useAppStore.getState().deleteProduct(removed.id);
  assert.equal(
    useAppStore.getState().products,
    products,
    "pending deletion keeps the catalog intact",
  );
  assert.equal(peekStalePipeline(), cachedForecast);
  finish(envelope({ deletedRows: 1 }));
  assert.deepEqual(await deletion, { deletedRows: 1 });
  assert.equal(requests.length, 1, "a committed deletion does not require another read");
  assert.equal(
    requests[0].url,
    `/api/v1/businesses/${session.businessId}/products/${encodeURIComponent(removed.id)}`,
  );
  assert.equal(requests[0].options.method, "DELETE");
  assert.equal(requests[0].options.credentials, "include");
  assert.equal(requests[0].options.headers["x-csrf-token"], "synthetic-csrf");
  assert.equal(requests[0].options.body, undefined);
  assert.deepEqual(useAppStore.getState().products, [product]);
  assert.equal(useAppStore.getState().sales, sales);
  assert.equal(useAppStore.getState().inventoryMovements, inventoryMovements);
  assert.equal(peekStalePipeline(), null);
});

test("a rejected product deletion preserves the catalog, histories and cached forecast", async () => {
  const state = useAppStore.getState();
  const cachedForecast = { id: "synthetic-retained-forecast" };
  putPipeline(state.products, state.sales, state.settings, cachedForecast);
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ detail: "This product has stock or saved history." }), {
      status: 409,
    });
  await assert.rejects(state.deleteProduct(product.id), /stock or saved history/);
  assert.equal(useAppStore.getState().products, state.products);
  assert.equal(useAppStore.getState().sales, state.sales);
  assert.equal(useAppStore.getState().inventoryMovements, state.inventoryMovements);
  assert.equal(peekStalePipeline(), cachedForecast);
  invalidatePipelineCache();
});

test("an anonymous session cannot send a product deletion request", async () => {
  useAppStore.setState({ session: null });
  const state = useAppStore.getState();
  let requests = 0;
  globalThis.fetch = async () => {
    requests++;
    return envelope({ deletedRows: 1 });
  };
  await assert.rejects(state.deleteProduct(product.id), /session has expired/);
  assert.equal(requests, 0);
  assert.equal(useAppStore.getState().products, state.products);
});

test("demo product deletion removes an unused inactive product while retaining all unrelated history", async () => {
  const removed = { ...product, id: "unused-product", currentStock: 0, isActive: false };
  const products = [removed, product];
  const sales = [{ id: "retained-sale", productId: product.id, date: input.movementDate, qty: 1 }];
  const inventoryMovements = [{ ...movement, quantityDelta: 1.25, balanceAfter: 11.25 }];
  useAppStore.setState({
    dataMode: "browser-demo",
    session: null,
    products,
    sales,
    inventoryMovements,
  });
  putPipeline(products, sales, useAppStore.getState().settings, { id: "synthetic-demo-forecast" });
  assert.deepEqual(await useAppStore.getState().deleteProduct(removed.id), { deletedRows: 1 });
  assert.deepEqual(useAppStore.getState().products, [product]);
  assert.equal(useAppStore.getState().sales, sales);
  assert.equal(useAppStore.getState().inventoryMovements, inventoryMovements);
  assert.equal(peekStalePipeline(), null);
  const remaining = useAppStore.getState().products;
  assert.deepEqual(await useAppStore.getState().deleteProduct(removed.id), { deletedRows: 0 });
  assert.equal(useAppStore.getState().products, remaining);
});

test("demo product deletion rejects stock, sales and movement history without removing any records", async () => {
  const sale = { id: "saved-sale", productId: product.id, date: input.movementDate, qty: 1 };
  const audit = { ...movement, quantityDelta: 1.25, balanceAfter: 0 };
  for (const [reason, stock, sales, inventoryMovements] of [
    ["remaining stock", 0.125, [], []],
    ["recorded sales", 0, [{ ...sale, source: "manual" }], []],
    ["imported sales", 0, [{ ...sale, source: "csv_import" }], []],
    ["stock movements", 0, [], [audit]],
  ]) {
    const products = [{ ...product, currentStock: stock }];
    useAppStore.setState({
      dataMode: "browser-demo",
      session: null,
      products,
      sales,
      inventoryMovements,
    });
    const cachedForecast = { id: `synthetic-${reason}` };
    putPipeline(products, sales, useAppStore.getState().settings, cachedForecast);
    await assert.rejects(
      useAppStore.getState().deleteProduct(product.id),
      /stock or saved history/,
    );
    assert.equal(useAppStore.getState().products, products, reason);
    assert.equal(useAppStore.getState().sales, sales, reason);
    assert.equal(useAppStore.getState().inventoryMovements, inventoryMovements, reason);
    assert.equal(peekStalePipeline(), cachedForecast, reason);
  }
  invalidatePipelineCache();
});

test("late committed product deletions cannot change another session or a fresh same-account session", async () => {
  for (const newSession of [
    { ...session, businessId: "other-business", userId: "other-owner" },
    { ...session },
  ]) {
    useAppStore.setState({ session, products: [{ ...product, currentStock: 0 }] });
    let finish;
    globalThis.fetch = () =>
      new Promise((resolve) => {
        finish = resolve;
      });
    const deletion = useAppStore.getState().deleteProduct(product.id);
    const products = [{ ...product, name: "New session product", currentStock: 20 }];
    const sales = [
      { id: "new-session-sale", productId: product.id, date: input.movementDate, qty: 2 },
    ];
    const inventoryMovements = [{ ...movement, id: "new-session-audit" }];
    useAppStore.setState({ session: newSession, products, sales, inventoryMovements });
    const cachedForecast = { id: "synthetic-new-session-forecast" };
    putPipeline(products, sales, useAppStore.getState().settings, cachedForecast);
    finish(envelope({ deletedRows: 1 }));
    assert.deepEqual(await deletion, { deletedRows: 1 });
    assert.equal(useAppStore.getState().session, newSession);
    assert.equal(useAppStore.getState().products, products);
    assert.equal(useAppStore.getState().sales, sales);
    assert.equal(useAppStore.getState().inventoryMovements, inventoryMovements);
    assert.equal(peekStalePipeline(), cachedForecast);
  }
  invalidatePipelineCache();
});

test("a catalog refresh started before product deletion cannot restore the deleted product", async () => {
  const removed = { ...product, currentStock: 0 };
  const retained = { ...product, id: "retained-product", sku: "RETAINED-001" };
  useAppStore.setState({ products: [removed, retained] });
  const apiProduct = (row) => ({
    ...row,
    currentStock: String(row.currentStock),
    safetyStock: String(row.safetyStock),
    unitCost: String(row.unitCost),
  });
  const pending = [];
  let reads = 0;
  globalThis.fetch = async (url, options) => {
    if (options.method === "DELETE") return envelope({ deletedRows: 1 });
    reads++;
    if (reads <= 2)
      return new Promise((resolve) => {
        pending.push(() =>
          resolve(envelope(url.endsWith("/products") ? [removed, retained].map(apiProduct) : [])),
        );
      });
    return envelope(url.endsWith("/products") ? [apiProduct(retained)] : []);
  };
  const refresh = useAppStore.getState().refreshInventoryMovements();
  assert.equal(pending.length, 2);
  await useAppStore.getState().deleteProduct(removed.id);
  assert.deepEqual(useAppStore.getState().products, [retained]);
  pending.forEach((resolve) => resolve());
  await refresh;
  assert.equal(reads, 4, "the stale catalog snapshot is fetched again after deletion commits");
  assert.deepEqual(useAppStore.getState().products, [retained]);
  assert.equal(useAppStore.getState().movementsStatus, "ready");
});

test("owner controls render while staff retains permitted stock actions and audit visibility", () => {
  for (const role of ["owner", "staff"]) {
    setTestState({
      ...useAppStore.getState(),
      session: { ...session, role },
      movementsStatus: "ready",
      inventoryMovements: [{ ...movement, quantityDelta: 1.25, balanceAfter: 11.25 }],
    });
    const productsMarkup = renderToStaticMarkup(createElement(ProductsPanel));
    const movementsMarkup = renderToStaticMarkup(createElement(StockMovementsPanel));
    assert.match(productsMarkup, /Record delivery/);
    assert.match(movementsMarkup, /Record return/);
    assert.match(movementsMarkup, /Unopened item/);
    assert.match(movementsMarkup, /Test\/demo records/);
    assert.match(movementsMarkup, /synthetic-user/);
    if (role === "owner") {
      for (const action of [
        "Add product",
        "Import inventory",
        "Edit details",
        "Correct stock count",
        "Deactivate",
        "Delete",
      ]) {
        assert.ok(productsMarkup.includes(action), `owner sees ${action}`);
      }
      assert.match(movementsMarkup, /Write off stock/);
    } else {
      assert.doesNotMatch(
        productsMarkup,
        /Add product|Import inventory|Edit details|Correct stock count|>Deactivate<|>Delete</,
      );
      assert.doesNotMatch(movementsMarkup, /Write off stock/);
    }
  }
  const staff = getPermissions("api", { ...session, role: "staff" });
  assert.equal(staff.canReviewDataQuality, true);
  assert.equal(staff.canRefreshForecast, false);
  assert.equal(staff.canManageMembers, false);
  assert.equal(getPermissions("browser-demo", null).canManageProducts, true);
  assert.equal(getPermissions("api", null).canRecordReturns, false);
});
