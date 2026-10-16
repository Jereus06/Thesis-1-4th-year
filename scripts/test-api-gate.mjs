import assert from "node:assert/strict";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

const root = fileURLToPath(new URL("../", import.meta.url));
const storePath = fileURLToPath(new URL("../src/lib/store.ts", import.meta.url));
const server = await createServer({
  root,
  configFile: false,
  logLevel: "silent",
  server: { middlewareMode: true, watch: null },
  resolve: { alias: { "@": fileURLToPath(new URL("../src", import.meta.url)) } },
  plugins: [
    {
      name: "api-gate-test-store",
      load(id) {
        if (id.replaceAll("\\", "/") !== storePath.replaceAll("\\", "/")) return;
        // Control authentication while rendering the real gate and token form.
        return `
          let state;
          export function setTestState(value) { state = value; }
          export const useAppStore = (selector) => selector(state);
        `;
      },
    },
  ],
});
const { ApiGate } = await server.ssrLoadModule("/src/components/api-gate.tsx");
const { setTestState } = await server.ssrLoadModule("/src/lib/store.ts");
const originalWindow = globalThis.window;
after(async () => {
  if (originalWindow === undefined) delete globalThis.window;
  else globalThis.window = originalWindow;
  await server.close();
});

function renderGate({ query = "", authenticated = false, mode = "api" } = {}) {
  globalThis.window = { location: { search: query } };
  setTestState({
    dataMode: mode,
    session: authenticated ? { userId: "synthetic-user" } : null,
    apiError: null,
  });
  return renderToStaticMarkup(
    createElement(ApiGate, null, createElement("p", null, "Store content")),
  );
}

for (const authenticated of [false, true]) {
  const session = authenticated ? "an authenticated" : "an anonymous";
  test(`reset links show the reset form with ${session} session`, () => {
    const markup = renderGate({ query: "?reset=synthetic-reset-token", authenticated });
    assert.match(markup, /Choose a new password/);
    assert.match(markup, /Reset password/);
    assert.doesNotMatch(markup, /Store content|Accept staff invitation|Connecting to your store/);
  });

  test(`invitation links show the invitation form with ${session} session`, () => {
    const markup = renderGate({ query: "?invitation=synthetic-invitation-token", authenticated });
    assert.match(markup, /Accept staff invitation/);
    assert.match(markup, /Create staff account/);
    assert.doesNotMatch(markup, /Store content|Choose a new password|Connecting to your store/);
  });
}

test("authenticated access without a token still shows the store", () => {
  assert.match(renderGate({ authenticated: true }), /Store content/);
});

test("anonymous access without a token still waits for session restoration", () => {
  assert.match(renderGate(), /Connecting to your store/);
});

test("browser demonstration remains accessible with token query parameters", () => {
  const markup = renderGate({ query: "?reset=synthetic-reset-token", mode: "browser-demo" });
  assert.match(markup, /Store content/);
  assert.doesNotMatch(markup, /Choose a new password/);
});
