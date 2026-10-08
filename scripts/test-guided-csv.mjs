import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import { parseCsvRecords } from "../src/lib/import-csv.ts";
import { csvIssueReport, suggestCsvOptions, validateGuidedCsv } from "../src/lib/guided-csv.ts";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      ["./import-csv", "./guided-csv"].includes(specifier) &&
      context.parentURL?.endsWith("/csv-preparation.ts")
    )
      return nextResolve(`${specifier}.ts`, context);
    return nextResolve(specifier, context);
  },
});
const { prepareCsv, csvRowsForSubmission } = await import("../src/lib/csv-preparation.ts");
const product = {
  id: "synthetic-1",
  sku: "000123",
  name: "Synthetic Rice",
  category: "Synthetic",
  unit: "bag",
  currentStock: 20,
  leadTimeDays: 3,
  safetyStock: 1,
  unitCost: 40,
};
const products = [product];
const salesHeader = "Date,SKU,Quantity,Source Record Key";
const inventoryHeader = "SKU,Product,Category,Unit,On Hand,Lead Time,Safety Stock,Unit Cost";
const validate = (text, kind = "sales", options, catalog = products) =>
  validateGuidedCsv(parseCsvRecords(text), kind, catalog, options);
const configure = (text, changes = {}, kind = "sales") => ({
  ...suggestCsvOptions(parseCsvRecords(text), kind),
  ...changes,
});
const request = (text, options = {}) => ({
  type: "prepare",
  requestId: 1,
  kind: "sales",
  guided: true,
  source: { type: "text", text },
  products,
  rowLimit: 100_000,
  ...options,
});

test("suggested aliases and reordered columns ignore extras without losing leading-zero SKUs", () => {
  const result = validate(
    "Customer;Units Sold;Item Code;Transaction Date;Transaction Line ID\nUnneeded;1.25;000123;2026-10-05;line:1",
  );
  assert.equal(result.issues.length, 0);
  assert.deepEqual(result.options.mapping, {
    date: 3,
    product: 2,
    quantity: 1,
    key: 4,
    unit: null,
  });
  assert.deepEqual(result.data.rows[0], {
    id: "prepared-2",
    productId: product.id,
    date: "2026-10-05",
    qty: 1.25,
    sourceRecordKey: "line:1",
  });
  assert.equal(result.convertedPreview[0].fields[1], "000123");
});

test("unknown headers require explicit mapping, with headerless records still available", () => {
  const text = "When,Identifier,Amount,Private note\n2026-10-05,000123,2,ignored";
  const missing = validate(text);
  assert.equal(missing.configurationErrors.length, 3);
  assert.equal(missing.data, null);
  const result = validate(
    text,
    "sales",
    configure(text, { mapping: { date: 0, product: 1, quantity: 2, key: null, unit: null } }),
  );
  assert.equal(result.data.rows.length, 1);
  for (const headerless of ["2026-10-05,000123,2", "2026-10-05,000123,2,line:1"]) {
    const prepared = validate(headerless);
    assert.equal(prepared.options.header, false);
    assert.equal(prepared.data.rows.length, 1);
  }
  const inv = validate("000123,Synthetic Rice,Synthetic,bag,20,3,1,40", "inventory");
  assert.equal(inv.options.header, false);
  assert.deepEqual(inv.data.rows[0], (({ id: _id, ...row }) => row)(product));
});

test("multiple aliases and shared source columns require an explicit unambiguous choice", () => {
  const text = "Date,SKU,Product Name,Quantity,Qty\n2026-10-05,000123,Synthetic Rice,1,2";
  assert.deepEqual(validate(text).configurationErrors, [
    "Select a source column for Product / SKU.",
    "Select a source column for Quantity.",
  ]);
  const options = configure(text, {
    mapping: { date: 0, product: 1, quantity: 0, key: null, unit: null },
  });
  assert.match(validate(text, "sales", options).configurationErrors[0], /same source column/);
  options.mapping.quantity = 3;
  assert.equal(validate(text, "sales", options).data.rows[0].qty, 1);
});

test("day/month and month/day conversion are explicit and every calendar date is validated", () => {
  const text = "Date,SKU,Quantity\n05/10/2026,000123,2\n29/02/2024,000123,1";
  assert.equal(validate(text).invalidRowCount, 2);
  const result = validate(text, "sales", configure(text, { dateFormat: "dmy" }));
  assert.deepEqual(
    result.data.rows.map((row) => row.date),
    ["2026-10-05", "2024-02-29"],
  );
  const american = "Date,SKU,Quantity\n05/10/2026,000123,2";
  assert.equal(
    validate(american, "sales", configure(american, { dateFormat: "mdy" })).data.rows[0].date,
    "2026-05-10",
  );
  for (const date of [
    "29/02/2026",
    "31/04/2026",
    "10/05/26",
    "10/05/0000",
    "2026-10-05T00:00:00",
    "05/10-2026",
  ]) {
    const source = `Date,SKU,Quantity\n${date},000123,1`;
    assert.equal(
      validate(source, "sales", configure(source, { dateFormat: "dmy" })).invalidRowCount,
      1,
      date,
    );
  }
});

test("chosen number formats convert valid grouping, never guess mixed separators or currency", () => {
  for (const [numberFormat, raw] of [
    ["comma-grouped", "1,234.500"],
    ["decimal-comma", "1.234,500"],
    ["decimal-point", "1234.500"],
  ]) {
    const source = `Date;SKU;Quantity\n2026-10-05;000123;${raw}`;
    assert.equal(
      validate(source, "sales", configure(source, { numberFormat })).data.rows[0].qty,
      1234.5,
    );
  }
  for (const [format, raw] of [
    ["comma-grouped", "12,34.5"],
    ["decimal-point", "1,25"],
    ["decimal-comma", "1,234.50"],
    ["decimal-point", "₱100"],
    ["decimal-point", "1e3"],
    ["decimal-point", ""],
    ["decimal-point", "-1"],
    ["decimal-point", "Infinity"],
  ]) {
    const source = `Date;SKU;Quantity\n2026-10-05;000123;${raw}`;
    assert.equal(
      validate(source, "sales", configure(source, { numberFormat: format })).data,
      null,
      raw,
    );
  }
});

test("precision, whole lead times, and exact numeric transport are checked before saving", () => {
  for (const raw of ["0", "0.0001", "9007199254740992", "99999999999999.999"]) {
    const result = validate(`Date,SKU,Quantity\n2026-10-05,000123,${raw}`);
    assert.equal(result.data, null, raw);
  }
  const text = `${inventoryHeader}\n000123,Synthetic Rice,Synthetic,bag,1.001,1.5,0.0001,0.00001`;
  const result = validate(text, "inventory");
  assert.deepEqual(
    result.issues.map((issue) => issue.field),
    ["lead", "safety", "cost"],
  );
  const allowed = validate(
    `${inventoryHeader}\n000123,Synthetic Rice,Synthetic,bag,1.001,0,0.001,0.0001`,
    "inventory",
  );
  assert.equal(allowed.data.rows[0].unitCost, 0.0001);
  assert.equal(
    validate(
      `${inventoryHeader}\n000123,Synthetic Rice,Synthetic,bag,1,2147483648,0,1`,
      "inventory",
    ).data,
    null,
  );
});

test("every field problem on every logical record is collected, with physical line numbers", () => {
  const text = `${salesHeader}\n2026-02-30,UNKNOWN,abc,"first\nkey"\n2026-10-05,000123,-1,key2\n2026-10-06,000123,2,key3`;
  const result = validate(text);
  assert.equal(result.rowCount, 3);
  assert.equal(result.invalidRowCount, 2);
  assert.equal(result.validRowCount, 1);
  assert.equal(result.issues.length, 4);
  assert.deepEqual(
    result.issues.map((issue) => [issue.record, issue.line]),
    [
      [2, 2],
      [2, 2],
      [2, 2],
      [3, 4],
    ],
  );
  assert.equal(result.data, null); // No valid subset is silently submitted.
  assert.match(csvIssueReport(result.issues), /"3","4","quantity"/);
});

test("manual product resolution preserves source records and applies consistently to matching identifiers", () => {
  const text =
    "Date,SKU,Quantity,Source Record Key\n2026-10-05,Legacy Rice,2,a\n2026-10-06,Legacy Rice,3,b";
  assert.deepEqual(validate(text).unresolvedProducts, [
    { source: "Legacy Rice", rows: 2, reason: "unknown" },
  ]);
  const result = validate(
    text,
    "sales",
    configure(text, { productMatches: { "Legacy Rice": product.id } }),
  );
  assert.equal(result.unresolvedProductCount, 0);
  assert.deepEqual(
    result.data.rows.map((row) => [row.productId, row.qty, row.sourceRecordKey]),
    [
      [product.id, 2, "a"],
      [product.id, 3, "b"],
    ],
  );
  assert.equal(products[0].currentStock, 20);
  const stale = validate(text, "sales", result.options, [{ ...product, isActive: false }]);
  assert.equal(stale.data, null);
  assert.match(stale.issues[0].message, /no longer active/);
});

test("matching tiers keep ambiguities, exact matches, IDs equal to SKUs, and inactive products safe", () => {
  const other = { ...product, id: "synthetic-2", sku: "OTHER", name: product.name };
  const ambiguous = "Date,SKU,Quantity\n2026-10-05,Synthetic Rice,1";
  assert.equal(
    validate(ambiguous, "sales", undefined, [product, other]).unresolvedProducts[0].reason,
    "ambiguous",
  );
  const exact = validate("Date,SKU,Quantity\n2026-10-05,000123,1", "sales", undefined, [
    product,
    other,
  ]);
  assert.equal(exact.data.rows[0].productId, product.id);
  assert.equal(
    validate("Date,SKU,Quantity\n2026-10-05,000123,1", "sales", undefined, [
      { ...product, id: product.sku },
    ]).data.rows[0].productId,
    product.sku,
  );
  assert.equal(
    validate("Date,SKU,Quantity\n2026-10-05,000123,1", "sales", undefined, [
      { ...product, isActive: false },
    ]).data,
    null,
  );
  assert.equal(
    validate("Date,SKU,Quantity\n2026-10-05,000123,1", "sales", undefined, [product, product]).data,
    null,
  );
});

test("counting units are validated without pack/piece conversions or catalog changes", () => {
  const wrong = validate("Date,SKU,Quantity,UOM\n2026-10-05,000123,10,piece");
  assert.equal(wrong.data, null);
  assert.equal(wrong.issues[0].field, "unit");
  assert.equal(validate("Date,SKU,Quantity,UOM\n2026-10-05,000123,10,BAG").data.rows[0].qty, 10);
  const inventory = validate(
    `${inventoryHeader}\n000123,Synthetic Rice,Synthetic,piece,10,3,1,40`,
    "inventory",
  );
  assert.match(inventory.issues[0].message, /counted in bag/);
  assert.equal(product.unit, "bag");
});

test("duplicate inventory SKUs block the atomic snapshot; new unique SKUs remain allowed", () => {
  const result = validate(
    `${inventoryHeader}\nNEW,New,Synthetic,piece,1,0,0,1\nnew,New,Synthetic,piece,2,0,0,1`,
    "inventory",
  );
  assert.equal(result.invalidRowCount, 1);
  assert.equal(result.data, null);
  assert.match(result.issues[0].message, /first appears in CSV record 2/);
  const valid = validate(`${inventoryHeader}\nNEW,New,Synthetic,piece,1,0,0,1`, "inventory");
  assert.equal(valid.data.rows.length, 1);
});

test("source keys are case-sensitive sale-line identities, and unkeyed equal sales are distinct", () => {
  const repeated = validate(
    `${salesHeader}\n2026-10-05,000123,1,a\n2026-10-05,000123,1,a\n2026-10-06,000123,2,a`,
  );
  assert.equal(repeated.data, null);
  assert.match(repeated.issues[0].message, /Repeated/);
  assert.match(repeated.issues[1].message, /Conflicting/);
  const invalidFirst = validate(`${salesHeader}\n2026-02-30,000123,1,a\n2026-10-05,000123,1,a`);
  assert.deepEqual(
    invalidFirst.issues.map((issue) => issue.field),
    ["date", "key"],
  );
  assert.equal(invalidFirst.invalidRowCount, 2);
  const distinct = validate(
    `${salesHeader}\n2026-10-05,000123,1,a\n2026-10-05,000123,1,A\n2026-10-05,000123,1,\n2026-10-05,000123,1,`,
  );
  assert.equal(distinct.data.rows.length, 4);
});

test("required text, column shape, and API length limits never receive invented defaults", () => {
  const result = validate(
    `${inventoryHeader}\nNEW,,Synthetic,,1,0,,1\nNEW2,New,Synthetic,piece,1,0,0,1,unexpected`,
    "inventory",
  );
  assert.deepEqual(
    result.issues.map((issue) => issue.field),
    ["name", "unit", "safety", "row"],
  );
  const long = validate(`${salesHeader}\n2026-10-05,000123,1,${"😀".repeat(201)}`);
  assert.equal(long.data, null);
  assert.equal(
    validate(`${salesHeader}\n2026-10-05,000123,1,${"😀".repeat(200)}`).data.rows.length,
    1,
  );
});

test("diagnostics and suggestions are bounded, while the downloadable report includes every problem", async () => {
  const huge = "unknown-" + "x".repeat(100_000);
  const rows = Array.from({ length: 75 }, (_, i) => `2026-02-30,Unknown-${i},bad,key:${i}`);
  rows[0] = `2026-02-30,${huge},bad,key:0`;
  const result = await prepareCsv(request(`${salesHeader}\n${rows.join("\n")}`));
  assert.equal(result.summary.guided.issueCount, 225);
  assert.equal(result.summary.guided.issuePreview.length, 50);
  assert.equal(result.summary.guided.unresolvedProducts.length, 50);
  assert.equal(result.summary.guided.unresolvedProductCount, 74);
  assert.equal(result.issues.length, 225);
  assert.ok(
    result.issues.every((issue) => issue.value.length <= 201 && issue.message.length < 400),
  );
  assert.equal(parseCsvRecords(csvIssueReport(result.issues)).length, 226);
  assert.ok(result.sourceText.includes(huge));
  assert.equal(result.data, null);
});

test("spreadsheet error exports neutralize formulas and preserve commas, quotes, and lines", () => {
  const values = ['=HYPERLINK("bad")', "+SUM(1)", " @evil", "-1", 'plain,"text"\nnext'];
  const issues = values.map((value, i) => ({
    record: i + 2,
    line: i + 2,
    field: "product",
    value,
    message: "Unknown product",
  }));
  const report = parseCsvRecords(csvIssueReport(issues));
  values.forEach((value, i) => assert.equal(report[i + 1].fields[3], i < 4 ? `'${value}` : value));
});

test("forced separators override detection/directives but retain quoting and record line identity", () => {
  const records = parseCsvRecords('sep=,\nDate;SKU;Quantity\n2026-10-05;000123;"1,250"', ";");
  assert.equal(records[0].line, 2);
  const options = {
    ...suggestCsvOptions(records, "sales"),
    delimiter: ";",
    numberFormat: "comma-grouped",
  };
  assert.equal(validateGuidedCsv(records, "sales", products, options).data.rows[0].qty, 1250);
});

test("guided preparation checks 100,000 rows in full and retains only bounded UI previews", async () => {
  const text =
    `${salesHeader}\n` +
    Array.from({ length: 100_000 }, (_, i) => `2026-10-05,000123,1.001,line:${i}`).join("\n");
  const result = await prepareCsv(request(text));
  assert.equal(result.summary.error, null);
  assert.equal(result.summary.guided.validRowCount, 100_000);
  assert.equal(result.summary.guided.convertedPreview.length, 50);
  assert.equal(result.summary.preview.length, 50);
  assert.equal(result.data.rows.length, 100_000);
  assert.equal(result.data.rows.at(-1).sourceRecordKey, "line:99999");
  const submission = csvRowsForSubmission(result.data);
  assert.equal(submission.rows.length, 100_000);
  assert.notEqual(submission.rows[0].id, result.data.rows[0].id);
  assert.equal(submission.rows.at(-1).qty, 1.001);
  const lateError = await prepareCsv(request(text + "\n2026-02-30,000123,1.0001,last"));
  assert.equal(lateError.summary.limitExceeded, true);
  assert.equal(lateError.summary.guided.validRowCount, 100_000);
  assert.equal(lateError.summary.guided.invalidRowCount, 1);
  assert.deepEqual(
    lateError.issues.map((issue) => issue.record),
    [100_002, 100_002],
  );
  assert.equal(lateError.data, null);
});

test("guided inventory respects the existing 5,000 row limit with no automatic splitting", async () => {
  const text =
    inventoryHeader +
    "\n" +
    Array.from({ length: 5001 }, (_, i) => `NEW-${i},Synthetic ${i},Synthetic,piece,1,0,0,1`).join(
      "\n",
    );
  const result = await prepareCsv(request(text, { kind: "inventory", rowLimit: 5000 }));
  assert.equal(result.summary.limitExceeded, true);
  assert.equal(result.summary.guided.validRowCount, 5001);
  assert.equal(result.data.rows.length, 5001);
  assert.match(result.summary.error, /5,001 inventory rows/);
});

test("empty files, header-only files and malformed quoting fail without partial rows", async () => {
  for (const text of ["", salesHeader, `${salesHeader}\n2026-10-05,000123,1,"unclosed`]) {
    const result = await prepareCsv(request(text));
    assert.ok(result.summary.error);
    assert.equal(result.data, null);
  }
});

test("missing inventory metadata accepts only explicitly entered verified shared values", () => {
  const text = "SKU,Product,On Hand\nNEW-A,Synthetic A,5\nNEW-B,Synthetic B,10";
  const options = configure(
    text,
    {
      constants: { category: "Synthetic", unit: "piece", lead: "3", safety: "1.5", cost: "0.2500" },
    },
    "inventory",
  );
  const result = validate(text, "inventory", options);
  assert.equal(result.data.rows.length, 2);
  assert.deepEqual(result.data.rows[1], {
    sku: "NEW-B",
    name: "Synthetic B",
    category: "Synthetic",
    unit: "piece",
    currentStock: 10,
    leadTimeDays: 3,
    safetyStock: 1.5,
    unitCost: 0.25,
  });
  const missing = validate(text, "inventory", {
    ...options,
    constants: { ...options.constants, unit: "" },
  });
  assert.equal(missing.data, null);
  assert.match(missing.configurationErrors[0], /Enter a verified value for Unit/);
  const inventedStock = validate(
    "SKU,Product\nNEW-A,Synthetic A",
    "inventory",
    configure(
      "SKU,Product\nNEW-A,Synthetic A",
      { constants: { ...options.constants, stock: "100" } },
      "inventory",
    ),
  );
  assert.equal(inventedStock.data, null);
  assert.match(inventedStock.configurationErrors[0], /On Hand/);
  const inventedSales = validate(
    "SKU,Quantity\n000123,1",
    "sales",
    configure("SKU,Quantity\n000123,1", { constants: { date: "2026-10-05" } }),
  );
  assert.equal(inventedSales.data, null);
  assert.match(inventedSales.configurationErrors[0], /Date/);
});
