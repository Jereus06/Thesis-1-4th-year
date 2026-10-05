import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { latencySummary, parseOptions, runBenchmark } from "./benchmark.mjs";

test("summary uses midpoint median, nearest-rank p95 and explicit missing counts", () => {
  assert.deepEqual(latencySummary([]), { count: 0, median: null, p95: null, min: null, max: null });
  assert.deepEqual(latencySummary([1, 2, 3, 10].map((latencyMs) => ({ latencyMs }))), {
    count: 4,
    median: 2.5,
    p95: 10,
    min: 1,
    max: 10,
  });
  assert.throws(
    () => parseOptions(["--base-url", "http://user:secret@example.test"], {}),
    /without credentials/,
  );
  assert.throws(() => parseOptions(["--samples", "4"], {}), /5..1000/);
});

test("authenticated sampling excludes worker boundary batches and exports no credentials", async () => {
  const directory = mkdtempSync(join(tmpdir(), "stockcast-benchmark-"));
  const output = join(directory, "safe.json");
  const metadata = join(directory, "metadata.json");
  const secret = "synthetic-session-secret",
    csrf = "synthetic-csrf-secret";
  writeFileSync(
    metadata,
    JSON.stringify({
      software: { xgboost: "3.0.2", password: secret },
      hostVerificationRuntime: { python: "3.13.2", token: csrf },
      containerRuntime: { api: { python: "3.12.14", credentials: secret } },
      docker: { serverVersion: "29.2.1", environment: { AUTH_TOKEN: csrf } },
      containerLimits: { worker: { cpus: 2, memoryBytes: 1000000, secret } },
      environment: { SESSION_COOKIE: secret },
    }),
  );
  let generatedPassword,
    generatedEmail,
    activeRun = 0,
    probes = 0,
    signedOut = false;
  const fetcher = async (url, options) => {
    const path = url.pathname.replace("/api/v1", "");
    const body = options.body ? JSON.parse(options.body) : null;
    const headers = new Headers();
    let data = {};
    if (path === "/auth/sign-up") {
      generatedPassword = body.password;
      generatedEmail = body.email;
      assert.equal(body.dataOrigin, "demo");
      headers.append("Set-Cookie", `stockcast_session=${secret}; HttpOnly`);
      headers.append("Set-Cookie", `stockcast_csrf=${csrf}`);
      data = { businessId: "synthetic-business" };
    } else {
      assert.ok(options.headers.Cookie.includes(secret));
      if (options.method === "GET") assert.equal(options.headers["X-CSRF-Token"], undefined);
      else assert.equal(options.headers["X-CSRF-Token"], csrf);
      if (path === "/auth/sign-out") signedOut = true;
      else if (path.endsWith("/forecast-dashboard")) data = { businessDay: "2026-10-05" };
      else if (path.endsWith("/products")) data = [{ id: "synthetic-product", sku: "BENCH-1" }];
      else if (path.endsWith("/data-imports")) data = { acceptedRows: body.rows.length };
      else if (path.endsWith("/settings"))
        data = { minimumNonzeroDays: 100, cvFolds: 3, forecastHorizonDays: 14 };
      else if (path.endsWith("/forecast-refresh")) {
        data = { id: `run-${activeRun++}` };
        probes = 0;
      } else if (/\/forecast-runs\/run-\d+$/.test(path)) {
        const id = path.split("/").at(-1);
        let status = "completed";
        if (id === "run-1") status = ++probes === 1 ? "running" : "completed";
        if (id === "run-2") status = ++probes <= 50 ? "running" : "completed";
        data = {
          id,
          status,
          timing: { totalProcessingMs: 25 },
          configuration: { products: { one: { eligible: true } } },
        };
      }
    }
    return new Response(JSON.stringify({ data }), { status: 200, headers });
  };
  try {
    const report = await runBenchmark(
      parseOptions(
        [
          "--products",
          "1",
          "--days",
          "134",
          "--movements",
          "0",
          "--samples",
          "5",
          "--concurrency",
          "2",
          "--max-runs",
          "2",
          "--output",
          output,
          "--environment-file",
          metadata,
        ],
        {},
      ),
      fetcher,
    );
    assert.equal(report.complete, true);
    assert.equal(report.observationCounts.boundaryExcluded, 2);
    assert.equal(report.observationCounts.accepted, 100);
    assert.equal(report.runs.length, 3);
    assert.equal(report.software.xgboost, "3.0.2");
    assert.deepEqual(report.hostVerificationRuntime, { python: "3.13.2" });
    assert.deepEqual(report.containerRuntime.api, { python: "3.12.14" });
    assert.deepEqual(report.docker, { serverVersion: "29.2.1" });
    assert.deepEqual(report.containerLimits.worker, { cpus: 2, memoryBytes: 1000000 });
    assert.ok(
      report.samples
        .filter((sample) => sample.phase === "worker-running" && sample.accepted)
        .every(
          (sample) =>
            sample.workerStatusBefore === "running" && sample.workerStatusAfter === "running",
        ),
    );
    assert.ok(
      Object.values(report.summaries["worker-running"]).every((summary) => summary.count === 5),
    );
    assert.equal(signedOut, true);
    const saved = readFileSync(output, "utf8");
    for (const value of [secret, csrf, generatedPassword, generatedEmail])
      assert.equal(saved.includes(value), false);
  } finally {
    const target = resolve(directory);
    assert.equal(dirname(target), resolve(tmpdir()));
    assert.ok(basename(target).startsWith("stockcast-benchmark-"));
    rmSync(target, { recursive: true, force: true });
  }
});
