import { writeFileSync } from "node:fs";
import { cpus, freemem, totalmem, platform, release } from "node:os";
import { performance } from "node:perf_hooks";

const base = process.env.BENCHMARK_URL ?? "http://localhost:8080";
const repetitions = Number(process.env.BENCHMARK_REPETITIONS ?? 30);
if (!Number.isInteger(repetitions) || repetitions < 5 || repetitions > 1000) throw new Error("BENCHMARK_REPETITIONS must be 5..1000");
const endpoint = new URL("/api/v1/health", base);
const samples = [];
for (let i = 0; i < repetitions; i++) {
  const started = performance.now();
  const response = await fetch(endpoint);
  await response.arrayBuffer();
  if (!response.ok) throw new Error(`${endpoint} returned ${response.status}`);
  samples.push(performance.now() - started);
}
const sorted = [...samples].sort((a,b) => a-b);
const percentile = (p) => sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)];
const report = {
  schemaVersion: 1,
  measuredAt: new Date().toISOString(),
  environmentLabel: process.env.BENCHMARK_ENVIRONMENT ?? "unspecified-local-environment",
  provenance: "isolated synthetic workload; health endpoint creates or changes no business records",
  target: endpoint.toString(), repetitions,
  latencyMs: { median: percentile(0.5), p95: percentile(0.95), min: sorted[0], max: sorted.at(-1) },
  host: { platform: platform(), release: release(), cpuModel: cpus()[0]?.model, logicalCpuCount: cpus().length, totalRamBytes: totalmem(), freeRamBytesAtEnd: freemem() },
  software: { node: process.version }, samplesMs: samples,
};
const output = process.env.BENCHMARK_OUTPUT ?? `benchmarks/benchmark-${Date.now()}.json`;
const { mkdirSync } = await import("node:fs");
mkdirSync(output.slice(0, Math.max(0, output.lastIndexOf("/"))) || ".", { recursive: true });
writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(`Benchmark saved: ${output}`);
console.log(`median=${report.latencyMs.median.toFixed(2)}ms p95=${report.latencyMs.p95.toFixed(2)}ms`);
