import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";
import { createServer } from "vite";

const server = await createServer({
  root: fileURLToPath(new URL("../", import.meta.url)),
  configFile: false,
  logLevel: "silent",
  server: { middlewareMode: true, watch: null },
  resolve: { alias: { "@": fileURLToPath(new URL("../src", import.meta.url)) } },
});
const survey = await server.ssrLoadModule("/src/lib/client-survey.ts");
const legacy = await server.ssrLoadModule("/src/lib/iso-eval.ts");
const { api } = await server.ssrLoadModule("/src/lib/api.ts");
const previous = {
  fetch: globalThis.fetch,
  document: globalThis.document,
  window: globalThis.window,
};
after(async () => {
  globalThis.fetch = previous.fetch;
  for (const key of ["document", "window"])
    if (previous[key] === undefined) delete globalThis[key];
    else globalThis[key] = previous[key];
  await server.close();
});
const session = {
  businessId: "synthetic-business",
  userId: "synthetic-owner",
  email: "owner@example.com",
  displayName: "Synthetic owner",
  role: "owner",
};
const definition = survey.CLIENT_SURVEY;
const validId = "3fb19761-08f3-4b6a-93fd-93b97cf6af87";

function storage() {
  const entries = new Map();
  globalThis.window = {
    localStorage: {
      getItem: (key) => entries.get(key) ?? null,
      setItem: (key, value) => entries.set(key, value),
    },
  };
  return entries;
}
function emptyStatistics() {
  return {
    participantCount: 0,
    validResponseCount: 0,
    overallWeightedMean: null,
    characteristics: definition.characteristics.map((item) => ({
      characteristicId: item.id,
      weightedMean: null,
      validResponseCount: 0,
      participantCount: 0,
    })),
    items: definition.items.map((item) => ({
      itemId: item.id,
      weightedMean: null,
      validResponseCount: 0,
      responseCounts: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
      unansweredCount: 0,
      notApplicableCount: 0,
    })),
  };
}
function emptySummary(role = "owner") {
  return {
    ...emptyStatistics(),
    questionnaireVersion: definition.version,
    scope: role === "owner" ? "business" : "own",
    businessDataOrigin: "demo",
    submissionDataOrigins: { demo: 0, partner: 0 },
    byRole: (role === "owner" ? ["owner_manager", "staff"] : ["staff"]).map((participantRole) => ({
      ...emptyStatistics(),
      participantRole,
    })),
  };
}
function submission(input, role = "owner") {
  return {
    ...input,
    businessId: session.businessId,
    userId: session.userId,
    participantRole: role === "owner" ? "owner_manager" : "staff",
    dataOrigin: "demo",
    submittedAt: "2026-10-05T08:00:00Z",
  };
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((success, failure) => {
    resolve = success;
    reject = failure;
  });
  return { promise, resolve, reject };
}
async function settle() {
  await new Promise((resolve) => setImmediate(resolve));
}
function elementText(node) {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(elementText).join("");
  return elementText(node.props?.children);
}

// Exercise the real component and its handlers without adding a DOM testing dependency.
async function mount({ role = "owner", mode = "api", overrides = {}, entries = storage() } = {}) {
  const source = await readFile(
    new URL("../src/components/system-evaluation.tsx", import.meta.url),
    "utf8",
  );
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
    fileName: "system-evaluation.tsx",
  }).outputText;
  const state = {
    dataMode: mode,
    dataOrigin: "demo",
    session: mode === "api" ? { ...session, role } : null,
  };
  const props = { mode, session: state.session, dataOrigin: state.dataOrigin };
  const slots = [],
    calls = {},
    notices = [];
  let cursor = 0,
    dirty = false,
    effects = [],
    tree,
    records = [];
  const apiMock = { surveyExportUrl: () => "/authorized-survey.csv" };
  for (const name of [
    "surveyQuestionnaire",
    "surveySubmissions",
    "surveySummary",
    "submitSurvey",
  ]) {
    calls[name] = [];
    apiMock[name] = (...args) => {
      calls[name].push(args);
      const result = overrides[name]
        ? overrides[name](...args)
        : name === "surveyQuestionnaire"
          ? definition
          : name === "surveySubmissions"
            ? records
            : name === "surveySummary"
              ? emptySummary(role)
              : submission(args[1], role);
      return Promise.resolve(result).then((value) => {
        if (name === "submitSurvey") records = [value];
        return value;
      });
    };
  }
  const changed = (a, b) =>
    !a || !b || a.length !== b.length || b.some((item, index) => !Object.is(item, a[index]));
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
  const useAppStore = (selector) => selector(state);
  useAppStore.getState = () => state;
  const exports = {};
  vm.runInNewContext(compiled, {
    exports,
    Error,
    Date,
    require(name) {
      if (name === "react") return hooks;
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment: "fragment" };
      if (name === "sonner") return { toast: { success: (value) => notices.push(value) } };
      if (name === "@/lib/api") return { api: apiMock };
      if (name === "@/lib/client-survey") return survey;
      if (name === "@/lib/iso-eval") return legacy;
      if (name === "@/lib/format") return { num: (value, places) => value.toFixed(places) };
      if (name === "@/lib/store") return { useAppStore };
      if (name.startsWith("@/components/ui/"))
        return new Proxy({}, { get: (_target, key) => String(key) });
      throw new Error(`Unexpected survey import: ${name}`);
    },
  });
  const harness = {
    calls,
    notices,
    entries,
    state,
    render() {
      let attempts = 0;
      do {
        assert.ok(attempts++ < 20, "component render settles");
        dirty = false;
        cursor = 0;
        effects = [];
        tree = exports.ClientSurveyForm(props);
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
        (node) => node.type === "Button" && elementText(node) === label,
      );
      assert.ok(result, `button exists: ${label}`);
      return result;
    },
    answer(item, value) {
      const select = this.nodes().find((node) => node.props.id === "survey-" + item);
      assert.ok(select, `item exists: ${item}`);
      select.props.onChange({ target: { value } });
      this.render();
    },
    async ready() {
      await settle();
      this.render();
    },
    unmount() {
      slots.forEach((slot) => slot.cleanup?.());
    },
  };
  harness.render();
  return harness;
}

test("new versioned drafts keep explicit NA/unanswered and preserve legacy browser ratings", () => {
  const entries = storage();
  const oldKey = legacy.accountIsoStorageKey(session.businessId, session.userId);
  const oldValue = JSON.stringify({
    functional: 5,
    reliability: 4,
    usability: 3,
    performance: 2,
    maintainability: 1,
  });
  entries.set(oldKey, oldValue);
  const key = survey.clientSurveyStorageKey(session.businessId, session.userId);
  assert.notEqual(key, oldKey);
  let draft = survey.emptyClientSurveyDraft();
  draft = survey.changeSurveyAnswer(draft, "fs_1", "5");
  draft = survey.changeSurveyAnswer(draft, "fs_2", "1");
  draft = survey.changeSurveyAnswer(draft, "fs_3", "not_applicable");
  assert.deepEqual(survey.surveyDraftCounts(draft.answers), {
    rated: 2,
    notApplicable: 1,
    unanswered: 9,
  });
  assert.equal(draft.answers.find((item) => item.itemId === "fs_3").rating, null);
  survey.saveClientSurveyDraft(key, draft);
  assert.equal(survey.loadClientSurveyDraft(key).submissionId, draft.submissionId);
  assert.equal(entries.get(oldKey), oldValue);
  assert.equal(definition.items.length, 12);
  assert.equal(definition.characteristics.length, 4);
  assert.equal(
    definition.items.some((item) => item.characteristicId === "maintainability"),
    false,
  );
});

test("actual API methods read authoritative envelopes and send stable submission/CSRF headers", async () => {
  globalThis.document = { cookie: "stockcast_csrf=synthetic-csrf" };
  const requests = [];
  const input = { ...survey.emptyClientSurveyDraft(), submissionId: validId };
  delete input.lockedForRetry;
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    const data = url.endsWith("questionnaire")
      ? definition
      : url.endsWith("summary")
        ? emptySummary()
        : options.method === "POST"
          ? submission(input)
          : [];
    return new Response(JSON.stringify({ data }), {
      status: options.method === "POST" ? 201 : 200,
    });
  };
  assert.equal((await api.surveyQuestionnaire(session.businessId)).items.length, 12);
  assert.equal((await api.surveySummary(session.businessId)).scope, "business");
  assert.deepEqual(await api.surveySubmissions(session.businessId), []);
  const result = await api.submitSurvey(session.businessId, input);
  assert.equal(result.submittedAt, "2026-10-05T08:00:00Z");
  assert.equal(result.participantRole, "owner_manager");
  for (const request of requests.slice(0, 3)) {
    assert.equal(request.options.method, "GET");
    assert.equal(request.options.headers["x-csrf-token"], undefined);
    assert.equal(request.options.credentials, "include");
  }
  assert.equal(requests[3].options.headers["x-csrf-token"], "synthetic-csrf");
  assert.equal(requests[3].options.headers["idempotency-key"], validId);
  assert.equal(JSON.parse(requests[3].options.body).submissionId, validId);
  assert.ok(api.surveyExportUrl(session.businessId).endsWith("/survey/export.csv"));
});

test("Save draft is local; failed durable submission retains frozen answers and retries same UUID", async () => {
  let attempts = 0;
  const h = await mount({
    overrides: {
      submitSurvey: (_business, input) => {
        if (++attempts === 1) return Promise.reject(new Error("Connection interrupted"));
        return submission(input);
      },
    },
  });
  assert.ok(h.text().includes("Loading submitted feedback"));
  await h.ready();
  h.answer("fs_1", "5");
  h.answer("fs_2", "not_applicable");
  h.button("Save draft").props.onClick();
  h.render();
  assert.equal(h.calls.submitSurvey.length, 0);
  assert.ok(h.text().includes("Draft saved in this browser only"));
  const submit = h.button("Submit").props.onClick;
  submit();
  submit();
  await h.ready();
  assert.equal(h.calls.submitSurvey.length, 1, "synchronous guard prevents duplicate click");
  assert.ok(h.text().includes("Connection interrupted"));
  const attempted = h.calls.submitSurvey[0][1];
  assert.equal(attempted.answers.find((answer) => answer.itemId === "fs_1").rating, 5);
  assert.equal(
    attempted.answers.find((answer) => answer.itemId === "fs_2").responseStatus,
    "not_applicable",
  );
  assert.equal(attempted.answers.length, 12);
  assert.equal("participantRole" in attempted, false);
  assert.equal("userId" in attempted, false);
  const saved = JSON.parse(
    h.entries.get(survey.clientSurveyStorageKey(session.businessId, session.userId)),
  );
  assert.equal(saved.submissionId, attempted.submissionId);
  assert.equal(saved.lockedForRetry, true);
  assert.ok(
    h
      .nodes()
      .filter((node) => node.type === "Select")
      .every((node) => node.props.disabled),
  );
  h.button("Retry submission").props.onClick();
  await h.ready();
  assert.equal(h.calls.submitSurvey.length, 2);
  assert.equal(JSON.stringify(h.calls.submitSurvey[1][1]), JSON.stringify(attempted));
  assert.ok(h.text().includes("Final submission saved to the server"));
  assert.equal(h.button("Already submitted").props.disabled, true);
  h.unmount();
});

test("owner summary/CSV and server means remain separate from staff own feedback and demo drafts", async () => {
  const authoritative = emptySummary();
  authoritative.participantCount = 1;
  authoritative.validResponseCount = 2;
  authoritative.overallWeightedMean = 3;
  authoritative.submissionDataOrigins.demo = 1;
  authoritative.items[2].notApplicableCount = 1;
  const owner = await mount({ overrides: { surveySummary: () => authoritative } });
  await owner.ready();
  assert.ok(owner.text().includes("Weighted mean 3.00 / 5"));
  assert.ok(
    owner.text().includes("0 rated, 0 Not applicable, 12 unanswered in your browser draft"),
  );
  assert.ok(owner.text().includes("1 test submissions"));
  assert.ok(
    owner
      .nodes()
      .some((node) => node.type === "a" && elementText(node) === "Download submitted CSV"),
  );
  owner.unmount();
  const staff = await mount({ role: "staff" });
  await staff.ready();
  assert.ok(staff.text().includes("Your submission only"));
  assert.equal(staff.text().includes("Download submitted CSV"), false);
  assert.equal(staff.text().includes("All submitted participants in this store"), false);
  staff.unmount();
  const demo = await mount({ mode: "browser-demo" });
  assert.equal(demo.button("Submit").props.disabled, true);
  assert.equal(demo.calls.surveySummary.length, 0);
  assert.ok(demo.text().includes("Server collection and submission are unavailable"));
  demo.unmount();
});

test("summary loading failure exposes Retry and late account responses are ignored", async () => {
  let reads = 0;
  const h = await mount({
    overrides: {
      surveySummary: () =>
        ++reads === 1 ? Promise.reject(new Error("Read unavailable")) : emptySummary(),
    },
  });
  await h.ready();
  assert.ok(h.text().includes("Read unavailable"));
  assert.equal(h.button("Submit").props.disabled, true);
  h.button("Retry loading feedback").props.onClick();
  await h.ready();
  assert.equal(h.button("Submit").props.disabled, false);
  h.unmount();
  const pending = deferred();
  const stale = await mount({ overrides: { surveySummary: () => pending.promise } });
  stale.state.session = { ...session, businessId: "another-business", userId: "another-user" };
  const leaked = emptySummary();
  leaked.overallWeightedMean = 4.99;
  pending.resolve(leaked);
  await stale.ready();
  assert.equal(stale.text().includes("4.99"), false);
  stale.unmount();
});

test("a committed submission stays final when its summary refresh fails", async () => {
  let reads = 0;
  const h = await mount({
    overrides: {
      surveySummary: () =>
        ++reads === 1 ? emptySummary() : Promise.reject(new Error("Summary refresh unavailable")),
    },
  });
  await h.ready();
  h.answer("fs_1", "4");
  h.button("Submit").props.onClick();
  await h.ready();
  assert.ok(h.text().includes("Final submission saved to the server"));
  assert.ok(h.text().includes("Summary refresh unavailable"));
  assert.equal(h.button("Already submitted").props.disabled, true);
  assert.equal(h.calls.submitSurvey.length, 1);
  assert.ok(
    h
      .nodes()
      .filter((node) => node.type === "Select")
      .every((node) => node.props.disabled),
  );
  h.unmount();
});

test("blocked browser storage retains answers on-page; an account change suppresses pending write results", async () => {
  const pending = deferred();
  const h = await mount({ overrides: { submitSurvey: () => pending.promise } });
  await h.ready();
  globalThis.window.localStorage.setItem = () => {
    throw new Error("Storage denied");
  };
  h.answer("fs_1", "5");
  h.button("Save draft").props.onClick();
  h.render();
  assert.ok(h.text().includes("Draft could not be saved in this browser"));
  assert.ok(h.text().includes("1 rated"));
  h.button("Submit").props.onClick();
  h.render();
  const attempted = h.calls.submitSurvey[0][1];
  assert.equal(attempted.answers[0].rating, 5);
  h.state.session = { ...session, role: "staff" };
  pending.resolve(submission(attempted));
  await h.ready();
  assert.equal(h.text().includes("Final submission saved to the server"), false);
  assert.equal(h.notices.length, 0);
  h.unmount();
});

test("an earlier demo-origin final record remains test feedback after current business metadata changes", async () => {
  storage();
  const final = submission({ ...survey.emptyClientSurveyDraft(), submissionId: validId });
  const statistics = emptySummary();
  statistics.businessDataOrigin = "partner";
  statistics.submissionDataOrigins.demo = 1;
  const h = await mount({
    overrides: { surveySubmissions: () => [final], surveySummary: () => statistics },
  });
  await h.ready();
  assert.ok(
    h.text().includes("Aggregates containing test feedback are not actual client findings"),
  );
  assert.ok(h.text().includes("Test feedback. Server time: 2026-10-05T08:00:00Z"));
  assert.equal(h.button("Already submitted").props.disabled, true);
  h.unmount();
});
