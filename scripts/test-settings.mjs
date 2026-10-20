import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { fromApiSettings, toApiSettings } from "../src/lib/settings.ts";

const defaults = {
  storeName: "Demo",
  storeLocation: "Placeholder",
  maWindow: 7,
  forecastHorizon: 14,
  holdoutDays: 28,
  coverDays: 7,
  minWeeks: 8,
  minimumNonzeroDays: 100,
  timezone: "Asia/Manila",
  topNProducts: 8,
  cvFolds: 3,
  useFallbackIfThin: true,
  dataScenario: "partner",
};
const saved = {
  businessId: "business-test",
  movingAverageWindow: 14,
  forecastHorizonDays: 21,
  targetCoverDays: 10,
  minimumHistoryWeeks: 12,
  minimumNonzeroDays: 150,
  topNProducts: 12,
  cvFolds: 4,
  timezone: "America/New_York",
};
const business = { name: "Synthetic Test Store", location: "Synthetic City" };

test("backend model settings survive an unchanged frontend save", () => {
  const settings = fromApiSettings(saved, business, defaults);
  const { businessName, businessLocation, ...payload } = toApiSettings(settings);
  const { businessId: _businessId, ...expected } = saved;
  assert.deepEqual(payload, expected);
  assert.equal(businessName, business.name);
  assert.equal(businessLocation, business.location);
  assert.equal(settings.holdoutDays, defaults.holdoutDays);
  assert.equal(settings.timezone, "America/New_York");
  assert.equal(settings.minimumNonzeroDays, 150);
});

test("editing a visible setting preserves thresholds, timezone, and CV count", () => {
  const settings = fromApiSettings(saved, business, defaults);
  const payload = toApiSettings({ ...settings, forecastHorizon: 30, storeName: "Renamed Store" });
  assert.equal(payload.forecastHorizonDays, 30);
  assert.equal(payload.businessName, "Renamed Store");
  assert.equal(payload.minimumNonzeroDays, 150);
  assert.equal(payload.minimumHistoryWeeks, 12);
  assert.equal(payload.timezone, "America/New_York");
  assert.equal(payload.cvFolds, 4);
  assert.equal(saved.forecastHorizonDays, 21);
});

test("a saved API response replaces old frontend values without replacing demo controls", () => {
  const old = fromApiSettings(saved, business, defaults);
  const refreshed = fromApiSettings(
    { ...saved, minimumNonzeroDays: 120, timezone: "Asia/Singapore", cvFolds: 2 },
    { ...business, location: null },
    old,
  );
  assert.equal(refreshed.minimumNonzeroDays, 120);
  assert.equal(refreshed.timezone, "Asia/Singapore");
  assert.equal(refreshed.cvFolds, 2);
  assert.equal(refreshed.storeLocation, "");
  assert.equal(refreshed.useFallbackIfThin, old.useFallbackIfThin);
});

test("canonical settings profile and version replace older separately loaded profile fields", () => {
  const current = fromApiSettings(
    {
      ...saved,
      version: "settings-version-2",
      businessName: "Canonical store",
      businessLocation: null,
      dataOrigin: "demo",
    },
    business,
    { ...defaults, apiVersion: "settings-version-1" },
  );
  assert.equal(current.storeName, "Canonical store");
  assert.equal(current.storeLocation, "");
  assert.equal(current.apiVersion, "settings-version-2");
  assert.equal(current.dataScenario, defaults.dataScenario);
  const payload = toApiSettings(current);
  assert.equal(payload.expectedVersion, "settings-version-2");
  assert.equal(payload.businessName, "Canonical store");
  for (const name of ["version", "apiVersion", "businessId", "dataOrigin"])
    assert.equal(Object.hasOwn(payload, name), false, `do not send read-only ${name}`);
});

test("legacy settings keep profile fallback and discard an earlier response's version", () => {
  const current = fromApiSettings(saved, business, { ...defaults, apiVersion: "stale-version" });
  assert.equal(current.apiVersion, undefined);
  assert.equal(current.storeName, business.name);
  assert.equal(current.storeLocation, business.location);
  assert.equal(Object.hasOwn(toApiSettings(current), "expectedVersion"), false);
  assert.equal(
    Object.hasOwn(toApiSettings({ ...current, apiVersion: "" }), "expectedVersion"),
    false,
  );
});

const panelSource = await readFile(new URL("../src/routes/inventory.tsx", import.meta.url), "utf8");
const panelModule = ts.transpileModule(`${panelSource}\nexport { SettingsPanel };`, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX,
  },
  fileName: "inventory.tsx",
}).outputText;

// Exercise the actual settings panel's state and save handlers without a browser dependency.
function mountSettings(onSave) {
  const state = { settings: { ...defaults, apiVersion: "version-1" }, sales: [], dataMode: "api" };
  const slots = [];
  const requests = [];
  const notices = [];
  let cursor = 0;
  let tree;
  const hooks = {
    useState(initial) {
      const index = cursor++;
      if (!slots[index])
        slots[index] = { value: typeof initial === "function" ? initial() : initial };
      return [
        slots[index].value,
        (value) => {
          slots[index].value = typeof value === "function" ? value(slots[index].value) : value;
        },
      ];
    },
    useRef(initial) {
      const index = cursor++;
      slots[index] ??= { current: initial };
      return slots[index];
    },
    useMemo: (calculate) => calculate(),
  };
  const jsx = (type, props) => {
    if (props?.ref && type === "Input") {
      props.ref.current = {
        reportValidity: () =>
          String(props.value).trim() !== "" &&
          Number.isInteger(Number(props.value)) &&
          Number(props.value) >= 0,
      };
    }
    return { type, props: props ?? {} };
  };
  const exports = {};
  vm.runInNewContext(
    panelModule,
    {
      exports,
      Error,
      require(name) {
        if (name === "react") return hooks;
        if (name === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment: "fragment" };
        if (name === "@tanstack/react-router") return { createFileRoute: () => () => ({}) };
        if (name === "@/lib/store")
          return {
            useAppStore: (selector) =>
              selector({
                ...state,
                updateSettings: async (patch) => {
                  requests.push(structuredClone(patch));
                  if (onSave) await onSave(patch, state);
                  else state.settings = { ...state.settings, ...patch };
                },
                resetDemo: () => {},
              }),
          };
        if (name === "@/lib/permissions")
          return { usePermissions: () => ({ canManageSettings: true }) };
        if (name === "sonner")
          return {
            toast: {
              success: (message) => notices.push({ kind: "success", message }),
              error: (message) => notices.push({ kind: "error", message }),
            },
          };
        if (name === "@/lib/dates") return {};
        if (name === "@/lib/csv-preparation") return { CSV_API_ROW_LIMITS: {} };
        if (name.startsWith("@/components/"))
          return new Proxy({}, { get: (_target, key) => String(key) });
        throw new Error(`Unexpected settings-panel import: ${name}`);
      },
    },
    { filename: "inventory.tsx" },
  );
  const harness = {
    state,
    requests,
    notices,
    render() {
      cursor = 0;
      tree = exports.SettingsPanel();
    },
    nodes() {
      const found = [];
      const visit = (node) => {
        if (Array.isArray(node)) return node.forEach(visit);
        if (!node || typeof node !== "object") return;
        found.push(node);
        visit(node.props.children);
      };
      visit(tree);
      return found;
    },
    field(label) {
      const group = this.nodes().find(
        (node) =>
          node.type === "div" &&
          Array.isArray(node.props.children) &&
          node.props.children.some(
            (child) => child?.type === "Label" && child.props.children === label,
          ),
      );
      const field = group?.props.children.find((child) =>
        ["Input", "Select"].includes(child?.type),
      );
      assert.ok(field, `settings field exists: ${label}`);
      return field;
    },
    fill(label, value) {
      this.field(label).props.onChange({ target: { value } });
      this.render();
    },
    canonical(patch) {
      state.settings = { ...state.settings, ...patch };
      this.render();
    },
    save() {
      const button = this.nodes().find((node) => node.type === "Button" && node.props.onClick);
      assert.ok(button);
      return button.props.onClick();
    },
  };
  harness.render();
  return harness;
}

test("an untouched panel follows refreshed settings and saves only actual field edits", async () => {
  const h = mountSettings();
  h.canonical({ maWindow: 14, coverDays: 10, apiVersion: "version-2" });
  assert.equal(h.field("Moving Average window (days)").props.value, "14");
  assert.equal(h.field("Cover days after delivery").props.value, "10");
  await h.save();
  assert.equal(h.requests.length, 0, "an unchanged save cannot restore the older settings");
  h.fill("Store name", "Edited store");
  await h.save();
  h.render();
  assert.deepEqual(h.requests, [{ storeName: "Edited store" }]);
  assert.equal(h.state.settings.maWindow, 14);
  assert.equal(h.state.settings.coverDays, 10);
});

test("invalid cover text and explicit edits survive canonical refresh until the input is valid", async () => {
  const h = mountSettings();
  h.fill("Store name", "Edited store");
  h.fill("Cover days after delivery", "");
  h.canonical({ maWindow: 14, coverDays: 10, apiVersion: "version-2" });
  assert.equal(h.field("Cover days after delivery").props.value, "");
  assert.equal(h.field("Store name").props.value, "Edited store");
  await h.save();
  assert.equal(h.requests.length, 0);
  h.fill("Cover days after delivery", "12");
  await h.save();
  h.render();
  assert.deepEqual(h.requests, [{ storeName: "Edited store", coverDays: 12 }]);
  assert.equal(h.field("Cover days after delivery").props.value, "12");
  assert.equal(h.state.settings.maWindow, 14);
});

test("a settings conflict preserves edits over the refreshed canonical values for deliberate retry", async () => {
  let attempts = 0;
  const h = mountSettings(async (patch, state) => {
    if (++attempts === 1) {
      state.settings = {
        ...state.settings,
        storeName: "Remote store",
        maWindow: 14,
        apiVersion: "version-2",
      };
      throw new Error("Settings changed in another session. Review them and save again.");
    }
    state.settings = { ...state.settings, ...patch, apiVersion: "version-3" };
  });
  h.fill("Moving Average window (days)", "30");
  h.fill("Cover days after delivery", "12");
  await h.save();
  h.render();
  assert.equal(h.field("Store name").props.value, "Remote store");
  assert.equal(h.field("Moving Average window (days)").props.value, "30");
  assert.equal(h.field("Cover days after delivery").props.value, "12");
  assert.equal(h.notices.at(-1).kind, "error");
  assert.equal(h.requests.length, 1, "do not retry a rejected version automatically");
  await h.save();
  h.render();
  assert.deepEqual(h.requests, [
    { maWindow: 30, coverDays: 12 },
    { maWindow: 30, coverDays: 12 },
  ]);
  h.canonical({ maWindow: 28, coverDays: 9, apiVersion: "version-4" });
  assert.equal(h.field("Moving Average window (days)").props.value, "28");
  assert.equal(h.field("Cover days after delivery").props.value, "9");
});

test("pending saves reject duplicate handlers and clear only the values that successfully submitted", async () => {
  let finish;
  const pending = new Promise((resolve) => {
    finish = resolve;
  });
  const h = mountSettings(() => pending);
  h.fill("Moving Average window (days)", "30");
  const save = h.save();
  await h.save();
  h.render();
  assert.equal(h.requests.length, 1);
  assert.equal(h.field("Moving Average window (days)").props.disabled, true);
  // A late handler must not be erased by an earlier successful submission.
  h.fill("Moving Average window (days)", "28");
  h.canonical({ maWindow: 30, storeName: "Fresh profile", apiVersion: "version-2" });
  finish();
  await save;
  h.render();
  assert.equal(h.field("Moving Average window (days)").props.value, "28");
  assert.equal(h.field("Store name").props.value, "Fresh profile");
  assert.equal(h.field("Moving Average window (days)").props.disabled, false);
});
