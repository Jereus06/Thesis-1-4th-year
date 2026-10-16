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
beforeEach(() => {
  globalThis.document = { cookie: "stockcast_csrf=synthetic-csrf" };
  globalThis.fetch = async () => {
    throw new Error("Unexpected network request");
  };
  useAppStore.setState({
    dataMode: "api",
    session,
    products: [{ ...product }],
    sales: [],
    inventoryMovements: [],
    movementsStatus: "idle",
    movementsError: null,
  });
});

test("a return posts signed decimal quantities and audit notes, then applies the server balance", async () => {
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    return envelope({ ...movement, balanceAfter: "14.75" }, 201);
  };
  await useAppStore.getState().recordStockMovement(input);
  assert.equal(requests.length, 1, "a successful write needs no second read to be acknowledged");
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
  const state = useAppStore.getState();
  assert.equal(
    state.products[0].currentStock,
    14.75,
    "use the authoritative balance after concurrent stock changes",
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

test("staff can record returns and receipts while owner management calls are rejected before sending", async () => {
  useAppStore.setState({ session: { ...session, role: "staff" } });
  let requests = 0;
  globalThis.fetch = async (_url, options) => {
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
  assert.equal(reads, 4, "an obsolete snapshot is read again after the committed write");
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
  globalThis.fetch = async (url, options) => {
    assert.match(url, /products\/synthetic-product$/);
    assert.equal(options.method, "PATCH");
    assert.deepEqual(JSON.parse(options.body), patch);
    return envelope({
      ...product,
      ...patch,
      currentStock: "10",
      safetyStock: "3.5",
      unitCost: "50.125",
    });
  };
  await useAppStore.getState().updateProduct(product.id, patch);
  assert.deepEqual(useAppStore.getState().products[0], { ...product, ...patch });
  assert.equal(useAppStore.getState().sales.length, 0);
  assert.equal(useAppStore.getState().inventoryMovements.length, 0);
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
