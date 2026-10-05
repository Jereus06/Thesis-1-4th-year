import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { cpus, freemem, totalmem, platform, release } from "node:os";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

export function parseOptions(args = process.argv.slice(2), environment = process.env) {
  const definitions = {
    "base-url": environment.BENCHMARK_URL ?? "http://localhost:8080",
    output: environment.BENCHMARK_OUTPUT ?? `benchmarks/api-${Date.now()}.json`,
    samples: environment.BENCHMARK_REPETITIONS ?? "30",
    products: "8",
    days: "180",
    movements: "24",
    concurrency: "2",
    "max-runs": "5",
    "timeout-seconds": "600",
    environment: environment.BENCHMARK_ENVIRONMENT ?? "isolated-synthetic-test-deployment",
  };
  const { values } = parseArgs({
    args,
    options: {
      ...Object.fromEntries(
        Object.entries(definitions).map(([key, value]) => [
          key,
          { type: "string", default: value },
        ]),
      ),
      "environment-file": { type: "string" },
      help: { type: "boolean" },
    },
  });
  const integer = (key, min, max) => {
    const value = Number(values[key]);
    if (!Number.isInteger(value) || value < min || value > max)
      throw new Error(`--${key} must be ${min}..${max}.`);
    return value;
  };
  const base = new URL(values["base-url"]);
  if (
    !["http:", "https:"].includes(base.protocol) ||
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    base.pathname !== "/"
  )
    throw new Error(
      "--base-url must be an HTTP origin without credentials, path, query, or fragment.",
    );
  return {
    base: base.origin,
    output: values.output,
    samples: integer("samples", 5, 1000),
    products: integer("products", 1, 20),
    days: integer("days", 134, 730),
    movements: integer("movements", 0, 2000),
    concurrency: integer("concurrency", 1, 8),
    maxRuns: integer("max-runs", 1, 20),
    timeoutMs: integer("timeout-seconds", 30, 3600) * 1000,
    environmentLabel: values.environment,
    environmentFile: values["environment-file"],
    help: values.help,
  };
}

export function latencySummary(samples) {
  const sorted = samples.map((sample) => sample.latencyMs).sort((a, b) => a - b);
  if (!sorted.length) return { count: 0, median: null, p95: null, min: null, max: null };
  const middle = Math.floor(sorted.length / 2);
  return {
    count: sorted.length,
    median: sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2,
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
    min: sorted[0],
    max: sorted.at(-1),
  };
}

function environmentMetadata(path) {
  let input = {};
  if (path)
    try {
      input = JSON.parse(readFileSync(path, "utf8"));
      if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error();
    } catch {
      throw new Error("Could not read the optional safe environment metadata JSON.");
    }
  // Copy only version/resource fields, never a generic environment or Docker-inspect dump.
  const software = {};
  for (const key of [
    "python",
    "fastapi",
    "psycopg",
    "postgresql",
    "xgboost",
    "numpy",
    "caddy",
    "docker",
    "dockerCompose",
  ])
    if (
      typeof input.software?.[key] === "string" &&
      /^[a-zA-Z0-9.+() _-]{1,100}$/.test(input.software[key])
    )
      software[key] = input.software[key];
  const containerLimits = {};
  for (const service of ["api", "worker", "db", "web"])
    if (input.containerLimits?.[service]) {
      containerLimits[service] = {};
      for (const key of ["cpus", "memoryBytes"]) {
        const value = input.containerLimits[service][key];
        if (value === null || (Number.isFinite(value) && value >= 0))
          containerLimits[service][key] = value;
      }
    }
  const versionMap = (entry) =>
    Object.fromEntries(
      [
        "node",
        "python",
        "fastapi",
        "psycopg",
        "postgresql",
        "xgboost",
        "numpy",
        "caddy",
        "docker",
        "dockerCompose",
      ]
        .filter(
          (key) =>
            typeof entry?.[key] === "string" && /^[a-zA-Z0-9.+() _-]{1,100}$/.test(entry[key]),
        )
        .map((key) => [key, entry[key]]),
    );
  const containerRuntime = {};
  for (const service of ["api", "worker", "db", "web"])
    if (input.containerRuntime?.[service])
      containerRuntime[service] = versionMap(input.containerRuntime[service]);
  const docker = {};
  for (const key of ["serverVersion", "operatingSystem", "architecture"])
    if (
      typeof input.docker?.[key] === "string" &&
      /^[a-zA-Z0-9.+() _-]{1,100}$/.test(input.docker[key])
    )
      docker[key] = input.docker[key];
  for (const key of ["logicalCpus", "allocatedMemoryBytes"])
    if (Number.isFinite(input.docker?.[key]) && input.docker[key] >= 0)
      docker[key] = input.docker[key];
  return {
    software,
    containerLimits,
    hostVerificationRuntime: versionMap(input.hostVerificationRuntime),
    containerRuntime,
    docker,
  };
}

export async function runBenchmark(options, fetcher = fetch) {
  const supplied = environmentMetadata(options.environmentFile);
  const cookies = new Map();
  let password = randomBytes(32).toString("base64url"),
    email = `benchmark-${randomUUID()}@example.com`,
    signedIn = false,
    business;
  const report = {
    schemaVersion: 2,
    measuredAt: new Date().toISOString(),
    complete: false,
    target: options.base,
    environmentLabel: options.environmentLabel,
    provenance:
      "Deterministic generated performance workload in a newly registered demo-origin store; no partner/client records.",
    methodology: {
      latency: "Fetch through complete response body; worker-status probes excluded.",
      percentile: "p95 nearest rank; median midpoint for even counts",
      concurrency: options.concurrency,
      requestedSamplesPerEndpointPerPhase: options.samples,
      maxActiveRuns: options.maxRuns,
      idle: "Dedicated store warm-up run completed before and after read batch; operator must isolate deployment.",
      workerRunning:
        "Same run returned running before and after entire read batch. Boundary batches are retained and excluded.",
    },
    host: {
      platform: platform(),
      release: release(),
      cpuModel: cpus()[0]?.model,
      logicalCpuCount: cpus().length,
      totalRamBytes: totalmem(),
      freeRamBytesAtStart: freemem(),
    },
    software: { node: process.version, ...supplied.software },
    containerLimits: supplied.containerLimits,
    hostVerificationRuntime: supplied.hostVerificationRuntime,
    containerRuntime: supplied.containerRuntime,
    docker: supplied.docker,
    workload: {
      products: options.products,
      calendarDays: options.days,
      historicalSalesRows: options.products * options.days,
      additionalStockMovements: options.movements,
      openingBalanceMovements: options.products,
      reviewedClassifications: 0,
      historySource:
        "Generated positive daily sales; historical imports preserve current inventory.",
    },
    runs: [],
    samples: [],
    summaries: {},
  };
  const request = async (path, { method = "GET", body, label = "API request" } = {}) => {
    const headers = { Origin: options.base };
    if (cookies.size)
      headers.Cookie = [...cookies].map(([key, value]) => `${key}=${value}`).join("; ");
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
      headers["Idempotency-Key"] = randomUUID();
      if (cookies.has("stockcast_csrf")) headers["X-CSRF-Token"] = cookies.get("stockcast_csrf");
    }
    const started = performance.now();
    let response;
    try {
      response = await fetcher(new URL(`/api/v1${path}`, options.base), {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(30000),
      });
    } catch {
      throw new Error(`${label}: request failed or timed out.`);
    }
    for (const item of response.headers.getSetCookie()) {
      const pair = item.split(";", 1)[0],
        separator = pair.indexOf("="),
        name = pair.slice(0, separator);
      if (["stockcast_session", "stockcast_csrf"].includes(name))
        cookies.set(name, pair.slice(separator + 1));
    }
    const buffer = await response.arrayBuffer();
    const measured = {
      latencyMs: Number((performance.now() - started).toFixed(3)),
      responseStatus: response.status,
      responseBytes: buffer.byteLength,
    };
    if (!response.ok) throw new Error(`${label}: HTTP ${response.status}.`);
    let parsed;
    try {
      parsed = JSON.parse(new TextDecoder().decode(buffer));
    } catch {
      throw new Error(`${label}: invalid JSON response.`);
    }
    return { data: parsed.data ?? parsed, measured };
  };
  const status = async (id) =>
    (await request(`/businesses/${business}/forecast-runs/${id}`, { label: "forecast status" }))
      .data;
  const finish = async (run, phase, deadline) => {
    for (;;) {
      const current = await status(run.id);
      if (["completed", "failed"].includes(current.status)) {
        report.runs.push({
          id: current.id,
          phase,
          status: current.status,
          timing: current.timing ?? {},
          implementation: current.algorithmName,
          algorithmVersion: current.algorithmVersion,
          eligibleProducts: Object.values(current.configuration?.products ?? {}).filter(
            (item) => item.eligible,
          ).length,
        });
        if (current.status === "failed")
          throw new Error("Forecast worker recorded a failed run; inspect its private server log.");
        return;
      }
      if (performance.now() > deadline)
        throw new Error("Timed out waiting for the real forecast worker.");
      await delay(250);
    }
  };
  let endpoints = [];
  try {
    const account = await request("/auth/sign-up", {
      method: "POST",
      label: "synthetic registration",
      body: {
        email,
        password,
        displayName: "Synthetic benchmark owner",
        businessName: "Synthetic performance benchmark",
        businessLocation: "Isolated test deployment",
        dataOrigin: "demo",
      },
    });
    business = account.data.businessId;
    signedIn = true;
    password = email = null;
    const base = `/businesses/${business}`;
    const day = (await request(base + "/forecast-dashboard", { label: "initial dashboard" })).data
        .businessDay,
      end = new Date(`${day}T00:00:00Z`);
    report.workload.lastHistoryDate = day;
    report.workload.firstHistoryDate = new Date(end.getTime() - (options.days - 1) * 86400000)
      .toISOString()
      .slice(0, 10);
    await request(base + "/inventory-imports", {
      method: "POST",
      label: "synthetic catalog",
      body: {
        rows: Array.from({ length: options.products }, (_, index) => ({
          sku: `BENCH-${index + 1}`,
          name: `Synthetic product ${index + 1}`,
          category: "Performance test",
          unit: "pc",
          currentStock: "1000",
          leadTimeDays: 3,
          safetyStock: "10",
          unitCost: "1",
        })),
      },
    });
    const products = (await request(base + "/products", { label: "catalog read" })).data;
    const rows = products.flatMap((product, productIndex) =>
      Array.from({ length: options.days }, (_, index) => ({
        sku: product.sku,
        saleDate: new Date(end.getTime() - (options.days - 1 - index) * 86400000)
          .toISOString()
          .slice(0, 10),
        quantity: String(12 + ((index + productIndex) % 7) + (Math.floor(index / 28) % 3)),
      })),
    );
    for (let index = 0; index < rows.length; index += 1000) {
      const imported = await request(base + "/data-imports", {
        method: "POST",
        label: "synthetic sales import",
        body: { source: "csv", rows: rows.slice(index, index + 1000) },
      });
      if (imported.data.acceptedRows !== Math.min(1000, rows.length - index))
        throw new Error("Synthetic import did not accept the complete workload.");
    }
    for (let index = 0; index < options.movements; index++)
      await request(base + "/inventory-movements", {
        method: "POST",
        label: "synthetic movement",
        body: {
          productId: products[index % products.length].id,
          movementDate: day,
          movementType: "receipt",
          quantityDelta: "1",
          note: "Synthetic performance workload",
        },
      });
    const settings = (await request(base + "/settings", { label: "benchmark settings" })).data;
    report.workload.settings = Object.fromEntries(
      [
        "movingAverageWindow",
        "forecastHorizonDays",
        "minimumHistoryWeeks",
        "minimumNonzeroDays",
        "cvFolds",
        "topNProducts",
        "timezone",
      ].map((key) => [key, settings[key]]),
    );
    const queue = async () =>
      (await request(base + "/forecast-refresh", { method: "POST", label: "normal Refresh" })).data;
    const warm = await queue();
    console.log("Synthetic workload created; waiting for the real warm-up forecast.");
    await finish(warm, "warm-up", performance.now() + options.timeoutMs);
    endpoints = [
      ["health", "/health"],
      ["dashboard", base + "/forecast-dashboard"],
      ["products", base + "/products"],
      ["settings", base + "/settings"],
      ["sales-first-page", base + "/sales?limit=100&offset=0"],
      ["stock-movements-first-page", base + "/inventory-movements?limit=100&offset=0"],
      ["forecast-runs-first-page", base + "/forecast-runs?limit=20&offset=0"],
      ["saved-forecast", base + `/forecast-runs/${warm.id}`],
      [
        "saved-predictions-first-page",
        base + `/forecast-runs/${warm.id}/predictions?limit=200&offset=0`,
      ],
      ["saved-metrics", base + `/forecast-runs/${warm.id}/metrics`],
    ];
    report.endpoints = endpoints.map(([label, path]) => ({
      label,
      method: "GET",
      path: path.replaceAll(business, "{businessId}").replaceAll(warm.id, "{runId}"),
    }));
    const count = (phase, label) =>
      report.samples.filter(
        (item) => item.phase === phase && item.endpoint === label && item.accepted,
      ).length;
    const incomplete = (phase) =>
      endpoints.some(([label]) => count(phase, label) < options.samples);
    const samplePhase = async (phase, run, deadline) => {
      let cursor = 0;
      while (incomplete(phase)) {
        if (performance.now() > deadline)
          throw new Error("Sampling exceeded the configured run timeout.");
        const before = await status(run.id),
          required = phase === "idle" ? "completed" : "running";
        if (before.status !== required) {
          if (before.status === "queued" && phase === "worker-running") {
            await delay(100);
            continue;
          }
          return before;
        }
        const batch = [];
        for (
          let checked = 0;
          checked < endpoints.length && batch.length < options.concurrency;
          checked++
        ) {
          const endpoint = endpoints[cursor++ % endpoints.length];
          if (count(phase, endpoint[0]) < options.samples) batch.push(endpoint);
        }
        const startedAt = new Date().toISOString();
        const results = await Promise.all(
          batch.map(async ([label, path]) => ({
            endpoint: label,
            ...(await request(path, { label })).measured,
          })),
        );
        const after = await status(run.id),
          accepted = after.status === required;
        report.samples.push(
          ...results.map((item) => ({
            ...item,
            phase,
            startedAt,
            workerRunId: run.id,
            workerStatusBefore: before.status,
            workerStatusAfter: after.status,
            accepted,
          })),
        );
        if (!accepted) return after;
      }
      return null;
    };
    console.log("Measuring authenticated idle reads.");
    if (await samplePhase("idle", warm, performance.now() + options.timeoutMs))
      throw new Error("Idle phase lost its completed-run condition.");
    for (let index = 0; index < options.maxRuns && incomplete("worker-running"); index++) {
      const run = await queue(),
        deadline = performance.now() + options.timeoutMs;
      console.log(`Measuring reads during real worker run ${index + 1}/${options.maxRuns}.`);
      await samplePhase("worker-running", run, deadline);
      await finish(run, "worker-running", deadline);
    }
    report.complete = !incomplete("idle") && !incomplete("worker-running");
    if (!report.complete)
      report.failure =
        "Finite run budget exhausted before every endpoint received the requested verified-running samples.";
  } catch (error) {
    report.failure = error.message;
  } finally {
    if (signedIn) {
      try {
        await request("/auth/sign-out", { method: "POST", label: "sign out" });
        report.sessionRevoked = true;
      } catch {
        report.sessionRevoked = false;
      }
    }
    cookies.clear();
    password = email = null;
    for (const phase of ["idle", "worker-running"])
      report.summaries[phase] = Object.fromEntries(
        endpoints.map(([label]) => [
          label,
          latencySummary(
            report.samples.filter(
              (item) => item.phase === phase && item.endpoint === label && item.accepted,
            ),
          ),
        ]),
      );
    report.completedAt = new Date().toISOString();
    report.host.freeRamBytesAtEnd = freemem();
    report.observationCounts = {
      accepted: report.samples.filter((item) => item.accepted).length,
      boundaryExcluded: report.samples.filter((item) => !item.accepted).length,
    };
    mkdirSync(dirname(resolve(options.output)), { recursive: true });
    writeFileSync(options.output, `${JSON.stringify(report, null, 2)}\n`);
  }
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseOptions();
    if (options.help)
      console.log(
        "Creates a new synthetic demo-origin store in an isolated deployment. Options: --base-url ORIGIN --output FILE --samples 30 --products 8 --days 180 --movements 24 --concurrency 2 --max-runs 5 --timeout-seconds 600 --environment LABEL --environment-file SAFE_JSON. Credentials remain in memory. Running samples require running status before AND after reads.",
      );
    else {
      const report = await runBenchmark(options);
      console.log(`Safe benchmark report saved: ${options.output}`);
      for (const [phase, values] of Object.entries(report.summaries))
        for (const [label, summary] of Object.entries(values))
          console.log(
            `${phase} ${label}: n=${summary.count} median=${summary.median?.toFixed(2) ?? "n/a"}ms p95=${summary.p95?.toFixed(2) ?? "n/a"}ms`,
          );
      if (!report.complete) {
        console.error(report.failure);
        process.exitCode = 1;
      }
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
