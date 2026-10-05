import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";
import { createServer } from "vite";

const root = fileURLToPath(new URL("../", import.meta.url));
const server = await createServer({
  root,
  configFile: false,
  logLevel: "silent",
  server: { middlewareMode: true, watch: null },
  resolve: { alias: { "@": fileURLToPath(new URL("../src", import.meta.url)) } },
});
const { api } = await server.ssrLoadModule("/src/lib/api.ts");
const { getPermissions } = await server.ssrLoadModule("/src/lib/permissions.ts");
const originalFetch = globalThis.fetch;
const originalDocument = globalThis.document;
after(async () => {
  globalThis.fetch = originalFetch;
  if (originalDocument === undefined) delete globalThis.document;
  else globalThis.document = originalDocument;
  await server.close();
});

const session = {
  businessId: "synthetic-business",
  userId: "synthetic-owner",
  displayName: "Practice owner",
  email: "owner@example.test",
  role: "owner",
};
const members = [
  {
    id: session.userId,
    email: session.email,
    displayName: session.displayName,
    role: "owner",
    isActive: true,
  },
  {
    id: "synthetic-staff",
    email: "staff@example.test",
    displayName: "Practice staff",
    role: "staff",
    isActive: true,
  },
  {
    id: "synthetic-inactive",
    email: "inactive@example.test",
    displayName: "Inactive staff",
    role: "staff",
    isActive: false,
  },
];

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((success, failure) => {
    resolve = success;
    reject = failure;
  });
  return { promise, resolve, reject };
}

async function settle() {
  await new Promise((resolve) => setImmediate(resolve));
}

// Execute the real component and its event handlers with deterministic hooks.
// UI primitives become element records; no DOM or additional test package is needed.
async function mount({ role = "owner", mode = "api", overrides = {} } = {}) {
  const source = await readFile(
    new URL("../src/components/account-maintenance.tsx", import.meta.url),
    "utf8",
  );
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
    fileName: "account-maintenance.tsx",
  }).outputText;
  const slots = [];
  let cursor = 0;
  let dirty = false;
  let effects = [];
  let tree;
  const notices = [];
  let passwordReloads = 0;
  const calls = { members: [], setMemberActive: [], inviteStaff: [], changePassword: [] };
  const state = { dataMode: mode, session: { ...session, role } };
  const apiMock = {};
  for (const method of Object.keys(calls)) {
    apiMock[method] = (...args) => {
      calls[method].push(args);
      return (overrides[method] ?? (() => Promise.resolve(method === "members" ? members : {})))(
        ...args,
      );
    };
  }
  const changed = (previous, next) =>
    !previous ||
    !next ||
    previous.length !== next.length ||
    next.some((value, index) => !Object.is(value, previous[index]));
  const hooks = {
    useState(initial) {
      const index = cursor++;
      if (!slots[index]) {
        slots[index] = { value: typeof initial === "function" ? initial() : initial };
        slots[index].set = (value) => {
          const next = typeof value === "function" ? value(slots[index].value) : value;
          if (!Object.is(next, slots[index].value)) {
            slots[index].value = next;
            dirty = true;
          }
        };
      }
      return [slots[index].value, slots[index].set];
    },
    useRef(initial) {
      const index = cursor++;
      slots[index] ??= { current: initial };
      return slots[index];
    },
    useCallback(callback, dependencies) {
      const index = cursor++;
      if (!slots[index] || changed(slots[index].dependencies, dependencies))
        slots[index] = { value: callback, dependencies };
      return slots[index].value;
    },
    useEffect(effect, dependencies) {
      const index = cursor++;
      if (!slots[index] || changed(slots[index].dependencies, dependencies)) {
        const previous = slots[index];
        slots[index] = { dependencies };
        effects.push(() => {
          previous?.cleanup?.();
          slots[index].cleanup = effect();
        });
      }
    },
  };
  const jsx = (type, props) =>
    typeof type === "function" ? type(props) : { type, props: props ?? {} };
  const exports = {};
  vm.runInNewContext(
    compiled,
    {
      exports,
      Error,
      window: { location: { reload: () => passwordReloads++ } },
      require(name) {
        if (name === "react") return hooks;
        if (name === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment: "fragment" };
        if (name === "sonner")
          return {
            toast: {
              success: (message) => notices.push({ kind: "success", message }),
              error: (message) => notices.push({ kind: "error", message }),
            },
          };
        if (name === "@/lib/api") return { api: apiMock };
        if (name === "@/lib/store") return { useAppStore: (selector) => selector(state) };
        if (name === "@/lib/permissions")
          return {
            getPermissions,
            usePermissions: () => getPermissions(state.dataMode, state.session),
          };
        if (name.startsWith("@/components/ui/"))
          return new Proxy({}, { get: (_target, key) => String(key) });
        throw new Error(`Unexpected account-maintenance import: ${name}`);
      },
    },
    { filename: "account-maintenance.tsx" },
  );
  const harness = {
    calls,
    notices,
    passwordReloads: () => passwordReloads,
    render() {
      let attempts = 0;
      do {
        assert.ok(attempts++ < 20, "component render settles");
        dirty = false;
        cursor = 0;
        effects = [];
        tree = exports.AccountMaintenance();
        effects.forEach((effect) => effect());
      } while (dirty);
      return tree;
    },
    nodes() {
      const result = [];
      function visit(node) {
        if (Array.isArray(node)) return node.forEach(visit);
        if (!node || typeof node !== "object") return;
        result.push(node);
        visit(node.props?.children);
      }
      visit(tree);
      return result;
    },
    text() {
      return elementText(tree);
    },
    button(label) {
      const result = this.nodes().find(
        (node) => (node.type === "Button" || node.type === "button") && elementText(node) === label,
      );
      assert.ok(result, `button exists: ${label}`);
      return result;
    },
    field(label) {
      const labelNode = this.nodes().find(
        (node) => (node.type === "Label" || node.type === "label") && elementText(node) === label,
      );
      assert.ok(labelNode, `field label exists: ${label}`);
      const result = this.nodes().find((node) => node.props.id === labelNode.props.htmlFor);
      assert.ok(result, `labeled field exists: ${label}`);
      return result;
    },
    fill(label, value) {
      this.field(label).props.onChange({ target: { value } });
      this.render();
    },
    submit(label) {
      const form = this.nodes().find(
        (node) => node.type === "form" && elementText(node).includes(label),
      );
      assert.ok(form, `form exists: ${label}`);
      return form.props.onSubmit({ preventDefault() {} });
    },
  };
  harness.render();
  return harness;
}

function elementText(node) {
  if (Array.isArray(node)) return node.map(elementText).join("");
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node !== "object") return String(node);
  return elementText(node.props?.children);
}

test("members GET uses cookie credentials without a CSRF header; member writes keep CSRF", async () => {
  const requests = [];
  globalThis.document = { cookie: "unrelated=value; stockcast_csrf=synthetic%20csrf" };
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    return new Response(
      JSON.stringify({ data: options.method === "GET" ? members : { changed: true } }),
      { headers: { "content-type": "application/json" } },
    );
  };
  assert.deepEqual(await api.members(), members);
  await api.setMemberActive("synthetic-staff", false);
  await api.inviteStaff("new@example.test", "New staff");
  assert.match(requests[0].url, /\/auth\/members$/);
  assert.equal(requests[0].options.method, "GET");
  assert.equal(requests[0].options.credentials, "include");
  assert.equal(requests[0].options.headers["x-csrf-token"], undefined);
  assert.equal(requests[0].options.body, undefined);
  for (const request of requests.slice(1)) {
    assert.equal(request.options.credentials, "include");
    assert.equal(request.options.headers["x-csrf-token"], "synthetic csrf");
    assert.equal(request.options.headers["content-type"], "application/json");
  }
  assert.equal(requests[1].options.method, "PATCH");
  assert.match(requests[1].url, /\/auth\/members\/synthetic-staff$/);
  assert.deepEqual(JSON.parse(requests[1].options.body), { isActive: false });
  assert.equal(requests[2].options.method, "POST");
});

test("owner staff list distinguishes loading, failure with retry, and ready empty", async () => {
  const first = deferred();
  const retry = deferred();
  let count = 0;
  const h = await mount({
    overrides: { members: () => (++count === 1 ? first.promise : retry.promise) },
  });
  assert.match(h.text(), /Loading staff access/);
  assert.doesNotMatch(h.text(), /No staff accounts are listed/);
  assert.equal(
    h.nodes().some((node) => node.props.role === "status"),
    true,
  );
  first.reject(new Error("Staff lookup unavailable"));
  await settle();
  h.render();
  assert.match(h.text(), /Staff lookup unavailable/);
  assert.equal(
    h
      .nodes()
      .some(
        (node) =>
          node.props.role === "alert" && elementText(node).includes("Staff lookup unavailable"),
      ),
    true,
  );
  assert.doesNotMatch(h.text(), /No staff accounts are listed/);
  h.button("Retry loading staff").props.onClick();
  h.render();
  assert.equal(h.calls.members.length, 2);
  assert.match(h.text(), /Loading staff access/);
  retry.resolve([members[0]]);
  await settle();
  h.render();
  assert.match(h.text(), /No staff accounts are listed\./);
  assert.doesNotMatch(h.text(), /Staff lookup unavailable|Loading staff access/);
  h.button("Refresh staff list");
});

test("owners see staff controls while staff retain password maintenance without loading members", async () => {
  const owner = await mount();
  await settle();
  owner.render();
  owner.button("Disable");
  owner.button("Restore");
  owner.field("Staff name");
  owner.field("Staff email");
  assert.match(owner.text(), /Practice staff|Inactive staff/);
  assert.equal(owner.calls.members.length, 1);
  const staff = await mount({ role: "staff" });
  await settle();
  staff.render();
  staff.field("Current password");
  staff.field("New password");
  assert.equal(staff.calls.members.length, 0);
  assert.doesNotMatch(
    staff.text(),
    /Staff name|Staff email|Refresh staff list|Disable|Restore|Practice staff/,
  );
});

test("pending member changes guard duplicate writes and reload after committed disable and restore", async () => {
  const write = deferred();
  const reload = deferred();
  let reads = 0;
  const h = await mount({
    overrides: {
      members: () => (++reads === 1 ? Promise.resolve(members) : reload.promise),
      setMemberActive: () => write.promise,
    },
  });
  await settle();
  h.render();
  const disable = h.button("Disable").props.onClick;
  const restore = h.button("Restore").props.onClick;
  disable();
  disable();
  restore();
  h.render();
  assert.deepEqual(h.calls.setMemberActive, [["synthetic-staff", false]]);
  assert.equal(h.button("Disabling…").props.disabled, true);
  assert.equal(h.button("Restore").props.disabled, true);
  assert.equal(h.calls.members.length, 1, "do not reload before the write commits");
  h.fill("Current password", "current-password");
  h.fill("New password", "replacement-password");
  h.submit("Change password");
  h.fill("Staff name", "New staff");
  h.fill("Staff email", "new@example.test");
  h.submit("Send staff invitation");
  assert.equal(h.calls.changePassword.length, 0);
  assert.equal(h.calls.inviteStaff.length, 0);
  write.resolve({ changed: true });
  await settle();
  h.render();
  assert.equal(h.calls.members.length, 2, "successful writes reload the staff list");
  reload.resolve(
    members.map((member) =>
      member.id === "synthetic-staff" ? { ...member, isActive: false } : member,
    ),
  );
  await settle();
  h.render();
  assert.doesNotMatch(h.text(), /Disabling/);
  const restores = h
    .nodes()
    .filter((node) => node.type === "Button" && elementText(node) === "Restore");
  assert.equal(restores.length, 2);
  const restoreDisabled = restores[0].props.onClick;
  restoreDisabled();
  restoreDisabled();
  h.render();
  assert.deepEqual(h.calls.setMemberActive[1], ["synthetic-staff", true]);
  assert.equal(h.button("Restoring…").props.disabled, true);
  await settle();
  h.render();
  assert.equal(h.calls.members.length, 3);
});

test("password and invitation writes lock management controls and reject duplicate submits", async () => {
  const invitation = deferred();
  const password = deferred();
  const h = await mount({
    overrides: { inviteStaff: () => invitation.promise, changePassword: () => password.promise },
  });
  await settle();
  h.render();
  h.fill("Current password", "current-password");
  h.fill("New password", "replacement-password");
  h.fill("Staff name", "New staff");
  h.fill("Staff email", "new@example.test");
  const disable = h.button("Disable").props.onClick;
  h.submit("Send staff invitation");
  h.submit("Send staff invitation");
  h.submit("Change password");
  disable();
  h.render();
  assert.equal(h.calls.inviteStaff.length, 1);
  assert.equal(h.calls.changePassword.length, 0);
  assert.equal(h.calls.setMemberActive.length, 0);
  assert.equal(h.button("Disable").props.disabled, true);
  assert.equal(h.button("Change password").props.disabled, true);
  invitation.reject(new Error("Invitation mail unavailable"));
  await settle();
  h.render();
  assert.match(h.text(), /Invitation mail unavailable/);
  assert.equal(h.button("Disable").props.disabled, false);
  h.submit("Change password");
  h.submit("Change password");
  h.submit("Send staff invitation");
  disable();
  h.render();
  assert.equal(h.calls.changePassword.length, 1);
  assert.equal(h.calls.inviteStaff.length, 1);
  assert.equal(h.calls.setMemberActive.length, 0);
  assert.equal(h.button("Changing password…").props.disabled, true);
  assert.equal(h.button("Disable").props.disabled, true);
  password.resolve({ changed: true });
  await settle();
  h.render();
  assert.equal(h.passwordReloads(), 1);
});

test("a failed member write preserves the row and a failed reload stays explicit and retryable", async () => {
  let writes = 0;
  let reads = 0;
  const h = await mount({
    overrides: {
      members: () =>
        ++reads === 2 ? Promise.reject(new Error("Reload unavailable")) : Promise.resolve(members),
      setMemberActive: () =>
        ++writes === 1
          ? Promise.reject(new Error("Permission changed"))
          : Promise.resolve({ changed: true }),
    },
  });
  await settle();
  h.render();
  h.button("Disable").props.onClick();
  await settle();
  h.render();
  assert.match(h.text(), /Permission changed/);
  h.button("Disable");
  assert.equal(h.calls.members.length, 1, "failed write does not reload");
  h.button("Disable").props.onClick();
  await settle();
  h.render();
  assert.match(h.text(), /Reload unavailable/);
  assert.doesNotMatch(h.text(), /No staff accounts are listed/);
  h.button("Retry loading staff").props.onClick();
  await settle();
  h.render();
  assert.equal(h.calls.members.length, 3);
  assert.doesNotMatch(h.text(), /Reload unavailable/);
});
