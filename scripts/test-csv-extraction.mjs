import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import { parseCsvRecords } from "../src/lib/import-csv.ts";

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
const { extractCsvTable } = await import("../src/lib/csv-extraction.ts");
const { prepareCsv } = await import("../src/lib/csv-preparation.ts");
const product = {
  id: "synthetic-1",
  sku: "SYN-001",
  name: "Synthetic Rice",
  category: "Synthetic",
  unit: "bag",
  currentStock: 10,
  leadTimeDays: 3,
  safetyStock: 1,
  unitCost: 40,
};
const extract = (text, kind = "sales", products = [product], options) =>
  extractCsvTable(parseCsvRecords(text), kind, products, options);

test("semicolon reports ignore titles, empty padding, repeated headers, and safe footer without renumbering source", () => {
  const text =
    'Sales report\n\nDate;SKU;Quantity;Note\n2026-10-05;SYN-001;2;"line one\nline two"\n;;;\nDate;SKU;Quantity;Note\nGrand Total;;2;\n';
  const original = parseCsvRecords(text);
  const result = extractCsvTable(original, "sales", [product]);
  assert.equal(result.ignoredRowCount, 4);
  assert.equal(result.records.length, 2);
  assert.equal(result.records[0], original[1]);
  assert.equal(result.records[1], original[2]);
  assert.deepEqual(
    result.records.map(({ record, line }) => [record, line]),
    [
      [2, 3],
      [3, 4],
    ],
  );
  assert.equal(result.records[1].fields[3], "line one\nline two");
  assert.equal(original.length, 6);
});

test("tab reports and quoted multiline titles retain quoted separator values", () => {
  const result = extract(
    '"Sales report;\nmonthly"\nDate\tSKU\tQuantity\tNotes\n2026-10-05\tSYN-001\t2\t"comma, semicolon; and\ttab"',
  );
  assert.equal(result.ignoredRowCount, 1);
  assert.equal(result.records[0].line, 3);
  assert.deepEqual(result.records[1].fields, [
    "2026-10-05",
    "SYN-001",
    "2",
    "comma, semicolon; and\ttab",
  ]);
});

test("commas in report titles do not override a semicolon table and standalone titles retain comma parsing", () => {
  const result = extract("Sales report, October 2026\nDate;SKU;Quantity\n2026-10-05;SYN-001;2");
  assert.equal(result.ignoredRowCount, 1);
  assert.deepEqual(result.records[0].fields, ["Date", "SKU", "Quantity"]);
  assert.deepEqual(parseCsvRecords("Sales report, October 2026\n")[0].fields, [
    "Sales report",
    " October 2026",
  ]);
});

test("delimiter-only padding before another table separator does not choose the wrong delimiter", () => {
  const result = extract(",,,\nSales report\nDate;SKU;Quantity\n2026-10-05;SYN-001;2\n;;;");
  assert.equal(result.ignoredRowCount, 3);
  assert.deepEqual(result.records[0].fields, ["Date", "SKU", "Quantity"]);
  assert.equal(result.records[1].fields[1], "SYN-001");
});

test("more than fifty initial blank and padding rows never consume delimiter detection's meaningful-row limit", () => {
  for (const delimiter of [";", "\t"]) {
    for (const newline of ["\n", "\r\n", "\r"]) {
      const text = newline.repeat(75) +
        `${delimiter.repeat(3)}${newline}`.repeat(75) +
        `Sales report, October 2026${newline}` +
        ["Date", "SKU", "Quantity"].join(delimiter) + newline +
        ["2026-10-05", "SYN-001", "2"].join(delimiter);
      const original = parseCsvRecords(text);
      const result = extractCsvTable(original, "sales", [product]);
      assert.deepEqual(result.records[0].fields, ["Date", "SKU", "Quantity"]);
      assert.equal(result.records[0].record, 77);
      assert.equal(result.records[0].line, 152);
      assert.equal(result.records[1].line, 153);
      assert.equal(result.records[1].fields[1], "SYN-001");
      assert.equal(result.ignoredRowCount, 76);
      assert.equal(original.length, 78);
    }
  }
});

test("inventory totals are removed only with empty product identifiers", () => {
  const result = extract(
    "Inventory report\nReport label;SKU;Stock Count;Product\n;SYN-001;7;Synthetic Rice\nGrand Total;;7;",
    "inventory",
  );
  assert.equal(result.ignoredRowCount, 2);
  assert.deepEqual(result.records[1].fields, ["", "SYN-001", "7", "Synthetic Rice"]);
  for (const kind of ["inventory", "sales"]) {
    const text =
      kind === "inventory" ? "SKU,On Hand\nTotal,7" : "Date,SKU,Quantity\n2026-10-05,Total,7";
    for (const catalog of [[product], [{ ...product, sku: "Total", name: "Total" }]]) {
      const retained = extract(text, kind, catalog);
      assert.equal(retained.ignoredRowCount, 0);
      assert.equal(retained.records.length, 2);
    }
  }
});

test("real records with invalid required fields, unknown identifiers, or missing products are never discarded", () => {
  for (const row of [
    "2026-10-05,UNKNOWN,2",
    "2026-10-05,,2",
    "2026-02-30,SYN-001,2",
    "bad,SYN-001,2",
    "2026-10-05,SYN-001,bad",
    "2026-10-05,SYN-001,-2",
    "Grand Total,SYN-001,2",
    "Grand Total,UNKNOWN,2",
  ]) {
    const retained = extract(`Date,SKU,Quantity\n${row}`);
    assert.equal(retained.ignoredRowCount, 0, row);
    assert.equal(retained.records.length, 2, row);
  }
});

test("footer-like keyed records and non-summary text remain available for validation", () => {
  for (const row of ["Grand Total,,2,line:1", "Grand Total,,2,unknown note", "2026-10-05,,2,"]) {
    const retained = extract(
      `Date,SKU,Quantity,Source Record Key\n2026-10-05,SYN-001,1,line:0\n${row}`,
    );
    assert.equal(retained.ignoredRowCount, 0, row);
    assert.equal(retained.records.length, 3, row);
  }
  const interior = extract("Date,SKU,Quantity\nSubtotal,,2\n2026-10-05,SYN-001,2");
  assert.equal(interior.ignoredRowCount, 0);
});

test("later headers never discard earlier data or unknown identifiers", () => {
  for (const prefix of ["2026-10-05,SYN-001,2", "UNKNOWN", "2026-10-05,,2", "2026-02-30"]) {
    const result = extract(`${prefix}\nDate,SKU,Quantity\n2026-10-06,SYN-001,1`);
    assert.equal(result.ignoredRowCount, 0, prefix);
    assert.equal(result.records[0].fields[0], prefix.split(",")[0]);
  }
  const catalogTitle = extract("Sales report\nDate,SKU,Quantity\n2026-10-05,SYN-001,1", "sales", [
    { ...product, sku: "Sales report" },
  ]);
  assert.equal(catalogTitle.ignoredRowCount, 0);
});

test("explicit headerless imports remove only all-empty records", () => {
  const source = parseCsvRecords(
    "Sales report\nDate,SKU,Quantity\n,,\n2026-10-05,SYN-001,2\nDate,SKU,Quantity\nGrand Total,,2",
  );
  const result = extractCsvTable(source, "sales", [product], { header: false });
  assert.equal(result.ignoredRowCount, 1);
  assert.equal(result.records.length, 5);
  assert.equal(result.records[0], source[0]);
  assert.equal(result.records.at(-1), source.at(-1));
});

test("automatic headerless sales preserve equal-looking separate transactions and source positions", async () => {
  const catalog = [{ ...product, sku: "SKU", name: "Stock" }];
  for (const date of ["2026-10-15", "15/10/2026", "10/15/2026"]) {
    const row = `${date},SKU,2,,Date,Quantity`;
    const text = `${row}\n,,,,,\n${row}`;
    const source = parseCsvRecords(text);
    const extracted = extractCsvTable(source, "sales", catalog);
    assert.deepEqual(extracted.records, [source[0], source[2]], date);
    assert.equal(extracted.ignoredRowCount, 1, date);
    const result = await prepareCsv({
      type: "prepare", requestId: 1, kind: "sales", guided: true,
      source: { type: "text", text }, products: catalog, rowLimit: null,
    });
    assert.equal(result.summary.error, null, date);
    assert.equal(result.summary.guided.options.header, false, date);
    assert.equal(result.summary.rowCount, 2, date);
    assert.equal(result.summary.ignoredRowCount, 1, date);
    assert.deepEqual(result.data.rows.map(({ date, qty }) => [date, qty]), [
      ["2026-10-15", 2], ["2026-10-15", 2],
    ]);
    assert.ok(result.data.rows.every((row) => !Object.hasOwn(row, "sourceRecordKey")));
    assert.deepEqual(
      result.summary.guided.convertedPreview.map(({ record, line }) => [record, line]),
      [[1, 1], [3, 3]],
    );
    assert.equal(result.sourceText, text);
  }
});

test("headerless repeated source keys remain blocking even when extra cells look like headers", async () => {
  for (const date of ["2026-10-15", "15/10/2026", "10/15/2026"]) {
    const row = `${date},SKU,2,sale:1,Date,Quantity`;
    const result = await prepareCsv({
      type: "prepare", requestId: 1, kind: "sales", guided: true,
      source: { type: "text", text: `${row}\n${row}` },
      products: [{ ...product, sku: "SKU", name: "Stock" }], rowLimit: null,
    });
    assert.equal(result.data, null, date);
    assert.ok(result.summary.error, date);
    assert.equal(result.summary.rowCount, 2, date);
    assert.equal(result.summary.ignoredRowCount, 0, date);
    const keyIssue = result.issues.find(({ field }) => field === "key");
    assert.match(keyIssue.message, /Repeated Source Record Key/);
    assert.equal(keyIssue.record, 2);
    assert.equal(keyIssue.line, 2);
  }
});

test("headerless inventory with SKU and Stock values retains duplicate counts for validation", async () => {
  const row = "SKU,Stock,Synthetic,bag,20,3,1,40";
  const text = `${row}\n${row}`;
  const catalog = [{ ...product, sku: "SKU", name: "Stock" }];
  const source = parseCsvRecords(text);
  const extracted = extractCsvTable(source, "inventory", catalog);
  assert.deepEqual(extracted.records, source);
  assert.equal(extracted.ignoredRowCount, 0);
  const result = await prepareCsv({
    type: "prepare", requestId: 1, kind: "inventory", guided: true,
    source: { type: "text", text }, products: catalog, rowLimit: null,
  });
  assert.equal(result.data, null);
  assert.equal(result.summary.guided.options.header, false);
  assert.equal(result.summary.rowCount, 2);
  assert.equal(result.summary.ignoredRowCount, 0);
  const duplicate = result.issues.find(({ field }) => field === "sku");
  assert.match(duplicate.message, /Duplicate SKU/);
  assert.equal(duplicate.record, 2);
  assert.equal(duplicate.line, 2);
});

test("explicit header choices override a date-looking first cell when cleaning repeated headers", () => {
  const source = parseCsvRecords(
    "2026-10-05,Date,SKU,Quantity\n2026-10-05,Date,SKU,Quantity\nunused,2026-10-06,SYN-001,2",
  );
  const options = {
    header: true, delimiter: "auto", mapping: { date: 1, product: 2, quantity: 3, key: null, unit: null },
    dateFormat: "iso", numberFormat: "decimal-point", productMatches: {},
  };
  const header = extractCsvTable(source, "sales", [product], options);
  assert.deepEqual(header.records, [source[0], source[2]]);
  assert.equal(header.ignoredRowCount, 1);
  const headerless = extractCsvTable(source, "sales", [product], { ...options, header: false });
  assert.deepEqual(headerless.records, source);
  assert.equal(headerless.ignoredRowCount, 0);
});

test("explicit mapped identifiers and source keys protect otherwise footer-shaped data", () => {
  const text = "Date,SKU,Quantity,Extra\n2026-10-05,SYN-001,1,\nGrand Total,,2,Total";
  const result = extract(text, "sales", [product], { header: true, mapping: { product: 3 } });
  assert.equal(result.ignoredRowCount, 0);
  assert.equal(result.records.length, 3);
});

test("large repeated-header reports retain all actual records and source identities", () => {
  const rows = Array.from({ length: 250 }, (_, index) => `2026-10-05,SYN-001,1,line:${index}`);
  const header = "Date,SKU,Quantity,Source Record Key";
  const result = extract(`${header}\n${rows.join("\n")}\n${header}\n2026-10-06,SYN-001,1,last`);
  assert.equal(result.ignoredRowCount, 1);
  assert.equal(result.records.length, 252);
  assert.equal(result.records.at(-1).record, 253);
  assert.equal(result.records.at(-1).fields[3], "last");
});

test("separator directives and malformed quoting retain the parser contract", () => {
  const directive = extract("sep=;\nSales report\nDate;SKU;Quantity\n2026-10-05;SYN-001;2");
  assert.equal(directive.records[0].line, 3);
  assert.equal(directive.ignoredRowCount, 1);
  const forced = parseCsvRecords("Sales report\nDate;SKU;Quantity\n2026-10-05;SYN-001;2", ";");
  assert.equal(forced[1].fields.length, 3);
  assert.throws(
    () => extract('Sales report\nDate,SKU,Quantity,Notes\n2026-10-05,SYN-001,2,"unclosed'),
    /Unclosed quoted field/,
  );
});
