import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";

// Real store/API adapter with synthetic HTTP responses; no browser or database is used.
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
  globalThis.document = { cookie: "stockcast_csrf=synthetic-token" };
  t.after(() => {
    globalThis.fetch = originalFetch;
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  });
  const { useAppStore } = await server.ssrLoadModule("/src/lib/store.ts");
  const { api } = await server.ssrLoadModule("/src/lib/api.ts");
  return { store: useAppStore, api };
}

const account = {
  businessId: "synthetic-store-a",
  userId: "synthetic-owner-a",
  email: "synthetic@example.test",
  displayName: "Synthetic owner",
  role: "owner",
};
const product = {
  id: "synthetic-product",
  sku: "SYN-1",
  name: "Synthetic product",
  category: "Synthetic",
  unit: "piece",
  currentStock: 9,
  safetyStock: 1,
  leadTimeDays: 2,
  unitCost: 2,
  isActive: true,
};
const settings = {
  businessId: account.businessId,
  movingAverageWindow: 7,
  forecastHorizonDays: 14,
  targetCoverDays: 14,
  minimumHistoryWeeks: 8,
  minimumNonzeroDays: 100,
  topNProducts: 10,
  cvFolds: 3,
  timezone: "Asia/Manila",
};

function response(data, status = 200) {
  return new Response(JSON.stringify({ data }), { status });
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((accept, decline) => {
    resolve = accept;
    reject = decline;
  });
  return { promise, resolve, reject };
}

function savedData(url, session = account) {
  const path = new URL(url, "http://localhost").pathname;
  if (path.startsWith("/api/v1/auth/")) return session;
  if (path.endsWith("/products"))
    return [{ ...product, currentStock: "9", safetyStock: "1", unitCost: "2" }];
  if (path.endsWith("/sales")) return [];
  if (path.endsWith("/settings")) return settings;
  return { name: "Synthetic store", location: "Synthetic location", dataOrigin: "partner" };
}

function populate(store) {
  store.setState({
    dataMode: "api",
    session: { ...account },
    apiStatus: "ready",
    products: [product],
    sales: [{ id: "synthetic-sale", productId: product.id, date: "2026-10-01", qty: 1 }],
    inventoryMovements: [{ id: "synthetic-movement" }],
    settings: {
      ...store.getState().settings,
      storeName: "Private store",
      storeLocation: "Private location",
    },
    dataOrigin: "partner",
    importRefreshWarning: "Synthetic import warning",
    movementsStatus: "error",
    movementsError: "Synthetic movement error",
  });
}

function assertAnonymous(store, status = "idle", error = null) {
  const state = store.getState();
  assert.equal(state.session, null);
  assert.deepEqual(state.products, []);
  assert.deepEqual(state.sales, []);
  assert.deepEqual(state.inventoryMovements, []);
  assert.equal(state.settings.storeName, "StockCast Store");
  assert.equal(state.settings.storeLocation, "");
  assert.equal(state.dataOrigin, "demo");
  assert.equal(state.importRefreshWarning, null);
  assert.equal(state.movementsStatus, "idle");
  assert.equal(state.movementsError, null);
  assert.equal(state.apiStatus, status);
  assert.equal(state.apiError, error);
}

function authenticate(store, operation) {
  if (operation === "signIn")
    return store.getState().signIn(undefined, account.email, "synthetic-password");
  if (operation === "signUp")
    return store.getState().signUp({
      email: account.email,
      password: "synthetic-password",
      displayName: account.displayName,
      businessName: "Synthetic store",
      dataOrigin: "demo",
    });
  return store.getState().completeGoogle({ businessName: "Synthetic store", dataOrigin: "demo" });
}

test("confirmed sign-out clears account records, business settings, provenance, and diagnostics", async (t) => {
  const { store } = await isolatedStore(t);
  populate(store);
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "/api/v1/auth/sign-out");
    assert.equal(options.method, "POST");
    assert.equal(options.credentials, "include");
    assert.equal(options.headers["x-csrf-token"], "synthetic-token");
    return response({ signedOut: true });
  };
  await store.getState().signOut();
  assertAnonymous(store);
});

test("expired or revoked sessions finish signing out instead of trapping a stale account onscreen", async (t) => {
  const { store } = await isolatedStore(t);
  populate(store);
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ detail: "Session expired" }), { status: 401 });
  await store.getState().signOut();
  assertAnonymous(store);
});

for (const kind of ["network", "permission"]) {
  test(`a ${kind} sign-out failure preserves the session and records for retry`, async (t) => {
    const { store } = await isolatedStore(t);
    populate(store);
    const before = store.getState();
    globalThis.fetch = async () => {
      if (kind === "network") throw new TypeError("Synthetic connection unavailable");
      return new Response(JSON.stringify({ detail: "Synthetic request refused" }), { status: 403 });
    };
    await assert.rejects(store.getState().signOut(), /Synthetic/);
    assert.equal(store.getState().session, before.session);
    assert.equal(store.getState().products, before.products);
    assert.equal(store.getState().settings, before.settings);
  });
}

for (const operation of ["connectApi", "signIn", "signUp", "completeGoogle"]) {
  test(`late ${operation} records cannot restore a session after sign-out`, async (t) => {
    const { store } = await isolatedStore(t);
    const gate = deferred();
    const started = deferred();
    globalThis.fetch = async (url) => {
      if (url.endsWith("/auth/sign-out")) return response({ signedOut: true });
      if (url.includes("/auth/")) return response(account);
      started.resolve();
      await gate.promise;
      return response(savedData(url));
    };
    const loading =
      operation === "signIn"
        ? store.getState().signIn(undefined, account.email, "synthetic-password")
        : operation === "signUp"
          ? store.getState().signUp({
              email: account.email,
              password: "synthetic-password",
              displayName: account.displayName,
              businessName: "Synthetic store",
              dataOrigin: "demo",
            })
          : operation === "completeGoogle"
            ? store
                .getState()
                .completeGoogle({ businessName: "Synthetic store", dataOrigin: "demo" })
            : store.getState().connectApi();
    await started.promise;
    await store.getState().signOut();
    gate.resolve();
    await loading;
    assertAnonymous(store);
  });
}

test("a late failed restoration cannot clear a newer signed-in account or add its error", async (t) => {
  const { store } = await isolatedStore(t);
  const previous = deferred();
  globalThis.fetch = async (url) =>
    url.endsWith("/auth/me") ? previous.promise : response(savedData(url));
  const restoring = store.getState().connectApi();
  await store.getState().signIn(undefined, account.email, "synthetic-password");
  const ready = store.getState();
  previous.reject(new TypeError("Synthetic old connection failure"));
  await restoring;
  assert.equal(store.getState().session, ready.session);
  assert.equal(store.getState().products, ready.products);
  assert.equal(store.getState().apiStatus, "ready");
  assert.equal(store.getState().apiError, null);
});

test("a late sign-out response cannot clear a newer signed-in account", async (t) => {
  const { store } = await isolatedStore(t);
  populate(store);
  const logout = deferred();
  globalThis.fetch = async (url) =>
    url.endsWith("/auth/sign-out") ? logout.promise : response(savedData(url));
  const signingOut = store.getState().signOut();
  await store.getState().signIn(undefined, account.email, "synthetic-password");
  const ready = store.getState();
  logout.resolve(response({ signedOut: true }));
  await signingOut;
  assert.equal(store.getState().session, ready.session);
  assert.equal(store.getState().products, ready.products);
  assert.equal(store.getState().apiStatus, "ready");
});

for (const operation of ["addProduct", "updateProduct", "updateSettings"]) {
  test(`a pending ${operation} response cannot replace a newer session's records`, async (t) => {
    const { store } = await isolatedStore(t);
    populate(store);
    const pending = deferred();
    globalThis.fetch = async (url) =>
      url.endsWith("/auth/sign-out") ? response({ signedOut: true }) : pending.promise;
    const writing =
      operation === "addProduct"
        ? store.getState().addProduct(product)
        : operation === "updateProduct"
          ? store.getState().updateProduct(product.id, { name: "Changed private product" })
          : store.getState().updateSettings({ storeName: "Changed private store" });
    await store.getState().signOut();
    const currentProducts = [{ ...product, name: "Latest product", currentStock: 20 }];
    const currentSettings = { ...store.getState().settings, storeName: "Latest store" };
    store.setState({
      session: { ...account },
      products: currentProducts,
      settings: currentSettings,
      movementsStatus: "ready",
    });
    pending.resolve(
      response(
        operation === "updateSettings"
          ? settings
          : {
              ...product,
              name: "Changed private product",
              currentStock: "9",
              safetyStock: "1",
              unitCost: "2",
            },
      ),
    );
    await writing;
    assert.equal(store.getState().products, currentProducts);
    assert.equal(store.getState().settings, currentSettings);
    assert.equal(store.getState().movementsStatus, "ready");
  });
}

test("an old inventory reload cannot replace records after signing into the same account again", async (t) => {
  const { store } = await isolatedStore(t);
  populate(store);
  const read = deferred();
  const started = deferred();
  globalThis.fetch = async (_url, options) => {
    if (options.method === "POST") return response({ created: 0, updated: 1 });
    started.resolve();
    return read.promise;
  };
  const importing = store.getState().importInventory([{ sku: product.sku, currentStock: 3 }]);
  await started.promise;
  const currentProducts = [{ ...product, currentStock: 20 }];
  store.setState({ session: { ...account }, products: currentProducts });
  read.resolve(response([{ ...product, currentStock: "3", safetyStock: "1", unitCost: "2" }]));
  await importing;
  assert.equal(store.getState().products, currentProducts);
});

test("recovery forwards an optional legacy Business ID only when supplied", async (t) => {
  const { api } = await isolatedStore(t);
  const requests = [];
  globalThis.fetch = async (_url, options) => {
    requests.push(JSON.parse(options.body));
    return response({ accepted: true });
  };
  await api.requestRecovery(account.email);
  await api.requestRecovery(account.email, account.businessId);
  assert.deepEqual(requests, [
    { email: account.email },
    { email: account.email, businessId: account.businessId },
  ]);
});

for (const [operation, committedMessage] of [
  ["signIn", "You signed in"],
  ["signUp", "Your account was created"],
  ["completeGoogle", "Your Google account setup was completed"],
]) {
  test(`confirmed ${operation} with failed store loading clears stale records and recovers without another auth POST`, async (t) => {
    const { store } = await isolatedStore(t);
    populate(store);
    let authPosts = 0;
    let failRecords = true;
    globalThis.fetch = async (url, options) => {
      if (options.method === "POST") authPosts += 1;
      if (url.endsWith("/products") && failRecords)
        throw new TypeError("Synthetic records unavailable");
      return response(savedData(url));
    };
    await authenticate(store, operation);
    const message = `${committedMessage}, but store records could not be loaded. Reload this page to try loading your store.`;
    assertAnonymous(store, "error", message);
    assert.equal(authPosts, 1);

    failRecords = false;
    await store.getState().connectApi();
    assert.deepEqual(store.getState().session, account);
    assert.equal(store.getState().apiStatus, "ready");
    assert.equal(store.getState().products[0].sku, product.sku);
    assert.equal(
      authPosts,
      1,
      "existing cookie restoration must not repeat committed account creation",
    );
  });

  test(`rejected ${operation} still rejects and preserves the server's authentication error`, async (t) => {
    const { store } = await isolatedStore(t);
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ detail: "Synthetic authentication rejected" }), {
        status: 400,
      });
    await assert.rejects(authenticate(store, operation), /Synthetic authentication rejected/);
    assert.equal(store.getState().apiError, "Synthetic authentication rejected");
    assert.equal(store.getState().session, null);
  });
}

test("a late committed-signup loading failure cannot clear a newer session or replace its status", async (t) => {
  const { store } = await isolatedStore(t);
  const previousRecords = deferred();
  const started = deferred();
  let previousRequest = true;
  globalThis.fetch = async (url) => {
    if (url.endsWith("/products") && previousRequest) {
      started.resolve();
      return previousRecords.promise;
    }
    return response(savedData(url));
  };
  const creating = authenticate(store, "signUp");
  await started.promise;
  previousRequest = false;
  await authenticate(store, "signIn");
  const current = store.getState();
  previousRecords.reject(new TypeError("Synthetic earlier records failure"));
  await creating;
  assert.equal(store.getState().session, current.session);
  assert.equal(store.getState().products, current.products);
  assert.equal(store.getState().settings, current.settings);
  assert.equal(store.getState().apiStatus, "ready");
  assert.equal(store.getState().apiError, null);
});
