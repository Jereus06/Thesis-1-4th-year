import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import { deduplicateSales } from "../src/lib/sales-import.ts";

// The application uses Vite's extensionless TS resolution. Node 24 runs the same
// pure preparation source with a narrowly scoped resolution hook, without a DOM.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      (["./import-csv", "./guided-csv", "./csv-extraction"].includes(specifier) &&
        context.parentURL?.endsWith("/csv-preparation.ts")) ||
      (specifier === "./guided-csv" && context.parentURL?.endsWith("/csv-extraction.ts"))
    )
      return nextResolve(`${specifier}.ts`, context);
    return nextResolve(specifier, context);
  },
});
const { prepareCsv, csvRowsForSubmission, CSV_API_ROW_LIMITS, CSV_MAX_SOURCE_BYTES } =
  await import("../src/lib/csv-preparation.ts");

const product = {
  id: "synthetic-csv-product",
  sku: "SYNTHETIC-CSV-001",
  name: "Synthetic CSV product",
  category: "Synthetic",
  unit: "piece",
  currentStock: 10,
  leadTimeDays: 1,
  safetyStock: 0,
  unitCost: 1,
};
const header = "Date,SKU,Quantity,Source Record Key";
const row = (index) => `2026-09-01,${product.sku},1.25,synthetic:${index}`;
const request = (text, options = {}) => ({
  type: "prepare",
  requestId: 1,
  kind: "sales",
  source: { type: "text", text },
  products: [product],
  rowLimit: CSV_API_ROW_LIMITS.sales,
  ...options,
});

test("oversized files are rejected before their contents are read", async () => {
  const file = new File([""], "synthetic-too-large.csv");
  Object.defineProperty(file, "size", { value: 25 * 1024 * 1024 + 1 });
  let reads = 0;
  file.arrayBuffer = async () => {
    reads++;
    throw new Error("Oversized file must never be read");
  };
  const phases = [];
  const result = await prepareCsv(request("", { source: { type: "file", file } }), (phase) =>
    phases.push(phase),
  );
  assert.equal(reads, 0);
  assert.match(result.summary.error, /25 MiB/);
  assert.equal(result.summary.byteSize, file.size);
  assert.equal(result.sourceText, "");
  assert.deepEqual(result.summary.preview, []);
  assert.deepEqual(phases, []);
  assert.equal(result.data, null);
});

test("oversized pasted ASCII and Unicode are rejected before parsing or source retention", async () => {
  assert.equal(CSV_MAX_SOURCE_BYTES, 25 * 1024 * 1024);
  for (const text of [
    "x".repeat(CSV_MAX_SOURCE_BYTES + 1),
    "\u20ac".repeat(Math.floor(CSV_MAX_SOURCE_BYTES / 3) + 1),
    "\ud83d\ude00".repeat(Math.floor(CSV_MAX_SOURCE_BYTES / 4) + 1),
  ]) {
    const phases = [];
    const result = await prepareCsv(request(text), (phase) => phases.push(phase));
    assert.match(result.summary.error, /25 MiB/);
    assert.equal(result.sourceText, "");
    assert.equal(result.data, null);
    assert.equal(result.summary.logicalRecordCount, 0);
    assert.deepEqual(phases, []);
  }
});

test("accepted Unicode pasted data records its exact UTF-8 byte size", async () => {
  const text = `${header}\n2026-09-01,${product.sku},2,Caf\u00e9-\u65e5\ud83d\ude00-\ud800`;
  const result = await prepareCsv(request(text));
  assert.equal(result.summary.error, null);
  assert.equal(result.summary.byteSize, new TextEncoder().encode(text).byteLength);
  assert.equal(result.sourceText, text);
  assert.equal(result.data.rows[0].sourceRecordKey, "Caf\u00e9-\u65e5\ud83d\ude00-\ud800");
});

test("tiny file preparation records measurable phases and preserves complete accepted data", async () => {
  const text = `${header}\r\n${row(0)}`;
  const file = new File([text], "synthetic-tiny.csv", { type: "text/csv" });
  const phases = [];
  const result = await prepareCsv(request("", { source: { type: "file", file } }), (phase) =>
    phases.push(phase),
  );
  assert.deepEqual(phases, ["reading", "decoding", "parsing", "validating"]);
  assert.equal(result.summary.error, null);
  assert.equal(result.summary.filename, file.name);
  assert.equal(result.summary.byteSize, file.size);
  assert.equal(result.summary.encoding, "utf-8");
  assert.equal(result.summary.rowCount, 1);
  assert.equal(result.summary.logicalRecordCount, 2);
  assert.equal(result.sourceText, text);
  assert.equal(result.data.rows[0].sourceRecordKey, "synthetic:0");
  for (const duration of Object.values(result.summary.timings))
    assert.ok(Number.isFinite(duration) && duration >= 0);
  assert.ok(result.summary.timings.totalMs >= result.summary.timings.readMs);
});

test("guided preparation extracts report records while preserving the complete source and original positions", async () => {
  const reportHeader = `${header},Notes`;
  const text = [
    "Sales report,,,,",
    ",,,,",
    reportHeader,
    `${row(0)},"ignored\nreport note"`,
    reportHeader,
    `2026-09-02,${product.sku},2,synthetic:1`,
    "Grand Total,,3.25,,",
  ].join("\n");
  const result = await prepareCsv(request(text, { guided: true }));
  assert.equal(result.summary.error, null);
  assert.equal(result.summary.logicalRecordCount, 7);
  assert.equal(result.summary.rowCount, 2);
  assert.equal(result.summary.ignoredRowCount, 4);
  assert.equal(result.sourceText, text);
  assert.equal(result.summary.preview[0].fields[0], "Sales report");
  assert.deepEqual(
    result.summary.guided.convertedPreview.map(({ record, line }) => [record, line]),
    [
      [4, 4],
      [6, 7],
    ],
  );
  assert.deepEqual(
    result.data.rows.map(({ date, qty, sourceRecordKey }) => [date, qty, sourceRecordKey]),
    [
      ["2026-09-01", 1.25, "synthetic:0"],
      ["2026-09-02", 2, "synthetic:1"],
    ],
  );
  assert.deepEqual(result.issues, []);
});

test("guided report cleanup retains invalid operational rows and their original error positions", async () => {
  const text = [
    "Sales export,,,",
    ",,,",
    header,
    row(0),
    header,
    `2026-02-30,${product.sku},bad,synthetic:invalid`,
    "Total,,1.25,",
  ].join("\n");
  const result = await prepareCsv(request(text, { guided: true }));
  assert.equal(result.data, null);
  assert.ok(result.summary.error);
  assert.equal(result.summary.rowCount, 2);
  assert.equal(result.summary.ignoredRowCount, 4);
  assert.equal(result.summary.guided.validRowCount, 1);
  assert.equal(result.summary.guided.invalidRowCount, 1);
  assert.deepEqual(
    result.issues.map(({ record, line, field }) => [record, line, field]),
    [
      [6, 6, "date"],
      [6, 6, "quantity"],
    ],
  );
  assert.equal(result.sourceText, text);
});

test("explicit headerless preparation retains report-like rows for normal data validation", async () => {
  const text = ["Sales report,,,", row(0), "Total,,1.25,"].join("\n");
  const options = {
    header: false,
    delimiter: "auto",
    mapping: { date: 0, product: 1, quantity: 2, key: 3, unit: null },
    dateFormat: "iso",
    numberFormat: "decimal-point",
    productMatches: {},
  };
  const result = await prepareCsv(request(text, { guided: true, options }));
  assert.equal(result.summary.ignoredRowCount, 0);
  assert.equal(result.summary.rowCount, 3);
  assert.equal(result.summary.guided.validRowCount, 1);
  assert.equal(result.summary.guided.invalidRowCount, 2);
  assert.equal(result.data, null);
  assert.equal(result.sourceText, text);
});

test("the largest accepted sales CSV retains every row beyond its 50-record preview", async () => {
  assert.equal(CSV_API_ROW_LIMITS.sales, 100_000);
  const text = [header, ...Array.from({ length: 100_000 }, (_, index) => row(index))].join("\n");
  const result = await prepareCsv(request(text));
  assert.equal(result.summary.error, null);
  assert.equal(result.summary.limitExceeded, false);
  assert.equal(result.summary.preview.length, 50);
  assert.equal(result.summary.previewTruncated, true);
  assert.equal(result.summary.rowCount, 100_000);
  assert.equal(result.data.rows.length, 100_000);
  assert.equal(result.data.rows.at(-1).sourceRecordKey, "synthetic:99999");
  assert.equal(result.sourceText, text);
  const submitted = csvRowsForSubmission(result.data);
  assert.equal(submitted.rows.length, 100_000);
  assert.equal(submitted.rows.at(-1).sourceRecordKey, "synthetic:99999");
});

test("mixed keyed and unkeyed retries reuse validated data with unique ledger IDs in the same millisecond", async (t) => {
  const text = `${header}\n${row(0)}\n2026-09-01,${product.sku},1.25,`;
  const prepared = await prepareCsv(request(text));
  assert.equal(prepared.summary.error, null);
  const cachedIds = prepared.data.rows.map((sale) => sale.id);
  const values = (rows) => rows.map(({ id: _id, ...sale }) => sale);
  t.mock.method(Date, "now", () => 1_234_567);
  // Even a deterministic random source cannot cause collisions within one worker.
  t.mock.method(crypto, "getRandomValues", (array) => array.fill(0));
  const firstPayload = csvRowsForSubmission(prepared.data);
  const retryPayload = csvRowsForSubmission(prepared.data);
  assert.deepEqual(values(firstPayload.rows), values(prepared.data.rows));
  assert.deepEqual(values(retryPayload.rows), values(prepared.data.rows));
  assert.deepEqual(
    prepared.data.rows.map((sale) => sale.id),
    cachedIds,
  );
  assert.equal(
    new Set([...firstPayload.rows, ...retryPayload.rows].map((sale) => sale.id)).size,
    4,
  );
  const savedKeyed = { ...prepared.data.rows[0], id: "existing-synthetic-keyed-sale" };
  const first = deduplicateSales([savedKeyed], firstPayload.rows);
  const retry = deduplicateSales([savedKeyed, ...first.accepted], retryPayload.rows);
  for (const result of [first.result, retry.result]) {
    assert.equal(result.acceptedRows, 1);
    assert.equal(result.rejectedRows, 1);
    assert.equal(result.errors[0].code, "duplicate_source_record_key");
  }
  const allAccepted = [savedKeyed, ...first.accepted, ...retry.accepted];
  assert.equal(new Set(allAccepted.map((sale) => sale.id)).size, allAccepted.length);
  assert.equal(first.accepted[0].sourceRecordKey, undefined);
  assert.equal(retry.accepted[0].sourceRecordKey, undefined);
});

test("73,100 records are accepted in full with the expanded historical-sales limit", async () => {
  const text = [header, ...Array.from({ length: 73_100 }, (_, index) => row(index))].join("\n");
  const result = await prepareCsv(request(text));
  assert.equal(result.summary.rowCount, 73_100);
  assert.equal(result.summary.limitExceeded, false);
  assert.equal(result.summary.error, null);
  assert.equal(result.summary.preview.length, 50);
  assert.equal(result.data.rows.length, 73_100);
  assert.equal(result.data.rows.at(-1).sourceRecordKey, "synthetic:73099");
  assert.equal(result.sourceText, text);
});

test("100,001 records keep their full source and preview but exceed the single-request sales limit", async () => {
  const text = [header, ...Array.from({ length: 100_001 }, (_, index) => row(index))].join("\n");
  const result = await prepareCsv(request(text));
  assert.equal(result.summary.rowCount, 100_001);
  assert.equal(result.summary.limitExceeded, true);
  assert.match(result.summary.error, /100,001 sales rows.*100,000 rows/);
  assert.equal(result.summary.preview.length, 50);
  assert.equal(result.summary.previewTruncated, true);
  assert.equal(result.data.rows.length, 100_001);
  assert.equal(result.sourceText, text);
});

test("oversized CSVs retain both record diagnostics and the existing size-limit message", async () => {
  const records = Array.from({ length: 100_001 }, (_, index) => row(index));
  for (const firstRow of [
    "2026-09-01,UNKNOWN-SYNTHETIC-SKU,1,synthetic:0",
    `2026-02-30,${product.sku},1,synthetic:0`,
  ]) {
    records[0] = firstRow;
    const result = await prepareCsv(request([header, ...records].join("\n")));
    assert.equal(result.summary.rowCount, 100_001);
    assert.equal(result.summary.limitExceeded, true);
    assert.match(result.summary.error, /CSV record 2 \(line 2\)/);
    assert.match(result.summary.error, /100,001 sales rows.*100,000 rows/);
    assert.equal(result.summary.preview.length, 50);
    assert.equal(result.data, null);
  }
  const unsupported = await prepareCsv(
    request(["Date,SKU,Quantity,Unsupported", ...records].join("\n")),
  );
  assert.equal(unsupported.summary.rowCount, 100_001);
  assert.equal(unsupported.summary.limitExceeded, true);
  assert.match(unsupported.summary.error, /CSV record 1 \(line 1\): Unsupported column/);
  assert.match(unsupported.summary.error, /100,001 sales rows.*100,000 rows/);
});

test("inventory uses its existing 5,000-row API limit while retaining its source", async () => {
  assert.equal(CSV_API_ROW_LIMITS.inventory, 5_000);
  const text = [
    "SKU,Product,Category,Unit,On Hand,Lead Time,Safety Stock,Unit Cost",
    ...Array.from(
      { length: 5_001 },
      (_, index) => `SYNTH-${index},Synthetic ${index},Test,piece,1,1,0,1`,
    ),
  ].join("\n");
  const result = await prepareCsv(
    request(text, { kind: "inventory", rowLimit: CSV_API_ROW_LIMITS.inventory }),
  );
  assert.equal(result.summary.limitExceeded, true);
  assert.match(result.summary.error, /5,001 inventory rows.*5,000 rows/);
  assert.equal(result.data.rows.length, 5_001);
});

test("quoted newlines are logical records and accepted original values survive preview shortening", async () => {
  const sourceKey = 'Till, "A"\r\nLine 1';
  const quotedKey = `"${sourceKey.replaceAll('"', '""')}"`;
  const text = `${header}\r\n2026-09-01,${product.sku},2,${quotedKey}`;
  const result = await prepareCsv(request(text));
  assert.equal(result.summary.rowCount, 1);
  assert.equal(result.summary.logicalRecordCount, 2);
  assert.equal(result.data.rows[0].sourceRecordKey, sourceKey);
  assert.equal(result.summary.preview[1].fields[3], sourceKey);
  const longName = "Synthetic " + "x".repeat(3_000);
  const longProduct = { ...product, name: longName };
  const longText = `${header}\n2026-09-01,${longName},2,stable-key`;
  const long = await prepareCsv(request(longText, { products: [longProduct] }));
  assert.equal(long.summary.error, null);
  assert.equal(long.summary.previewValuesTruncated, true);
  assert.ok(long.summary.preview[1].fields[1].length <= 501);
  assert.equal(long.sourceText, longText);
  assert.equal(long.data.rows.length, 1);
  assert.equal(long.data.rows[0].productId, product.id);
});

test("unsupported headers and malformed records retain useful diagnostics", async () => {
  const unsupported = await prepareCsv(request(`Date,SKU,Quantity,Unsupported\n${row(1)}`));
  assert.match(unsupported.summary.error, /CSV record 1 \(line 1\): Unsupported column/);
  assert.equal(unsupported.summary.preview.length, 2);
  assert.equal(unsupported.data, null);
  const unsupportedHeaderOnly = await prepareCsv(request("Date,SKU,Quantity,Unsupported"));
  assert.match(unsupportedHeaderOnly.summary.error, /Unsupported column/);
  const malformed = await prepareCsv(request(`${header}\n2026-09-01,"unclosed,2,key`));
  assert.match(malformed.summary.error, /CSV record 2 \(line 2\): Unclosed quoted field/);
  assert.equal(malformed.data, null);
  const empty = await prepareCsv(request(header));
  assert.match(empty.summary.error, /no data records/);
});

test("huge invalid CSV values cannot bypass the bounded preview through error text", async () => {
  const hugeValue = `Synthetic-unknown-${"x".repeat(1_000_000)}`;
  for (const text of [
    `${header}\n2026-09-01,${hugeValue},1,key`,
    `Date,SKU,Quantity,${hugeValue}\n2026-09-01,${product.sku},1,key`,
  ]) {
    const result = await prepareCsv(request(text));
    assert.match(result.summary.error, /CSV record [12] \(line [12]\)/);
    assert.match(result.summary.error, /\u2026/);
    assert.ok(result.summary.error.length < 400);
    assert.equal(result.summary.previewValuesTruncated, true);
    assert.ok(
      result.summary.preview.every((record) => record.fields.every((field) => field.length <= 501)),
    );
    assert.equal(result.sourceText, text);
    assert.equal(result.data, null);
  }
  const exactLongProduct = { ...product, name: hugeValue };
  const accepted = await prepareCsv(
    request(`${header}\n2026-09-01,${hugeValue},1,unchanged-key`, { products: [exactLongProduct] }),
  );
  assert.equal(accepted.summary.error, null);
  assert.equal(accepted.summary.previewValuesTruncated, true);
  assert.equal(accepted.data.rows[0].productId, product.id);
  assert.equal(accepted.data.rows[0].sourceRecordKey, "unchanged-key");
  assert.ok(accepted.sourceText.includes(hugeValue));
});

test("BOM-marked UTF-16 LE and BE file preparation preserves Unicode keys", async () => {
  const text = `${header}\r\n2026-09-01,${product.sku},1,Caf\u00e9-\ud83d\ude00`;
  for (const littleEndian of [true, false]) {
    const bytes = new Uint8Array(2 + text.length * 2);
    bytes.set(littleEndian ? [0xff, 0xfe] : [0xfe, 0xff]);
    const view = new DataView(bytes.buffer);
    for (let index = 0; index < text.length; index++)
      view.setUint16(2 + index * 2, text.charCodeAt(index), littleEndian);
    const file = new File([bytes], "synthetic-unicode.csv");
    const result = await prepareCsv(request("", { source: { type: "file", file } }));
    assert.equal(result.summary.error, null);
    assert.equal(result.summary.encoding, littleEndian ? "utf-16le" : "utf-16be");
    assert.equal(result.sourceText, text);
    assert.equal(result.data.rows[0].sourceRecordKey, "Caf\u00e9-\ud83d\ude00");
  }
});

test("unsupported binary, legacy bytes, and UTF-32 exports give clear file errors", async () => {
  for (const bytes of [
    [0xe9],
    [0xff, 0xfe, 0x61],
    [0x44, 0, 0x61, 0],
    [0xff, 0xfe, 0, 0, 0x44, 0, 0, 0],
  ]) {
    const file = new File([new Uint8Array(bytes)], "unsupported.csv");
    const result = await prepareCsv(request("", { source: { type: "file", file } }));
    assert.match(result.summary.error, /UTF-8 CSV/);
    assert.equal(result.data, null);
  }
});

test("browser demonstration retains the explicit unlimited preparation mode", async () => {
  const result = await prepareCsv(request(`${header}\n${row(0)}\n${row(1)}`, { rowLimit: null }));
  assert.equal(result.summary.error, null);
  assert.equal(result.summary.rowLimit, null);
  assert.equal(result.data.rows.length, 2);
});
