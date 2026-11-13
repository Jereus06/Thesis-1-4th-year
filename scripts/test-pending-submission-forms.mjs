import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { randomUUID } from "node:crypto";
import ts from "typescript";
import { generateProductSku } from "../src/lib/product-sku.ts";

const product = {
  id: "synthetic-a",
  sku: "SYNTHETIC-A",
  name: "Synthetic A",
  category: "Test",
  unit: "piece",
  currentStock: 20,
  leadTimeDays: 2,
  safetyStock: 0,
  unitCost: 1,
  isActive: true,
};
const other = { ...product, id: "synthetic-b", sku: "SYNTHETIC-B", name: "Synthetic B" };
const owner = {
  businessId: "synthetic-business",
  userId: "synthetic-owner",
  role: "owner",
  email: "owner@example.test",
  displayName: "Synthetic owner",
};
const modules = new Map();

async function compiled(path, extra = "") {
  const key = path + extra;
  if (!modules.has(key)) {
    const source = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
    modules.set(
      key,
      ts.transpileModule(`${source}\n${extra}`, {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
          jsx: ts.JsxEmit.ReactJSX,
        },
        fileName: path,
      }).outputText,
    );
  }
  return modules.get(key);
}

// Run real form handlers with deterministic hooks. The browser suite separately
// exercises native input validation and component mounting through Radix dialogs.
async function mount(
  path,
  component,
  { extra = "", props = {}, products = [product, other], onRequest } = {},
) {
  const state = {
    products: products.map((value) => ({ ...value })),
    session: { ...owner },
    dataMode: "api",
    settings: { timezone: "Asia/Manila" },
    businessDay: "2026-10-20",
    movementsStatus: "ready",
    movementsError: null,
    inventoryMovements: [],
    importInventory: async () => {},
  };
  const forecast = { rows: [], result: { byProduct: {} }, schedule: undefined };
  const requests = [];
  const notices = [];
  let done = 0;
  for (const method of ["recordSale", "recordStockMovement", "receiveStock"]) {
    state[method] = async (...args) => {
      requests.push({ method, args: JSON.parse(JSON.stringify(args)) });
      if (onRequest) return onRequest(method, args, state);
      throw new Error("Synthetic response lost");
    };
  }
  const slots = [];
  let cursor = 0;
  let tree;
  const hooks = {
    useState(initial) {
      const index = cursor++;
      slots[index] ??= { value: typeof initial === "function" ? initial() : initial };
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
    useCallback: (callback) => callback,
    useId: () => "synthetic-form",
    useEffect: () => {},
    memo: (value) => value,
  };
  const useAppStore = (selector) => selector(state);
  useAppStore.getState = () => state;
  const jsx = (type, attributes) => ({ type, props: attributes ?? {} });
  const exports = {};
  vm.runInNewContext(
    await compiled(path, extra),
    {
      exports,
      Date,
      Error,
      crypto: { randomUUID },
      require(name) {
        if (name === "react") return hooks;
        if (name === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment: "fragment" };
        if (name === "@/lib/store") return { useAppStore };
        if (name === "@/lib/permissions")
          return {
            usePermissions: () => ({
              canRecordSales: Boolean(state.session),
              canReceiveStock: Boolean(state.session),
              canRecordReturns: Boolean(state.session),
              canWriteOffStock: state.session?.role === "owner",
              canManageProducts: state.session?.role === "owner",
              canImportRecords: state.session?.role === "owner",
              canRefreshForecast: state.session?.role === "owner",
            }),
          };
        if (name === "@/lib/dates") return { businessDateISO: () => state.businessDay };
        if (name === "@/lib/format") return { num: String, peso: String, quantity: String };
        if (name === "@/lib/product-sku") return { generateProductSku };
        if (name === "@/lib/use-product-photos")
          return {
            useProductPhotos: () => ({
              photos: {},
              error: undefined,
              save: async () => {},
              remove: async () => {},
            }),
          };
        if (name === "@/lib/api") return { api: { exportUrl: () => "synthetic-export" } };
        if (name === "@/lib/forecast-schedule")
          return { forecastRefreshAdvice: () => "refresh the forecast" };
        if (name === "@/components/forecast-context") return { useForecast: () => forecast };
        if (name === "@/lib/csv-preparation") return { CSV_API_ROW_LIMITS: {} };
        if (name === "@tanstack/react-router") return { createFileRoute: () => () => ({}) };
        if (name === "sonner")
          return {
            toast: {
              success: (message) => notices.push({ kind: "success", message }),
              error: (message) => notices.push({ kind: "error", message }),
            },
          };
        if (name === "lucide-react" || name.startsWith("@/components/"))
          return new Proxy({}, { get: (_target, key) => String(key) });
        throw new Error(`Unexpected form import: ${name}`);
      },
    },
    { filename: fileURLToPath(new URL(`../${path}`, import.meta.url)) },
  );
  const formProps = {
    saving: false,
    onSavingChange: (saving) => {
      formProps.saving = saving;
    },
    onDone: () => {
      done++;
    },
    ...props,
  };
  const harness = {
    state,
    forecast,
    requests,
    notices,
    props: formProps,
    get done() {
      return done;
    },
    render() {
      cursor = 0;
      tree = exports[component](formProps);
      return tree;
    },
    nodes() {
      const found = [];
      const visit = (node) => {
        if (Array.isArray(node)) return node.forEach(visit);
        if (!node || typeof node !== "object") return;
        found.push(node);
        visit(node.props?.children);
      };
      visit(tree);
      return found;
    },
    find(predicate) {
      const node = harness.nodes().find(predicate);
      assert.ok(node, "expected form element");
      return node;
    },
    input(id) {
      return harness.find((node) => node.props.id === id);
    },
    change(id, value) {
      const node = harness.input(id);
      if (node.type === "SaleProductPicker") node.props.onValueChange(value);
      else node.props.onChange({ target: { value } });
      harness.render();
    },
    async submit() {
      await harness.find((node) => node.type === "form").props.onSubmit({ preventDefault() {} });
      harness.render();
    },
    button() {
      return harness.find((node) => node.type === "Button" && node.props.type === "submit");
    },
  };
  harness.render();
  return harness;
}

test("the sale form delegates product search to its picker and only changes the sale on an explicit choice", async () => {
  const form = await mount("src/components/record-sale-dialog.tsx", "RecordSaleDialog");
  assert.equal(form.input("sale-product").type, "SaleProductPicker");
  assert.equal(form.input("sale-product").props.value, product.id);
  assert.equal(form.input("sale-product").props.selectedProduct.id, product.id);
  assert.equal(form.input("sale-product").props.products.length, 2);
  assert(!form.nodes().some((node) => node.props.id === "sale-product-search"));
  assert.equal(form.requests.length, 0);
  form.change("sale-product", other.id);
  assert.equal(form.input("sale-product").props.value, other.id);
  assert.equal(form.requests.length, 0);
  await form.submit();
  assert.equal(form.requests[0].args[0], other.id);
});

async function mountPicker(patch = {}) {
  const choices = [];
  const picker = await mount("src/components/sale-product-picker.tsx", "SaleProductPicker", {
    props: {
      products: [product, other],
      value: product.id,
      onValueChange: (id) => choices.push(id),
      ...patch,
    },
  });
  picker.choices = choices;
  picker.open = () => {
    picker.input("sale-product").props.onClick();
    picker.render();
  };
  picker.options = () => picker.nodes().filter((node) => node.props.role === "option");
  picker.key = (key, target) => {
    let prevented = false;
    picker
      .find((node) => typeof node.props.onKeyDown === "function")
      .props.onKeyDown({
        key,
        target,
        preventDefault() {
          prevented = true;
        },
        stopPropagation() {},
      });
    picker.render();
    return prevented;
  };
  return picker;
}

test("product picker searches inside its dropdown by name or SKU without silently choosing a result", async () => {
  const picker = await mountPicker();
  assert(!picker.nodes().some((node) => node.props.id === "sale-product-search"));
  picker.open();
  assert.equal(picker.input("sale-product-search").props["aria-label"], "Search products");
  picker.change("sale-product-search", " synthetic-b ");
  assert.deepEqual(
    picker.options().map((node) => node.props["data-product-id"]),
    [other.id],
  );
  assert.equal(picker.input("sale-product").props["data-product-id"], product.id);
  assert.deepEqual(picker.choices, []);
  picker.change("sale-product-search", "a");
  assert.deepEqual(
    picker.options().map((node) => node.props["data-product-id"]),
    [product.id],
  );
  picker.change("sale-product-search", "does not exist");
  assert.equal(picker.options().length, 0);
  assert(picker.nodes().some((node) => node.props.children === "No matching products"));
  assert(picker.key("Enter"));
  assert.deepEqual(picker.choices, []);
  assert.equal(picker.input("sale-product").props["aria-expanded"], true);
  picker.change("sale-product-search", "synthetic-b");
  assert(picker.key("Enter"));
  assert.deepEqual(picker.choices, [other.id]);
  assert.equal(picker.input("sale-product").props["aria-expanded"], false);
  assert.equal(picker.requests.length, 0);
});

test("product picker keyboard navigation highlights choices, selects explicitly, and closes on Escape", async () => {
  const picker = await mountPicker();
  assert(picker.key("ArrowDown"));
  const highlighted = () => picker.input("sale-product-search").props["aria-activedescendant"];
  assert.equal(highlighted(), picker.options()[0].props.id);
  assert(picker.key("End"));
  assert.equal(highlighted(), picker.options()[1].props.id);
  assert(picker.key("Home"));
  assert.equal(highlighted(), picker.options()[0].props.id);
  assert(picker.key("ArrowDown"));
  assert.equal(highlighted(), picker.options()[1].props.id);
  assert(picker.key("ArrowUp"));
  assert.equal(highlighted(), picker.options()[0].props.id);
  assert.deepEqual(picker.choices, []);
  assert(picker.key("Enter"));
  assert.deepEqual(picker.choices, [product.id]);
  picker.open();
  assert(picker.key("Escape"));
  assert.equal(picker.input("sale-product").props["aria-expanded"], false);
  assert.equal(picker.choices.length, 1);
  assert(picker.key("ArrowUp"));
  assert.equal(highlighted(), picker.options()[1].props.id);
});

test("product search leaves Home and End to text editing while retaining option navigation on the trigger", async () => {
  const picker = await mountPicker();
  picker.open();
  picker.change("sale-product-search", "Synthetic");
  const searchTarget = { value: "Synthetic", selectionStart: 4, selectionEnd: 4 };
  picker.input("sale-product-search").props.ref.current = searchTarget;
  const highlighted = () => picker.input("sale-product-search").props["aria-activedescendant"];
  assert(picker.key("ArrowDown", searchTarget));
  const secondOption = picker.options()[1].props.id;
  assert.equal(highlighted(), secondOption);
  for (const key of ["Home", "End"]) {
    assert.equal(
      picker.key(key, searchTarget),
      false,
      `${key} must keep its native text-input action`,
    );
    assert.equal(highlighted(), secondOption);
    assert.equal(picker.input("sale-product-search").props.value, "Synthetic");
    assert.deepEqual(picker.choices, []);
  }
  const triggerTarget = {};
  assert(picker.key("Home", triggerTarget));
  assert.equal(highlighted(), picker.options()[0].props.id);
  assert(picker.key("End", triggerTarget));
  assert.equal(highlighted(), secondOption);
});

test("product picker retains a disappeared retry product, omits inactive choices, and respects disabled state", async () => {
  const picker = await mountPicker({
    products: [
      { ...other, currentStock: 0 },
      { ...product, id: "inactive", isActive: false },
    ],
    selectedProduct: product,
  });
  assert(picker.nodes().some((node) => node.props.children === product.name));
  picker.open();
  assert.deepEqual(
    picker.options().map((node) => node.props["data-product-id"]),
    [other.id],
  );
  assert(picker.nodes().some((node) => node.props.children === "Out of stock"));
  picker.options()[0].props.onClick();
  picker.render();
  assert.deepEqual(picker.choices, [other.id]);
  picker.props.disabled = true;
  picker.render();
  assert.equal(picker.input("sale-product").props.disabled, true);
  picker.open();
  assert.equal(picker.options().length, 0);
});

test("a sale selected after empty initial catalog retains its original retry through deactivation and timezone change", async () => {
  const form = await mount("src/components/record-sale-dialog.tsx", "RecordSaleDialog", {
    products: [],
  });
  form.state.products = [{ ...product }, { ...other }];
  form.render();
  form.change("sale-qty", "5");
  await form.submit();
  const first = form.requests[0];
  assert.equal(first.args[0], product.id);
  form.state.products = [{ ...product, isActive: false, currentStock: 0 }, { ...other }];
  form.state.businessDay = "2026-10-19";
  form.state.settings.timezone = "Pacific/Honolulu";
  form.render();
  assert.equal(form.input("sale-product").props.value, product.id);
  assert.equal(form.input("sale-date").props.max, undefined);
  assert.equal(form.input("sale-qty").props.max, undefined);
  assert.equal(form.button().props.disabled, false);
  await form.submit();
  assert.deepEqual(form.requests[1], first);
  form.state.products = [{ ...other }];
  form.render();
  assert.equal(form.input("sale-product").props.value, product.id);
  await form.submit();
  assert.deepEqual(form.requests[2], first);
  form.change("sale-qty", "4");
  assert.equal(form.button().props.disabled, true);
  await form.submit();
  assert.equal(form.requests.length, 3);
  form.change("sale-product", other.id);
  form.change("sale-date", "2026-10-19");
  await form.submit();
  assert.equal(form.requests[3].args[0], other.id);
  assert.notEqual(form.requests[3].args[3], first.args[3]);
});

test("sale retry eligibility is lost synchronously on same-account reauthentication and never skips input validation", async () => {
  const form = await mount("src/components/record-sale-dialog.tsx", "RecordSaleDialog");
  form.change("sale-qty", "5");
  await form.submit();
  const first = form.requests[0];
  form.state.session = { ...form.state.session };
  form.state.products = [{ ...product, currentStock: 0 }, { ...other }];
  form.render();
  assert.equal(form.input("sale-qty").props.max, 0);
  assert.equal(form.button().props.disabled, true);
  await form.submit();
  assert.equal(form.requests.length, 1);
  form.change("sale-product", other.id);
  for (const [id, invalid] of [
    ["sale-date", "2026-02-30"],
    ["sale-qty", "1.0001"],
  ]) {
    form.change(id, invalid);
    await form.submit();
    assert.equal(form.requests.length, 1);
    form.change(id, id === "sale-date" ? "2026-10-20" : "5");
  }
  await form.submit();
  assert.notEqual(form.requests[1].args[3], first.args[3]);
});

test("return and write-off retries retain original product and normalized note while edits still require current eligibility", async () => {
  for (const movementType of ["return", "write_off"]) {
    const form = await mount("src/components/stock-movements-panel.tsx", "StockMovementForm", {
      extra: "export { StockMovementForm };",
      props: { movementType },
    });
    form.change("synthetic-form-qty", "5");
    form.change("synthetic-form-note", "  Original reason  ");
    await form.submit();
    const first = form.requests[0];
    form.state.products = [{ ...product, isActive: false, currentStock: 0 }, { ...other }];
    form.state.businessDay = "2026-10-19";
    form.render();
    assert.equal(form.input("synthetic-form-product").props.value, product.id);
    assert.equal(form.input("synthetic-form-date").props.max, undefined);
    assert.equal(form.button().props.disabled, false);
    form.change("synthetic-form-note", "Original reason");
    await form.submit();
    assert.deepEqual(form.requests[1], first);
    form.state.products = [{ ...other }];
    form.render();
    await form.submit();
    assert.deepEqual(form.requests[2], first);
    form.change("synthetic-form-note", "Edited reason");
    assert.equal(form.button().props.disabled, true);
    await form.submit();
    assert.equal(form.requests.length, 3);
    form.change("synthetic-form-product", other.id);
    form.change("synthetic-form-date", "2026-10-19");
    await form.submit();
    assert.equal(form.requests[3].args[0].productId, other.id);
    assert.notEqual(form.requests[3].args[0].idempotencyKey, first.args[0].idempotencyKey);
  }
});

test("movement pending retries cannot bypass a replacement session or lost role permission", async () => {
  const form = await mount("src/components/stock-movements-panel.tsx", "StockMovementForm", {
    extra: "export { StockMovementForm };",
    props: { movementType: "write_off" },
  });
  form.change("synthetic-form-qty", "5");
  form.change("synthetic-form-note", "Original reason");
  await form.submit();
  form.state.products = [{ ...product, currentStock: 0 }];
  form.state.session = { ...form.state.session };
  form.render();
  assert.equal(form.input("synthetic-form-qty").props.max, 0);
  await form.submit();
  assert.equal(form.requests.length, 1);
  form.state.products = [{ ...product }];
  form.state.session.role = "staff";
  form.render();
  assert.equal(form.button().props.disabled, true);
  await form.submit();
  assert.equal(form.requests.length, 1);
});

test("receipt retries retain captured date and key when product disappears, while edits and replacement sessions are blocked", async () => {
  const form = await mount("src/components/receive-stock-dialog.tsx", "ReceiveStockForm", {
    extra: "export { ReceiveStockForm };",
    props: { product, currentProduct: product },
  });
  form.change("recv-qty", "5");
  await form.submit();
  const first = form.requests[0];
  form.state.businessDay = "2026-10-19";
  form.props.currentProduct = { ...product, isActive: false, currentStock: 25 };
  form.render();
  assert.equal(form.button().props.disabled, false);
  await form.submit();
  assert.deepEqual(form.requests[1], first);
  form.props.currentProduct = undefined;
  form.render();
  await form.submit();
  assert.deepEqual(form.requests[2], first);
  form.change("recv-qty", "4");
  assert.equal(form.button().props.disabled, true);
  await form.submit();
  assert.equal(form.requests.length, 3);
  form.change("recv-qty", "5");
  form.state.session = { ...form.state.session };
  form.render();
  assert.equal(form.button().props.disabled, true);
  await form.submit();
  assert.equal(form.requests.length, 3);
});

test("the receipt wrapper keeps the same form mounted when a product becomes inactive or missing", async () => {
  const dialog = await mount("src/components/receive-stock-dialog.tsx", "ReceiveStockDialog", {
    props: { product, open: true, onOpenChange() {} },
  });
  const findForm = () =>
    dialog.find((node) => typeof node.type === "function" && node.type.name === "ReceiveStockForm");
  const originalType = findForm().type;
  dialog.state.products = [{ ...product, isActive: false }];
  dialog.render();
  assert.equal(findForm().type, originalType);
  assert.equal(findForm().props.currentProduct.isActive, false);
  dialog.state.products = [];
  dialog.render();
  assert.equal(findForm().type, originalType);
  assert.equal(findForm().props.product.id, product.id);
  assert.equal(findForm().props.currentProduct, undefined);
});

test("Inventory delivery selection survives deactivation/removal and closes for a replacement session", async () => {
  const panel = await mount("src/components/products-panel.tsx", "ProductsPanel");
  panel.find((node) => typeof node.props.onDelivery === "function").props.onDelivery(product.id);
  panel.render();
  const dialog = () => panel.find((node) => node.type === "ReceiveStockDialog");
  assert.equal(dialog().props.open, true);
  panel.state.products = [{ ...product, isActive: false }, { ...other }];
  panel.render();
  assert.equal(dialog().props.product.id, product.id);
  assert.equal(dialog().props.open, true);
  panel.state.products = [{ ...other }];
  panel.render();
  assert.equal(dialog().props.product.id, product.id);
  assert.equal(dialog().props.open, true);
  panel.state.session = { ...panel.state.session };
  panel.render();
  assert.equal(dialog().props.product, null);
  assert.equal(dialog().props.open, false);
});

test("Restock delivery selection survives disappearing recommendations/catalog and closes for a replacement session", async () => {
  const page = await mount("src/routes/restock.tsx", "RestockPage", {
    extra: "export { RestockPage };",
  });
  const row = {
    product,
    status: "reorder",
    demandAvailable: true,
    dailyDemand: 2,
    reorderQty: 10,
    reorderPoint: 8,
  };
  page.forecast.rows = [row];
  page.render();
  page.find((node) => typeof node.props.onReceive === "function").props.onReceive();
  page.render();
  const dialog = () => page.find((node) => node.type === "ReceiveStockDialog");
  assert.equal(dialog().props.open, true);
  page.forecast.rows = [];
  page.state.products = [{ ...product, isActive: false }, { ...other }];
  page.render();
  assert.equal(dialog().props.product.id, product.id);
  assert.equal(dialog().props.open, true);
  page.state.products = [{ ...other }];
  page.render();
  assert.equal(dialog().props.product.id, product.id);
  assert.equal(dialog().props.open, true);
  page.state.session = { ...page.state.session };
  page.render();
  assert.equal(dialog().props.product, null);
  assert.equal(dialog().props.open, false);
});
