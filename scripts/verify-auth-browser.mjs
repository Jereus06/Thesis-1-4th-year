import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Real browser, forms, store, and API client; every HTTP API request is intercepted.
// All identities are synthetic. This does not send email or write a database.
process.env.VITE_DATA_MODE = "api";
process.env.VITE_API_URL = "/api/v1";
const require = createRequire(resolve("package.json"));
const { chromium } = require("playwright");
const { createServer } = await import(
  pathToFileURL(resolve("node_modules/vite/dist/node/index.js"))
);
const output = resolve("benchmarks/auth");
await mkdir(output, { recursive: true });
const dependencies = Object.keys(JSON.parse(await readFile("package.json", "utf8")).dependencies);
const server = await createServer({
  cacheDir: resolve(output, "vite-cache"),
  optimizeDeps: {
    include: [
      ...dependencies,
      "react-dom/client",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
      "zustand/middleware",
    ],
  },
  server: { host: "127.0.0.1", port: 5199, strictPort: true },
});
const origin = "http://127.0.0.1:5199";
const owner = {
  userId: "synthetic-auth-owner",
  businessId: "synthetic-auth-business",
  email: "auth-owner@example.test",
  displayName: "Synthetic Auth Owner",
  role: "owner",
};
const password = "Synthetic auth passphrase 2026!";
const evidence = {
  provenance:
    "Real Edge/Chromium UI, native validation, store and API client; all API requests intercepted in a fresh context with synthetic identities. No real account, database write or outgoing email.",
  checks: [],
  requests: [],
  unexpectedRequests: [],
  pageErrors: [],
};
const requests = [];
const replies = new Map();
const pendingGates = [];
let currentSession = null;
let failNextSettingsRead = false;
let browser;
let page;
function deferred() {
  let resolve;
  const promise = new Promise((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}
function queue(path, { status = 200, data = {}, message, gate } = {}) {
  const list = replies.get(path) ?? [];
  const received = deferred();
  list.push({ status, data, message, gate, received });
  replies.set(path, list);
  if (gate) pendingGates.push(gate);
  return received.promise;
}
function count(path) {
  return requests.filter((request) => request.path === path).length;
}
function passed(message) {
  evidence.checks.push(message);
  console.log(`Passed ${evidence.checks.length}: ${message}`);
}

try {
  await server.listen();
  console.log("Started isolated authentication browser verification.");
  browser = await chromium.launch(
    process.platform === "win32" ? { channel: "msedge", headless: true } : { headless: true },
  );
  const context = await browser.newContext({ viewport: { width: 1365, height: 1000 } });
  await context.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^\/api\/v1/, "");
    const method = request.method();
    const json = (data, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify({ data }) });
    const failure = (status, message) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify({ error: { code: "synthetic_auth_failure", message } }),
      });
    evidence.requests.push({ path, method });
    if (method === "POST" && path.startsWith("/auth/")) {
      const body = request.postDataJSON();
      requests.push({ path, body });
      const reply = replies.get(path)?.shift();
      if (!reply) {
        evidence.unexpectedRequests.push({ path, method });
        return failure(500, "Unexpected synthetic authentication write");
      }
      reply.received.resolve();
      if (reply.gate) await reply.gate.promise;
      if (reply.status >= 400)
        return failure(reply.status, reply.message ?? "Synthetic request failure");
      if (["/auth/sign-in", "/auth/sign-up", "/auth/staff/invitations/accept"].includes(path))
        currentSession = reply.data;
      if (["/auth/sign-out", "/auth/password/recovery/complete"].includes(path))
        currentSession = null;
      return json(reply.data, reply.status);
    }
    if (path === "/auth/me")
      return currentSession ? json(currentSession) : failure(401, "Sign in is required");
    if (path === "/auth/options") return json({ signUpEnabled: true, googleEnabled: false });
    if (path === "/auth/google/pending") return json(null);
    if (path === `/businesses/${owner.businessId}`)
      return json({
        id: owner.businessId,
        name: "Synthetic Auth Store",
        location: "Synthetic test setting",
        dataOrigin: "demo",
      });
    if (
      path.endsWith("/products") ||
      path.endsWith("/sales") ||
      path.endsWith("/inventory-movements")
    )
      return json([]);
    if (path.endsWith("/settings")) {
      if (failNextSettingsRead) {
        failNextSettingsRead = false;
        return failure(503, "Synthetic store settings read failed.");
      }
      return json({
        businessId: owner.businessId,
        movingAverageWindow: 7,
        forecastHorizonDays: 7,
        targetCoverDays: 14,
        minimumHistoryWeeks: 8,
        minimumNonzeroDays: 100,
        topNProducts: 10,
        cvFolds: 3,
        timezone: "Asia/Manila",
      });
    }
    if (path.endsWith("/forecast-dashboard"))
      return json({
        stale: false,
        expired: false,
        forecastThrough: null,
        businessDay: "2026-10-09",
        businessTimezone: "Asia/Manila",
        run: null,
        latestRun: null,
        asOf: "2026-10-09T00:00:00Z",
        message: "Synthetic authentication verification",
        summaries: {},
        predictions: [],
        metrics: [],
        recommendations: [],
      });
    evidence.unexpectedRequests.push({ path, method });
    return failure(500, "Unexpected synthetic request");
  });
  page = await context.newPage();
  page.setDefaultTimeout(30_000);
  page.on("pageerror", (error) => evidence.pageErrors.push(error.message));
  const navigate = (path = "/inventory") =>
    page.goto(`${origin}${path}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  const signInForm = () => page.locator("#sign-in-form");
  async function waitForSignIn() {
    await signInForm().waitFor();
    await signInForm().getByLabel("Email", { exact: true }).waitFor();
  }
  async function doubleSubmit(form) {
    await form.evaluate((element) => {
      element.requestSubmit();
      element.requestSubmit();
    });
  }
  async function signInSuccessfully() {
    await waitForSignIn();
    await signInForm().getByLabel("Email", { exact: true }).fill(owner.email);
    await signInForm().getByLabel("Password", { exact: true }).fill(password);
    const pending = deferred();
    const before = count("/auth/sign-in");
    const received = queue("/auth/sign-in", { data: owner, gate: pending });
    await doubleSubmit(signInForm());
    await page.getByRole("button", { name: /Signing in/ }).waitFor();
    await received;
    assert.equal(
      count("/auth/sign-in"),
      before + 1,
      "Rapid same-task submissions must send one sign-in request",
    );
    assert.equal(await signInForm().getByLabel("Email", { exact: true }).isDisabled(), true);
    pending.resolve();
    await page.getByRole("button", { name: "Sign out", exact: true }).waitFor();
    assert.equal(await signInForm().count(), 0);
  }
  async function signOutSuccessfully() {
    queue("/auth/sign-out", { data: { signedOut: true } });
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await waitForSignIn();
  }

  await navigate();
  await waitForSignIn();
  await page.screenshot({
    path: resolve(output, "auth-desktop-sign-in-passed.png"),
    fullPage: true,
  });
  assert.equal(
    await page.getByRole("button", { name: "Forgot password", exact: true }).isEnabled(),
    true,
  );
  assert.equal(
    await page.getByRole("button", { name: "Create account", exact: true }).isEnabled(),
    true,
  );
  await signInForm().getByLabel("Email", { exact: true }).fill("not-an-email");
  await signInForm().getByLabel("Password", { exact: true }).fill(password);
  await signInForm().getByRole("button", { name: "Sign in", exact: true }).click();
  assert.equal(count("/auth/sign-in"), 0);
  assert.equal(
    await signInForm()
      .getByLabel("Email", { exact: true })
      .evaluate((input) => input.validity.typeMismatch),
    true,
  );
  passed(
    "Anonymous startup exposes account creation and password recovery; invalid email is stopped before any sign-in request.",
  );

  await signInForm().getByLabel("Email", { exact: true }).fill(owner.email);
  queue("/auth/sign-in", { status: 401, message: "Synthetic email or password was not accepted." });
  await signInForm().getByRole("button", { name: "Sign in", exact: true }).click();
  await page
    .getByRole("alert")
    .filter({ hasText: "Synthetic email or password was not accepted." })
    .waitFor();
  assert.equal(
    await signInForm().getByRole("button", { name: "Sign in", exact: true }).isEnabled(),
    true,
  );
  assert.equal(await signInForm().getByLabel("Email", { exact: true }).inputValue(), owner.email);
  passed("Rejected sign-in is accessible, preserves the email and unlocks the form for retry.");

  await signInForm().getByRole("button", { name: "Show password", exact: true }).click();
  assert.equal(
    await signInForm().getByLabel("Password", { exact: true }).getAttribute("type"),
    "text",
  );
  assert.equal(await signInForm().getByLabel("Password", { exact: true }).inputValue(), password);
  await signInForm().getByRole("button", { name: "Hide password", exact: true }).click();
  assert.equal(
    await signInForm().getByLabel("Password", { exact: true }).getAttribute("type"),
    "password",
  );
  passed(
    "The labelled password visibility control reveals and hides the same value without submitting the form.",
  );

  await signInSuccessfully();
  passed(
    "Successful sign-in loads the store; rapid submissions send one request and all credentials are locked while it is pending.",
  );

  queue("/auth/sign-out", { status: 503, message: "Synthetic sign-out connection failed." });
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page
    .getByRole("alert")
    .filter({ hasText: "Synthetic sign-out connection failed." })
    .waitFor();
  assert.equal(await page.getByRole("button", { name: "Sign out", exact: true }).isEnabled(), true);
  const stillSignedIn = await page.evaluate(
    async () => (await import("/src/lib/store.ts")).useAppStore.getState().session?.userId,
  );
  assert.equal(stillSignedIn, owner.userId);
  passed(
    "A genuine sign-out failure keeps the session visible, reports the failure and allows retry.",
  );

  const signOutGate = deferred();
  const beforeSignOut = count("/auth/sign-out");
  const signOutReceived = queue("/auth/sign-out", { data: { signedOut: true }, gate: signOutGate });
  await page.getByRole("button", { name: "Sign out", exact: true }).evaluate((button) => {
    button.click();
    button.click();
  });
  await page.getByRole("button", { name: /Signing out/ }).waitFor();
  await signOutReceived;
  assert.equal(count("/auth/sign-out"), beforeSignOut + 1);
  assert.equal(await page.getByRole("button", { name: /Signing out/ }).isDisabled(), true);
  signOutGate.resolve();
  await waitForSignIn();
  const signedOut = await page.evaluate(async () => {
    const state = (await import("/src/lib/store.ts")).useAppStore.getState();
    return {
      session: state.session,
      products: state.products.length,
      sales: state.sales.length,
      movements: state.inventoryMovements.length,
      storeName: state.settings.storeName,
    };
  });
  assert.equal(signedOut.session, null);
  assert.equal(signedOut.products + signedOut.sales + signedOut.movements, 0);
  assert.notEqual(signedOut.storeName, "Synthetic Auth Store");
  passed(
    "Sign-out locks during the request, ignores rapid repeat clicks and clears store records and business settings on success.",
  );

  await page.getByRole("button", { name: "Create account", exact: true }).click();
  const signup = page.locator("#sign-up-form");
  await signup.waitFor();
  assert.equal(await signup.getByLabel("Password", { exact: true }).inputValue(), "");
  await signup.getByLabel("Your name", { exact: true }).fill("Synthetic Auth Owner");
  await signup.getByLabel("Email", { exact: true }).fill(owner.email);
  await signup.getByLabel("Password", { exact: true }).fill(password);
  await signup.getByLabel("Confirm password", { exact: true }).fill(`${password} mismatch`);
  await signup.getByLabel("Store name", { exact: true }).fill("Synthetic Auth Store");
  await signup.getByRole("button", { name: "Create my store", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "Passwords do not match." }).waitFor();
  assert.equal(count("/auth/sign-up"), 0);
  passed(
    "Create account starts without a retained sign-in password and blocks mismatched passwords before sending anything.",
  );

  await signup.getByLabel("Confirm password", { exact: true }).fill(password);
  await signup.getByLabel("Records you plan to use", { exact: true }).selectOption("partner");
  await signup.getByRole("button", { name: "Create my store", exact: true }).click();
  assert.equal(
    count("/auth/sign-up"),
    0,
    "Real-business provenance requires explicit authorization",
  );
  await signup
    .getByRole("checkbox", { name: "I have permission to store this business's records." })
    .check();
  queue("/auth/sign-up", { status: 409, message: "Synthetic account already exists." });
  await signup.getByRole("button", { name: "Create my store", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "Synthetic account already exists." }).waitFor();
  assert.equal(
    await signup.getByLabel("Your name", { exact: true }).inputValue(),
    "Synthetic Auth Owner",
  );
  assert.equal(
    await signup.getByRole("button", { name: "Create my store", exact: true }).isEnabled(),
    true,
  );
  passed(
    "Real-business signup requires permission; a server rejection preserves store details and unlocks retry.",
  );

  await signup.getByLabel("Records you plan to use", { exact: true }).selectOption("demo");
  const signupGate = deferred();
  const beforeSignup = count("/auth/sign-up");
  const signupReceived = queue("/auth/sign-up", { data: owner, status: 201, gate: signupGate });
  await doubleSubmit(signup);
  await page.getByRole("button", { name: /Creating your store/ }).waitFor();
  await signupReceived;
  assert.equal(count("/auth/sign-up"), beforeSignup + 1);
  assert.equal(await signup.getByLabel("Store name", { exact: true }).isDisabled(), true);
  signupGate.resolve();
  await page.getByRole("button", { name: "Sign out", exact: true }).waitFor();
  passed(
    "Account creation locks its fields, sends one request for rapid submits and opens the returned empty store.",
  );
  await signOutSuccessfully();

  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await signup.getByLabel("Your name", { exact: true }).fill("Synthetic Created Once Owner");
  await signup.getByLabel("Email", { exact: true }).fill("created-once@example.test");
  await signup.getByLabel("Password", { exact: true }).fill(password);
  await signup.getByLabel("Confirm password", { exact: true }).fill(password);
  await signup.getByLabel("Store name", { exact: true }).fill("Synthetic Created Once Store");
  const beforeCreatedOnce = count("/auth/sign-up");
  queue("/auth/sign-up", { data: owner, status: 201 });
  failNextSettingsRead = true;
  await signup.getByRole("button", { name: "Create my store", exact: true }).click();
  await waitForSignIn();
  await page
    .getByRole("alert")
    .filter({ hasText: "Your account was created, but store records could not be loaded." })
    .waitFor();
  assert.equal(await signInForm().getByLabel("Password", { exact: true }).inputValue(), "");
  assert.equal(count("/auth/sign-up"), beforeCreatedOnce + 1);
  await page.reload({ waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.getByRole("button", { name: "Sign out", exact: true }).waitFor();
  assert.equal(
    count("/auth/sign-up"),
    beforeCreatedOnce + 1,
    "Reloading a saved account must not create another one",
  );
  passed(
    "A saved signup followed by a failed store read clears secrets, reports that the account exists and recovers on reload without repeating account creation.",
  );
  await signOutSuccessfully();

  await page.getByRole("button", { name: "Forgot password", exact: true }).click();
  const recovery = page.locator("#recovery-form");
  await recovery.waitFor();
  const recoveryEmail = recovery.getByLabel("Email", { exact: true });
  await recoveryEmail.fill("invalid-address");
  await recovery.getByRole("button", { name: "Send reset link", exact: true }).click();
  assert.equal(count("/auth/password/recovery"), 0);
  assert.equal(await recoveryEmail.evaluate((input) => input.validity.typeMismatch), true);
  await recoveryEmail.fill(owner.email);
  await recovery.locator("summary").click();
  const recoveryBusinessId = recovery.getByLabel("Business ID", { exact: false });
  await recoveryBusinessId.fill("invalid-business-id");
  await recovery.getByRole("button", { name: "Send reset link", exact: true }).click();
  assert.equal(count("/auth/password/recovery"), 0);
  assert.equal(await recoveryBusinessId.evaluate((input) => input.validity.patternMismatch), true);
  await recoveryBusinessId.fill("00000000-0000-4000-8000-000000000123");
  const recoveryGate = deferred();
  const recoveryReceived = queue("/auth/password/recovery", {
    data: { accepted: true },
    gate: recoveryGate,
  });
  await doubleSubmit(recovery);
  await page.getByRole("button", { name: /Sending/ }).waitFor();
  await recoveryReceived;
  assert.equal(count("/auth/password/recovery"), 1);
  assert.equal(requests.at(-1).body.businessId, "00000000-0000-4000-8000-000000000123");
  assert.equal(await recoveryEmail.isDisabled(), true);
  recoveryGate.resolve();
  await page
    .getByRole("status")
    .filter({ hasText: /If .*account|If .*email|reset link/i })
    .waitFor();
  assert.equal(
    await page.getByRole("alert").count(),
    0,
    "Successful recovery must not look like an error",
  );
  passed(
    "Password recovery validates email and optional Business ID, forwards the selected business, locks repeated requests and announces neutral success as status.",
  );

  queue("/auth/password/recovery", {
    status: 429,
    message: "Synthetic recovery limit reached. Try again later.",
  });
  await recovery.getByRole("button", { name: "Send reset link", exact: true }).click();
  await page
    .getByRole("alert")
    .filter({ hasText: "Synthetic recovery limit reached. Try again later." })
    .waitFor();
  assert.equal(
    await recovery.getByRole("button", { name: "Send reset link", exact: true }).isEnabled(),
    true,
  );
  assert.equal(
    await page
      .getByRole("status")
      .filter({ hasText: /reset link/i })
      .count(),
    0,
  );
  await page.getByRole("button", { name: "Back to sign in", exact: true }).click();
  await waitForSignIn();
  assert.equal(await page.getByRole("alert").count(), 0);
  assert.equal(await signInForm().getByLabel("Password", { exact: true }).inputValue(), "");
  passed(
    "Recovery failures replace stale success, unlock retry and clear when returning to sign in.",
  );

  await navigate("/?reset=synthetic-reset-token-with-sufficient-length");
  await page.getByRole("heading", { name: "Choose a new password", exact: true }).waitFor();
  const tokenForm = () =>
    page.locator("form").filter({ has: page.getByLabel("New password", { exact: true }) });
  await tokenForm().getByLabel("New password", { exact: true }).fill(password);
  await tokenForm().getByLabel("Confirm password", { exact: true }).fill(`${password} mismatch`);
  await tokenForm().getByRole("button", { name: "Reset password", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "Passwords do not match." }).waitFor();
  assert.equal(count("/auth/password/recovery/complete"), 0);
  await tokenForm().getByLabel("Confirm password", { exact: true }).fill(password);
  queue("/auth/password/recovery/complete", {
    status: 400,
    message: "Synthetic reset link is expired.",
  });
  await tokenForm().getByRole("button", { name: "Reset password", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "Synthetic reset link is expired." }).waitFor();
  assert.equal(
    await tokenForm().getByRole("button", { name: "Reset password", exact: true }).isEnabled(),
    true,
  );
  const resetGate = deferred();
  const resetReceived = queue("/auth/password/recovery/complete", {
    data: { changed: true },
    gate: resetGate,
  });
  const beforeReset = count("/auth/password/recovery/complete");
  await doubleSubmit(tokenForm());
  await page.getByRole("button", { name: /Saving/ }).waitFor();
  await resetReceived;
  assert.equal(count("/auth/password/recovery/complete"), beforeReset + 1);
  assert.equal(await tokenForm().getByLabel("New password", { exact: true }).isDisabled(), true);
  resetGate.resolve();
  await page.getByRole("heading", { name: "Password updated", exact: true }).waitFor();
  await page.getByRole("button", { name: "Back to sign in", exact: true }).click();
  await waitForSignIn();
  assert.equal(new URL(page.url()).searchParams.has("reset"), false);
  passed(
    "Reset links have labelled fields, mismatch and expired-link feedback, one locked request and return to sign in without retaining the token.",
  );

  await navigate("/?invitation=synthetic-invitation-token-with-sufficient-length");
  await page.getByRole("heading", { name: "Accept staff invitation", exact: true }).waitFor();
  await tokenForm().getByLabel("New password", { exact: true }).fill(password);
  await tokenForm().getByLabel("Confirm password", { exact: true }).fill(password);
  const invitationGate = deferred();
  const invitationReceived = queue("/auth/staff/invitations/accept", {
    data: { ...owner, role: "staff" },
    status: 201,
    gate: invitationGate,
  });
  await doubleSubmit(tokenForm());
  await page.getByRole("button", { name: /Saving/ }).waitFor();
  await invitationReceived;
  assert.equal(count("/auth/staff/invitations/accept"), 1);
  assert.equal(
    await tokenForm().getByLabel("Confirm password", { exact: true }).isDisabled(),
    true,
  );
  invitationGate.resolve();
  await page.getByRole("button", { name: "Sign out", exact: true }).waitFor();
  assert.equal(new URL(page.url()).searchParams.has("invitation"), false);
  passed(
    "Staff invitation uses the same labelled, locked password form and opens its returned session after one acceptance request.",
  );
  currentSession = null;
  queue("/auth/sign-out", { status: 401, message: "Synthetic session already expired." });
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await waitForSignIn();
  assert.equal(await page.getByRole("alert").count(), 0);
  passed(
    "Signing out an already expired session returns to sign in without leaving the store visible or showing a false failure.",
  );

  currentSession = owner;
  const beforeAuthenticatedReset = count("/auth/password/recovery/complete");
  await navigate("/?reset=synthetic-authenticated-reset-token-with-sufficient-length");
  await page.getByRole("heading", { name: "Choose a new password", exact: true }).waitFor();
  await page.getByRole("button", { name: "Back to StockCast", exact: true }).waitFor();
  await page.getByRole("button", { name: "Back to StockCast", exact: true }).click();
  await page.getByRole("button", { name: "Sign out", exact: true }).waitFor();
  assert.equal(count("/auth/password/recovery/complete"), beforeAuthenticatedReset);
  assert.equal(new URL(page.url()).searchParams.has("reset"), false);
  passed(
    "A reset link opened with a restored session labels its exit Back to StockCast, clears the token on exit and preserves the session without changing a password.",
  );
  await signOutSuccessfully();

  await page.setViewportSize({ width: 320, height: 740 });
  for (const screen of ["sign-in", "sign-up", "recovery"]) {
    if (screen === "sign-up")
      await page.getByRole("button", { name: "Create account", exact: true }).click();
    if (screen === "recovery") {
      await page
        .getByRole("group", { name: "Account access", exact: true })
        .getByRole("button", { name: "Sign in", exact: true })
        .click();
      await page.getByRole("button", { name: "Forgot password", exact: true }).click();
    }
    const dimensions = await page.evaluate(() => ({
      viewport: innerWidth,
      body: document.documentElement.scrollWidth,
    }));
    assert.ok(
      dimensions.body <= dimensions.viewport + 1,
      `${screen} must not overflow at 320px: ${JSON.stringify(dimensions)}`,
    );
  }
  passed(
    "Sign-in, account creation and password recovery fit a 320-pixel mobile viewport without horizontal scrolling.",
  );
  await page.screenshot({
    path: resolve(output, "auth-mobile-recovery-passed.png"),
    fullPage: true,
  });

  assert.deepEqual(evidence.unexpectedRequests, []);
  assert.deepEqual(evidence.pageErrors, []);
  evidence.passed = true;
  console.log(
    `All ${evidence.checks.length} authentication browser checks passed; every API request was intercepted.`,
  );
} catch (error) {
  evidence.passed = false;
  evidence.error = error.stack;
  if (page) {
    evidence.renderedBody = await page
      .locator("body")
      .innerText({ timeout: 5000 })
      .catch(() => "Unavailable");
    await page
      .screenshot({ path: resolve(output, "auth-browser-failed.png"), fullPage: true })
      .catch(() => {});
  }
  console.error(error);
  process.exitCode = 1;
} finally {
  pendingGates.forEach((gate) => gate.resolve());
  await writeFile(resolve(output, "auth-browser-result.json"), JSON.stringify(evidence, null, 2));
  await browser?.close();
  await server.close();
}
