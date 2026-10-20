import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const server = await createServer({
  root: fileURLToPath(new URL("../", import.meta.url)),
  configFile: false,
  logLevel: "silent",
  server: { middlewareMode: true, watch: null },
  resolve: { alias: { "@": fileURLToPath(new URL("../src", import.meta.url)) } },
});
const { applyApiSharedState, useAppStore } = await server.ssrLoadModule("/src/lib/store.ts");
const { api } = await server.ssrLoadModule("/src/lib/api.ts");
const { defaultSettings } = await server.ssrLoadModule("/src/lib/data/seed.ts");
const { fromApiSettings } = await server.ssrLoadModule("/src/lib/settings.ts");
const originalFetch = globalThis.fetch;
const originalDocument = globalThis.document;

after(async () => {
  globalThis.fetch = originalFetch;
  if (originalDocument === undefined) delete globalThis.document;
  else globalThis.document = originalDocument;
  await server.close();
});

const owner = {
  businessId: "synthetic-business",
  userId: "synthetic-owner",
  displayName: "Synthetic owner",
  email: "owner@example.test",
  role: "owner",
};
const product = {
  id: "synthetic-product",
  sku: "SHARED-1",
  name: "Synthetic product",
  category: "Test",
  unit: "piece",
  currentStock: 20,
  leadTimeDays: 2,
  safetyStock: 0,
  unitCost: 1,
  isActive: true,
};

function savedSettings(patch = {}) {
  return {
    businessId: owner.businessId,
    version: "version-1",
    businessName: "Synthetic store",
    businessLocation: "Synthetic location",
    dataOrigin: "demo",
    movingAverageWindow: 7,
    forecastHorizonDays: 30,
    targetCoverDays: 7,
    minimumHistoryWeeks: 8,
    minimumNonzeroDays: 100,
    topNProducts: 10,
    cvFolds: 3,
    timezone: "Asia/Manila",
    ...patch,
  };
}

function envelope(data) {
  return new Response(JSON.stringify({ data }), {
    headers: { "content-type": "application/json" },
  });
}

function conflict() {
  return new Response(
    JSON.stringify({ error: { code: "settings_conflict", message: "Synthetic stale version" } }),
    { status: 409, headers: { "content-type": "application/json" } },
  );
}

function deferred() {
  let resolve;
  const promise = new Promise((finish) => {
    resolve = finish;
  });
  return { promise, resolve };
}

function publishSettings(saved) {
  const expected = useAppStore.getState();
  assert.equal(
    applyApiSharedState({ products: expected.products, settings: saved }, expected),
    true,
  );
}

function wireProduct(value) {
  return {
    ...value,
    currentStock: String(value.currentStock),
    safetyStock: String(value.safetyStock),
    unitCost: String(value.unitCost),
  };
}

beforeEach(() => {
  globalThis.document = { cookie: "stockcast_csrf=synthetic-csrf" };
  globalThis.fetch = async () => {
    throw new Error("Unexpected network request");
  };
  useAppStore.setState({
    dataMode: "api",
    dataOrigin: "demo",
    session: { ...owner },
    products: [{ ...product }],
    sales: [],
    inventoryMovements: [],
    settings: fromApiSettings(
      savedSettings(),
      { name: "Unused fallback", location: null },
      defaultSettings,
    ),
  });
});

test("shared dashboard stock, inactive catalog, settings and profile publish atomically", () => {
  const expected = useAppStore.getState();
  const products = [
    { ...product, currentStock: 15 },
    { ...product, id: "inactive-product", sku: "SHARED-2", currentStock: 4, isActive: false },
  ];
  const saved = savedSettings({
    version: "version-2",
    movingAverageWindow: 14,
    businessName: "Updated synthetic store",
    businessLocation: null,
    timezone: "Pacific/Honolulu",
    dataOrigin: "partner",
  });
  const observations = [];
  const unsubscribe = useAppStore.subscribe((state) => observations.push(state));
  try {
    assert.equal(applyApiSharedState({ products, settings: saved }, expected), true);
  } finally {
    unsubscribe();
  }
  assert.equal(observations.length, 1);
  const current = observations[0];
  assert.equal(current.products, products);
  assert.equal(current.products[0].currentStock, 15);
  assert.equal(current.products[1].isActive, false);
  assert.equal(current.settings.maWindow, 14);
  assert.equal(current.settings.storeName, saved.businessName);
  assert.equal(current.settings.storeLocation, "");
  assert.equal(current.settings.timezone, saved.timezone);
  assert.equal(current.settings.apiVersion, "version-2");
  assert.equal(current.dataOrigin, "partner");
});

test("equal shared snapshots preserve catalog/settings references and cause no store notification", () => {
  const previous = useAppStore.getState();
  let notifications = 0;
  const unsubscribe = useAppStore.subscribe(() => notifications++);
  try {
    assert.equal(
      applyApiSharedState(
        { products: previous.products.map((row) => ({ ...row })), settings: savedSettings() },
        previous,
      ),
      true,
    );
  } finally {
    unsubscribe();
  }
  assert.equal(useAppStore.getState().products, previous.products);
  assert.equal(useAppStore.getState().settings, previous.settings);
  assert.equal(notifications, 0);
});

test("shared reads cannot overwrite a catalog write, settings write, replacement session or signout", () => {
  const initial = useAppStore.getState();
  const inputs = {
    products: [{ ...product, currentStock: 1 }],
    settings: savedSettings({ movingAverageWindow: 30 }),
  };
  for (const change of [
    { products: [{ ...product, currentStock: 18 }] },
    { settings: { ...initial.settings, maWindow: 14 } },
    { session: { ...initial.session } },
    { session: null },
    { dataMode: "browser-demo" },
  ]) {
    useAppStore.setState({ ...initial, ...change });
    const current = useAppStore.getState();
    assert.equal(applyApiSharedState(inputs, initial), false);
    assert.equal(useAppStore.getState(), current, "stale reads must not publish any partial state");
  }
});

test("a name-only save merges fresh canonical MA settings and sends their matching version", async () => {
  publishSettings(savedSettings({ movingAverageWindow: 14, version: "version-14" }));
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, method: options.method, body: JSON.parse(options.body) });
    return envelope(
      savedSettings({
        movingAverageWindow: 14,
        businessName: "Name edited here",
        version: "version-15",
      }),
    );
  };
  await useAppStore
    .getState()
    .updateSettings({ storeName: "Name edited here", apiVersion: "stale-draft-version" });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].method, "PUT");
  assert.match(requests[0].url, /\/businesses\/synthetic-business\/settings$/);
  assert.equal(requests[0].body.businessName, "Name edited here");
  assert.equal(requests[0].body.movingAverageWindow, 14);
  assert.equal(requests[0].body.expectedVersion, "version-14");
  for (const key of ["version", "apiVersion", "businessId", "dataOrigin"]) {
    assert.equal(Object.hasOwn(requests[0].body, key), false);
  }
  assert.equal(useAppStore.getState().settings.maWindow, 14);
  assert.equal(useAppStore.getState().settings.apiVersion, "version-15");
  assert.equal(useAppStore.getState().settings.storeName, "Name edited here");
});

test("a settings conflict refreshes canonical values but rejects the save for explicit review", async () => {
  const requests = [];
  globalThis.fetch = async (_url, options) => {
    requests.push(options.method);
    if (options.method === "PUT") return conflict();
    assert.equal(options.method, "GET");
    return envelope(
      savedSettings({
        version: "remote-version",
        movingAverageWindow: 14,
        businessName: "Remote synthetic store",
        businessLocation: null,
        dataOrigin: "partner",
      }),
    );
  };
  await assert.rejects(
    useAppStore.getState().updateSettings({ storeName: "Unsaved local name" }),
    /Settings changed in another browser.*Your edits are kept.*save again/,
  );
  assert.deepEqual(requests, ["PUT", "GET"]);
  const current = useAppStore.getState();
  assert.equal(current.settings.maWindow, 14);
  assert.equal(current.settings.storeName, "Remote synthetic store");
  assert.equal(current.settings.storeLocation, "");
  assert.equal(current.settings.apiVersion, "remote-version");
  assert.equal(current.dataOrigin, "partner");
});

test("a failed conflict refresh retains known settings and tells the user to refresh before saving", async () => {
  const before = useAppStore.getState().settings;
  globalThis.fetch = async (_url, options) => {
    if (options.method === "PUT") return conflict();
    throw new TypeError("Synthetic settings read failure");
  };
  await assert.rejects(
    useAppStore.getState().updateSettings({ storeName: "Unsaved local name" }),
    /Your edits are kept.*could not be reloaded.*Refresh before saving again/,
  );
  assert.equal(useAppStore.getState().settings, before);
});

test("an old save acknowledgment rereads current settings after a newer shared update", async () => {
  const acknowledgment = deferred();
  const requests = [];
  globalThis.fetch = async (_url, options) => {
    requests.push(options.method);
    if (options.method === "PUT") return acknowledgment.promise;
    return envelope(
      savedSettings({
        movingAverageWindow: 28,
        version: "version-4",
        businessName: "Latest saved name",
      }),
    );
  };
  const saving = useAppStore.getState().updateSettings({ storeName: "Earlier local name" });
  publishSettings(
    savedSettings({
      movingAverageWindow: 14,
      version: "version-3",
      businessName: "Newer shared name",
    }),
  );
  acknowledgment.resolve(
    envelope(savedSettings({ version: "version-2", businessName: "Earlier local name" })),
  );
  await saving;
  assert.deepEqual(requests, ["PUT", "GET"]);
  const current = useAppStore.getState().settings;
  assert.equal(current.maWindow, 28);
  assert.equal(current.apiVersion, "version-4");
  assert.equal(current.storeName, "Latest saved name");
});

test("a settings refresh discards a read overtaken by a shared update and reads again", async () => {
  const firstRead = deferred();
  const readStarted = deferred();
  let reads = 0;
  globalThis.fetch = async (_url, options) => {
    if (options.method === "PUT") return conflict();
    reads++;
    if (reads === 1) {
      readStarted.resolve();
      return firstRead.promise;
    }
    return envelope(savedSettings({ movingAverageWindow: 28, version: "version-4" }));
  };
  const rejected = assert.rejects(
    useAppStore.getState().updateSettings({ storeName: "Local edit" }),
    /save again/,
  );
  await readStarted.promise;
  publishSettings(savedSettings({ movingAverageWindow: 14, version: "version-3" }));
  const publishedVersions = [];
  const unsubscribe = useAppStore.subscribe((state) =>
    publishedVersions.push(state.settings.apiVersion),
  );
  try {
    firstRead.resolve(envelope(savedSettings({ movingAverageWindow: 7, version: "version-2" })));
    await rejected;
  } finally {
    unsubscribe();
  }
  assert.equal(reads, 2);
  assert.deepEqual(publishedVersions, ["version-4"]);
  assert.equal(useAppStore.getState().settings.maWindow, 28);
});

test("a settings read finishing after signout cannot repopulate the anonymous store", async () => {
  const read = deferred();
  const readStarted = deferred();
  globalThis.fetch = async (url, options) => {
    if (url.endsWith("/auth/sign-out")) return envelope({ signedOut: true });
    if (options.method === "PUT") return conflict();
    readStarted.resolve();
    return read.promise;
  };
  const saving = useAppStore.getState().updateSettings({ storeName: "Local edit" });
  // Capture the rejection immediately; the original conflict must never become an unhandled promise.
  const settled = saving.then(
    () => null,
    (error) => error,
  );
  await readStarted.promise;
  await useAppStore.getState().signOut();
  const anonymous = useAppStore.getState();
  assert.equal(anonymous.session, null);
  read.resolve(
    envelope(
      savedSettings({ version: "late-private-version", businessName: "Prior account name" }),
    ),
  );
  await settled;
  assert.equal(useAppStore.getState().settings, anonymous.settings);
  assert.equal(useAppStore.getState().session, null);
  assert.equal(useAppStore.getState().settings.apiVersion, undefined);
  assert.deepEqual(useAppStore.getState().products, []);
});

test("embedded dashboard shared inputs retain inactive products and convert decimal stock without extra reads", async () => {
  const settings = savedSettings({ version: "embedded-version" });
  const inputs = await api.sharedForecastInputs(owner.businessId, {
    sharedState: {
      products: [wireProduct({ ...product, currentStock: 2.125, isActive: false })],
      settings,
    },
  });
  assert.deepEqual(inputs.products, [{ ...product, currentStock: 2.125, isActive: false }]);
  assert.equal(inputs.settings, settings);
});

test("legacy dashboard fallback loads current catalog/settings/profile without inventing a version", async () => {
  const {
    version: _version,
    businessName: _name,
    businessLocation: _location,
    dataOrigin: _origin,
    ...legacy
  } = savedSettings();
  const requests = [];
  globalThis.fetch = async (url) => {
    requests.push(url);
    if (url.endsWith("/products"))
      return envelope([wireProduct({ ...product, currentStock: 8.5, isActive: false })]);
    if (url.endsWith("/settings")) return envelope(legacy);
    assert.match(url, /\/businesses\/synthetic-business$/);
    return envelope({
      name: "Legacy current name",
      location: "Legacy location",
      dataOrigin: "partner",
    });
  };
  const inputs = await api.sharedForecastInputs(owner.businessId, {});
  assert.equal(requests.length, 3);
  assert.equal(inputs.products[0].currentStock, 8.5);
  assert.equal(inputs.products[0].isActive, false);
  assert.equal(inputs.settings.businessName, "Legacy current name");
  assert.equal(inputs.settings.businessLocation, "Legacy location");
  assert.equal(inputs.settings.dataOrigin, "partner");
  assert.equal(inputs.settings.version, undefined);
  assert.equal(applyApiSharedState(inputs, useAppStore.getState()), true);
  assert.equal(useAppStore.getState().settings.apiVersion, undefined);
});

test("fallback reads preserve explicit canonical profile fields over the older business response", async () => {
  globalThis.fetch = async (url) => {
    if (url.endsWith("/products")) return envelope([wireProduct(product)]);
    if (url.endsWith("/settings"))
      return envelope(
        savedSettings({
          businessName: "Canonical name",
          businessLocation: null,
          dataOrigin: "partner",
        }),
      );
    return envelope({ name: "Older name", location: "Older location", dataOrigin: "demo" });
  };
  const inputs = await api.sharedForecastInputs(owner.businessId, {});
  assert.equal(inputs.settings.businessName, "Canonical name");
  assert.equal(inputs.settings.businessLocation, null);
  assert.equal(inputs.settings.dataOrigin, "partner");
});
