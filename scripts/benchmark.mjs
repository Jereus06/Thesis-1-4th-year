import { mkdirSync, writeFileSync } from "node:fs";
import { cpus, freemem, totalmem, platform, release } from "node:os";
import { performance } from "node:perf_hooks";

const base = process.env.BENCHMARK_URL ?? "http://localhost:8080";
const repetitions = Number(process.env.BENCHMARK_REPETITIONS ?? 30);
const business = process.env.BENCHMARK_BUSINESS_ID;
const cookie = process.env.BENCHMARK_COOKIE;
const expected = process.env.BENCHMARK_EXPECTED_STATE ?? "idle";
if (!Number.isInteger(repetitions) || repetitions < 5 || repetitions > 1000)
  throw new Error("BENCHMARK_REPETITIONS must be 5..1000");
if ((business && !cookie) || (!business && cookie))
  throw new Error(
    "Set both BENCHMARK_BUSINESS_ID and BENCHMARK_COOKIE for authenticated dashboard measurements",
  );
const targets = [
  "/api/v1/health",
  ...(business ? [`/api/v1/businesses/${business}/forecast-dashboard`] : []),
];
const results = {};
for (const path of targets) {
  const samples = [];
  for (let i = 0; i < repetitions; i++) {
    const started = performance.now();
    const response = await fetch(new URL(path, base), {
      headers: cookie ? { cookie } : undefined,
      redirect: "manual",
    });
    const contentType = response.headers.get("content-type") ?? "";
    const payload = contentType.includes("json") ? await response.json() : null;
    if (!response.ok || response.status >= 300 || !payload)
      throw new Error(`${path} returned ${response.status} or a non-JSON/login response`);
    if (path.endsWith("forecast-dashboard") && i === 0) {
      const status = payload.data?.latestRun?.status;
      const active = status === "running";
      if ((expected === "training-active") !== active)
        throw new Error(`Expected ${expected}, but saved job status is ${status ?? "none"}`);
    }
    samples.push(performance.now() - started);
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const percentile = (p) => sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)];
  results[path] = {
    samplesMs: samples,
    medianMs: percentile(0.5),
    p95Ms: percentile(0.95),
    minMs: sorted[0],
    maxMs: sorted.at(-1),
  };
}
const report = {
  schemaVersion: 2,
  measuredAt: new Date().toISOString(),
  clientEnvironment: process.env.BENCHMARK_CLIENT_ENVIRONMENT ?? "unspecified-client",
  serverEnvironment: process.env.BENCHMARK_SERVER_ENVIRONMENT ?? "unspecified-server",
  expectedState: expected,
  provenance: "isolated synthetic test account; benchmark performs authenticated reads only",
  repetitions,
  workload: {
    businessId: business ?? null,
    products: Number(process.env.BENCHMARK_PRODUCTS ?? 0),
    salesRows: Number(process.env.BENCHMARK_SALES_ROWS ?? 0),
    classifiedDates: Number(process.env.BENCHMARK_CLASSIFIED_DATES ?? 0),
  },
  host: {
    platform: platform(),
    release: release(),
    cpuModel: cpus()[0]?.model,
    logicalCpuCount: cpus().length,
    totalRamBytes: totalmem(),
    freeRamBytesAtEnd: freemem(),
  },
  software: { node: process.version },
  results,
};
const output = process.env.BENCHMARK_OUTPUT ?? `benchmarks/benchmark-${Date.now()}.json`;
mkdirSync(output.includes("/") ? output.slice(0, output.lastIndexOf("/")) : ".", {
  recursive: true,
});
writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(`Benchmark saved: ${output}`);
