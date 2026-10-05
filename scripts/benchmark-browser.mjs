import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { cpus, platform, release, totalmem } from "node:os";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";

const workspace = fileURLToPath(new URL("../", import.meta.url));
const delay = (ms) => new Promise((done) => setTimeout(done, ms));

function withinWorkspace(path) {
  const resolved = resolve(workspace, path);
  const remainder = relative(workspace, resolved);
  if (!remainder || remainder.startsWith("..") || isAbsolute(remainder))
    throw new Error("Browser artifact paths must stay inside the repository");
  return resolved;
}

export function readPrivateEnvironment(path) {
  const values = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    const value = match[2].trim();
    values[match[1]] = value.startsWith('"') && value.endsWith('"')
      ? value.slice(1, -1)
      : value.startsWith("'") && value.endsWith("'") ? value.slice(1, -1) : value;
  }
  return values;
}

export function summarizeSamples(samples) {
  if (!samples.length) return null;
  const sorted = samples.map((sample) => sample.elapsedMs).sort((a, b) => a - b);
  const percentile = (p) => sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)];
  return { count: sorted.length, median: percentile(0.5), p95: percentile(0.95), min: sorted[0], max: sorted.at(-1) };
}

export class CdpConnection {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id) {
        const item = this.pending.get(message.id);
        if (!item) return;
        this.pending.delete(message.id);
        clearTimeout(item.timeout);
        if (message.error) item.reject(new Error(`Browser protocol command failed: ${item.method}`));
        else item.resolve(message.result);
      } else {
        for (const listener of this.listeners.get(message.method) ?? []) listener(message.params);
      }
    });
    socket.addEventListener("close", (event) => {
      for (const item of this.pending.values()) {
        clearTimeout(item.timeout);
        item.reject(new Error(`Browser protocol connection closed (code ${event.code}; pending ${item.method})`));
      }
      this.pending.clear();
    });
  }

  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((done, reject) => {
      const timeout = setTimeout(() => reject(new Error("Browser protocol connection timed out")), 15_000);
      socket.addEventListener("open", () => { clearTimeout(timeout); done(); }, { once: true });
      socket.addEventListener("error", () => { clearTimeout(timeout); reject(new Error("Browser protocol connection failed")); }, { once: true });
    });
    return new CdpConnection(socket);
  }

  on(method, listener) {
    const listeners = this.listeners.get(method) ?? [];
    listeners.push(listener);
    this.listeners.set(method, listeners);
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((done, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Browser protocol command timed out: ${method}`));
      }, 45_000);
      this.pending.set(id, { resolve: done, reject, timeout, method });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error("Browser page evaluation failed");
    return result.result.value;
  }

  async waitFor(expression, label, timeoutMs = 30_000) {
    const start = performance.now();
    while (performance.now() - start < timeoutMs) {
      try {
        if (await this.evaluate(`Boolean(${expression})`)) {
          await this.evaluate("new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)))");
          return;
        }
      } catch {
        // A navigation destroys the prior execution context. Retry in the new document.
      }
      await delay(50);
    }
    throw new Error(`Browser readiness timed out: ${label}`);
  }

  async click(expression) {
    const position = await this.evaluate(`(() => {
      const element = ${expression};
      if (!element || element.disabled) return null;
      element.scrollIntoView({block: "center", inline: "center"});
      const rect = element.getBoundingClientRect();
      return rect.width && rect.height ? {x: rect.x + rect.width / 2, y: rect.y + rect.height / 2} : null;
    })()`);
    if (!position) throw new Error("Browser control is missing, hidden, or disabled");
    await this.send("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, ...position });
    await this.send("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, ...position });
  }

  async key(key, extra = {}) {
    await this.send("Input.dispatchKeyEvent", { type: "keyDown", key, ...extra });
    await this.send("Input.dispatchKeyEvent", { type: "keyUp", key, ...extra });
  }

  async type(selector, value) {
    await this.click(`document.querySelector(${JSON.stringify(selector)})`);
    await this.key("a", { code: "KeyA", windowsVirtualKeyCode: 65, modifiers: 2 });
    await this.send("Input.insertText", { text: value });
  }
}

export async function launchEdge({ executable, artifactsDirectory, onStage = () => {} }) {
  if (!existsSync(executable)) throw new Error("Microsoft Edge executable was not found; use --edge");
  const artifacts = withinWorkspace(artifactsDirectory);
  mkdirSync(artifacts, { recursive: true });
  const profile = mkdtempSync(resolve(artifacts, "edge-profile-"));
  onStage("edge-process-start");
  const child = spawn(executable, [
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    "--disable-extensions", "--remote-debugging-address=127.0.0.1", "--remote-debugging-port=0",
    `--user-data-dir=${profile}`, "--window-size=1440,1100", "about:blank",
  ], { windowsHide: true, stdio: "ignore" });
  let launchFailed = false;
  child.on("error", () => { launchFailed = true; });
  let browser;
  try {
    const portFile = resolve(profile, "DevToolsActivePort");
    const started = performance.now();
    let port;
    while (!port) {
      if (launchFailed || child.exitCode !== null) throw new Error("Microsoft Edge did not start");
      if (performance.now() - started > 30_000) throw new Error("Microsoft Edge startup timed out");
      try {
        const candidate = readFileSync(portFile, "utf8").split(/\r?\n/)[0];
        if (/^\d+$/.test(candidate)) port = candidate;
      } catch (failure) {
        if (!["ENOENT", "EBUSY", "EACCES"].includes(failure.code)) throw new Error("Microsoft Edge debugging port could not be read");
      }
      if (port) break;
      await delay(100);
    }
    onStage("devtools-port-ready");
    const endpoint = `http://127.0.0.1:${port}`;
    const version = await (await fetch(`${endpoint}/json/version`)).json();
    onStage("devtools-version-read");
    browser = await CdpConnection.connect(version.webSocketDebuggerUrl);
    onStage("browser-websocket-connected");
    const target = await browser.send("Target.createTarget", { url: "about:blank" });
    onStage("browser-target-created");
    const pages = await (await fetch(`${endpoint}/json/list`)).json();
    const page = await CdpConnection.connect(pages.find((item) => item.id === target.targetId).webSocketDebuggerUrl);
    onStage("page-websocket-connected");
    await page.send("Page.enable");
    onStage("page-domain-enabled");
    await page.send("Runtime.enable");
    onStage("runtime-domain-enabled");
    await page.send("Network.enable");
    onStage("network-domain-enabled");
    await page.send("Page.addScriptToEvaluateOnNewDocument", { source: `
      window.__stockcastBrowserMetrics = {longTasks: []};
      try { new PerformanceObserver(list => {
        for (const entry of list.getEntries()) window.__stockcastBrowserMetrics.longTasks.push({startTime: entry.startTime, duration: entry.duration});
      }).observe({entryTypes: ["longtask"]}); } catch {}
    ` });
    onStage("browser-ready");
    return {
      page, profile,
      software: { edge: version.Browser, protocol: version["Protocol-Version"], javascript: version["V8-Version"] },
      async close() {
        try { await browser.send("Browser.close"); } catch { /* Browser can close before replying. */ }
        page.socket.close();
        browser.socket.close();
        if (child.exitCode === null) child.kill();
      },
    };
  } catch (failure) {
    browser?.socket.close();
    if (child.exitCode === null) child.kill();
    throw failure;
  }
}

const control = (selector, text) =>
  `[...document.querySelectorAll(${JSON.stringify(selector)})].find(element => element.textContent.trim() === ${JSON.stringify(text)} && element.getBoundingClientRect().height)`;
const nav = (path) => `[...document.querySelectorAll('nav a')].find(element => new URL(element.href).pathname === ${JSON.stringify(path)} && element.getBoundingClientRect().height)`;
const dashboardReady = "document.querySelector('main h1')?.textContent.includes('Morning briefing') && !document.querySelector('main')?.textContent.includes('Loading current demand estimates')";
const productsReady = "document.querySelector('input[aria-label=\"Search inventory products\"]')";
const staffReady = `${control("button", "Refresh staff list")} && !document.querySelector('main')?.textContent.includes('Loading staff access')`;

function parseArguments(args) {
  const options = { base: "http://localhost:18089", repetitions: 10, role: "owner", edge: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", artifacts: "benchmarks/browser", retry: false };
  for (let i = 0; i < args.length; i++) {
    const name = args[i];
    if (name === "--exercise-member-retry") options.retry = true;
    else if (name === "--synthetic") options.synthetic = true;
    else {
      const mapping = { "--base": "base", "--env-file": "envFile", "--output": "output", "--artifacts": "artifacts", "--edge": "edge", "--repetitions": "repetitions", "--expected-role": "role", "--environment": "environment" };
      if (!mapping[name] || !args[i + 1] || args[i + 1].startsWith("--")) throw new Error("Unknown or incomplete browser benchmark option");
      options[mapping[name]] = args[++i];
    }
  }
  options.repetitions = Number(options.repetitions);
  if (!Number.isInteger(options.repetitions) || options.repetitions < 1 || options.repetitions > 100) throw new Error("--repetitions must be 1..100");
  if (!options.envFile || !options.synthetic) throw new Error("Use --env-file and --synthetic for a dedicated synthetic account");
  if (!["owner", "staff"].includes(options.role)) throw new Error("--expected-role must be owner or staff");
  const base = new URL(options.base);
  if (!["http:", "https:"].includes(base.protocol) || base.username || base.password || base.search || base.hash) throw new Error("--base must be an HTTP origin without credentials or query values");
  options.base = base.origin;
  options.output ??= `${options.artifacts}/browser-${Date.now()}.json`;
  return options;
}

export async function runBrowserBenchmark(options) {
  const environment = readPrivateEnvironment(withinWorkspace(options.envFile));
  const email = environment.BENCHMARK_EMAIL ?? environment.OWNER_EMAIL;
  const password = environment.BENCHMARK_PASSWORD ?? environment.OWNER_PASSWORD;
  if (!email || !password) throw new Error("Private environment needs BENCHMARK_EMAIL/BENCHMARK_PASSWORD or OWNER_EMAIL/OWNER_PASSWORD");
  const report = {
    schemaVersion: 1, measuredAt: new Date().toISOString(), outcome: "running",
    provenance: "Actual browser observations using a dedicated synthetic account; no client evaluation findings",
    environmentLabel: options.environment ?? "isolated-local-compose",
    targetOrigin: options.base, expectedRole: options.role, repetitions: options.repetitions,
    measurement: "Controller elapsed time from navigation/input dispatch to the documented DOM-ready condition and two animation frames; includes CDP and readiness-poll overhead. Cold launch is separate; repeated reloads retain HTTP cache and the session.",
    host: { platform: platform(), release: release(), cpuModel: cpus()[0]?.model, logicalCpuCount: cpus().length, totalRamBytes: totalmem() },
    software: { node: process.version }, samples: [], summariesMs: {}, checks: [], injectedFailures: [], stages: [],
  };
  const output = withinWorkspace(options.output);
  mkdirSync(dirname(output), { recursive: true });
  let edge;
  try {
    edge = await launchEdge({ executable: options.edge, artifactsDirectory: options.artifacts,
      onStage(stage) { report.stage = stage; report.stages.push({ stage, at: new Date().toISOString() }); },
    });
  } catch (failure) {
    report.outcome = "failed";
    report.failure = failure.message;
    report.finishedAt = new Date().toISOString();
    writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
    console.log(`Browser observations saved: ${relative(workspace, output)}`);
    throw failure;
  }
  const page = edge.page;
  report.software = { ...report.software, ...edge.software };
  const network = new Map();
  const networkSamples = [];
  page.on("Network.requestWillBeSent", (request) => {
    if (!request.request.url.startsWith(`${options.base}/api/v1/`)) return;
    const path = new URL(request.request.url).pathname.replace(/\/businesses\/[0-9a-f-]+/gi, "/businesses/:businessId").replace(/\/products\/[0-9a-f-]+/gi, "/products/:productId");
    network.set(request.requestId, { path, method: request.request.method, started: request.timestamp });
  });
  page.on("Network.responseReceived", (event) => {
    const sample = network.get(event.requestId);
    if (sample) sample.status = event.response.status;
  });
  page.on("Network.loadingFinished", (event) => {
    const sample = network.get(event.requestId);
    if (sample) networkSamples.push({ path: sample.path, method: sample.method, status: sample.status, elapsedMs: (event.timestamp - sample.started) * 1000, encodedBytes: event.encodedDataLength });
    network.delete(event.requestId);
  });
  page.on("Network.loadingFailed", (event) => {
    const sample = network.get(event.requestId);
    if (sample) networkSamples.push({ path: sample.path, method: sample.method, outcome: "network-failure", deliberatelyBlocked: event.blockedReason === "inspector" });
    network.delete(event.requestId);
  });
  const measure = async (name, iteration, action, ready) => {
    report.stage = name;
    report.stages.push({ stage: name, iteration, at: new Date().toISOString() });
    const started = performance.now();
    await action();
    await page.waitFor(ready, name);
    report.samples.push({ action: name, iteration, elapsedMs: performance.now() - started });
  };
  const captureNavigation = () => page.evaluate(`(() => {
    const navigation = performance.getEntriesByType('navigation')[0];
    return {
      navigation: navigation ? {type: navigation.type, responseEndMs: navigation.responseEnd, domContentLoadedMs: navigation.domContentLoadedEventEnd, loadMs: navigation.loadEventEnd, transferBytes: navigation.transferSize} : null,
      paints: performance.getEntriesByType('paint').map(entry => ({name: entry.name, startTimeMs: entry.startTime})),
      longTasks: window.__stockcastBrowserMetrics?.longTasks ?? []
    };
  })()`);
  try {
    await measure("cold-sign-in-page", 1, () => page.send("Page.navigate", { url: options.base }), "document.querySelector('#auth-email') && document.querySelector('#auth-password')");
    report.coldPage = await captureNavigation();
    await page.type("#auth-email", email);
    await page.type("#auth-password", password);
    await measure("sign-in-submit-to-dashboard", 1, () => page.click("document.querySelector('#sign-in-form button[type=submit]')"), dashboardReady);
    report.checks.push({ name: "real-sign-in-form-and-dashboard", passed: true });
    const workload = await page.evaluate(`(async () => {
      const me = await (await fetch('/api/v1/auth/me', {credentials: 'include'})).json();
      if (!me.data?.businessId) return null;
      const prefix = '/api/v1/businesses/' + me.data.businessId;
      const business = await (await fetch(prefix, {credentials: 'include'})).json();
      const products = await (await fetch(prefix + '/products', {credentials: 'include'})).json();
      const dashboard = await (await fetch(prefix + '/forecast-dashboard', {credentials: 'include'})).json();
      return { role: me.data.role, dataOrigin: business.data?.dataOrigin, productCount: products.data?.length,
        activeProductCount: products.data?.filter(product => product.isActive !== false).length,
        savedPredictionCount: dashboard.data?.predictions?.length, latestRunStatus: dashboard.data?.latestRun?.status ?? 'none',
        savedRunStatus: dashboard.data?.run?.status ?? 'none' };
    })()`);
    if (!workload || workload.role !== options.role || workload.dataOrigin !== "demo") throw new Error("Browser account must match the expected role and synthetic data provenance");
    report.workload = workload;
    for (let iteration = 1; iteration <= options.repetitions; iteration++) {
      await measure("authenticated-dashboard-reload", iteration, () => page.send("Page.navigate", { url: options.base }), dashboardReady);
      report.samples.at(-1).browser = await captureNavigation();
      await measure("inventory-navigation", iteration, () => page.click(nav("/inventory")), productsReady);
      await measure("product-status-filter-all", iteration, async () => {
        await page.click("document.querySelector('select[aria-label=\"Filter products by active status\"]')");
        await page.key("End", { code: "End", windowsVirtualKeyCode: 35 });
        await page.key("Enter", { code: "Enter", windowsVirtualKeyCode: 13 });
      }, "document.querySelector('select[aria-label=\"Filter products by active status\"]')?.value === 'all'");
      await measure("stock-ledger-navigation", iteration, () => page.click(control("[role=tab]", "Stock movements")), "document.querySelector('input[aria-label=\"Search stock movements\"]') && !document.querySelector('main')?.textContent.includes('Loading stock movements') && !document.querySelector('main [role=alert]')");
      await measure("account-tab-and-member-load", iteration, () => page.click(control("[role=tab]", options.role === "owner" ? "Account & settings" : "Account")), options.role === "owner" ? staffReady : "document.querySelector('#account-current-password') && !document.querySelector('#invite-staff-email')");
      if (options.role === "owner")
        await measure("staff-list-refresh", iteration, () => page.click(control("button", "Refresh staff list")), staffReady);
    }
    report.checks.push({ name: "inventory-products-and-stock-ledger-navigation", passed: true });
    report.checks.push({ name: options.role === "owner" ? "owner-staff-list-load-and-refresh" : "staff-personal-account-without-owner-controls", passed: true });
    if (options.retry && options.role === "owner") {
      await page.send("Network.setBlockedURLs", { urls: [`${options.base}/api/v1/auth/members*`] });
      await page.click(control("button", "Refresh staff list"));
      await page.waitFor(control("button", "Retry loading staff"), "injected-member-read-failure");
      await page.send("Network.setBlockedURLs", { urls: [] });
      await measure("member-retry-after-injected-network-failure", 1, () => page.click(control("button", "Retry loading staff")), staffReady);
      report.injectedFailures.push({ operation: "GET /api/v1/auth/members", method: "Edge request blocking", errorVisible: true, actualRetrySucceeded: true });
      report.checks.push({ name: "visible-member-error-and-successful-retry", passed: true });
    }
    report.outcome = "passed";
  } catch (failure) {
    report.outcome = "failed";
    report.failure = failure.message;
    throw failure;
  } finally {
    report.finishedAt = new Date().toISOString();
    report.networkSamples = networkSamples;
    for (const name of new Set(report.samples.map((sample) => sample.action)))
      report.summariesMs[name] = summarizeSamples(report.samples.filter((sample) => sample.action === name));
    await edge.close();
    writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
    console.log(`Browser observations saved: ${relative(workspace, output)}`);
    console.log(`Outcome: ${report.outcome}; completed actions: ${report.samples.length}`);
  }
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { await runBrowserBenchmark(parseArguments(process.argv.slice(2))); }
  catch (failure) { console.error(failure.message); process.exitCode = 1; }
}
