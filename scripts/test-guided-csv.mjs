import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import { parseCsvRecords } from "../src/lib/import-csv.ts";
import { csvIssueReport, suggestCsvOptions, validateGuidedCsv } from "../src/lib/guided-csv.ts";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      ["./import-csv", "./guided-csv", "./csv-extraction"].includes(specifier) &&
      ["/csv-preparation.ts", "/csv-extraction.ts"].some((path) =>
        context.parentURL?.endsWith(path),
      )
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
  validateGuidedCsv(
    parseCsvRecords(text),
    kind,
    catalog,
    options ??
      (kind === "inventory"
        ? { ...suggestCsvOptions(parseCsvRecords(text), kind), inventoryDetails: "all" }
        : undefined),
  );
const configure = (text, changes = {}, kind = "sales") => ({
  ...suggestCsvOptions(parseCsvRecords(text), kind),
  ...(kind === "inventory" ? { inventoryDetails: "all" } : {}),
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

test("automatic preparation finds catalog identifiers and dates and ignores unrelated columns", async () => {
  const result = await prepareCsv(
    request(
      "Customer;Booked On;Legacy Identifier;Units Sold;Line Key\nIgnored;15/10/2026;000123;1,25;auto:1",
    ),
  );
  assert.equal(result.summary.error, null);
  assert.deepEqual(result.data.rows[0], {
    id: "prepared-2",
    productId: product.id,
    date: "2026-10-15",
    qty: 1.25,
    sourceRecordKey: "auto:1",
  });
});

test("unknown named identities never fall back to an unrelated catalog-looking receipt", async () => {
  const text = "Date,SKU,Product,Quantity,Receipt\n2026-10-05,OLD,Retired item,2,000123";
  const result = await prepareCsv(request(text));
  assert.equal(result.data, null);
  assert.equal(result.summary.guided.options.mapping.product, null);
  assert.match(result.summary.error, /unambiguous Product/);
  const options = {
    ...result.summary.guided.options,
    mapping: { ...result.summary.guided.options.mapping, product: 4 },
  };
  const intentional = await prepareCsv(request(text, { options }));
  assert.equal(intentional.summary.error, null);
  assert.equal(intentional.data.rows[0].productId, product.id);
});

test("recognized product names can resolve unknown legacy SKUs independently of unrelated values", async () => {
  const other = { ...product, id: "other", sku: "OTHER", name: "Other synthetic item" };
  const result = await prepareCsv(
    request("Date,SKU,Product,Quantity,Receipt\n2026-10-05,OLD,Synthetic Rice,2,OTHER", {
      products: [product, other],
    }),
  );
  assert.equal(result.summary.error, null);
  assert.equal(result.summary.guided.options.mapping.product, 2);
  assert.equal(result.data.rows[0].productId, product.id);
});

test("wide reports ignore unused columns and keep late mapped fields in bounded choices", async () => {
  const extras = Array.from({ length: 110 }, (_, index) => `Ignored ${index}`);
  for (const late of [false, true]) {
    const required = ["Date", "SKU", "Quantity", "Source Record Key"];
    const values = ["2026-10-05", product.sku, "2", "line:wide"];
    const header = late ? [...extras, ...required] : [...required, ...extras];
    const data = late ? [...extras, ...values] : [...values, ...extras];
    const result = await prepareCsv(request(`${header.join(",")}\n${data.join(",")}`));
    assert.equal(result.summary.error, null);
    assert.equal(result.data.rows[0].sourceRecordKey, "line:wide");
    const guide = result.summary.guided;
    assert.equal(guide.sourceColumnCount, 114);
    assert.ok(guide.columns.length <= 104);
    assert.equal(guide.columns.length, guide.columnIndices.length);
    for (const key of ["date", "product", "quantity", "key"]) {
      const column = guide.options.mapping[key];
      const choice = guide.columnIndices.indexOf(column);
      assert.ok(choice >= 0, key);
      assert.equal(guide.columns[choice], `${column + 1}: ${header[column]}`);
    }
    data[late ? 112 : 2] = "bad quantity";
    const invalid = await prepareCsv(request(`${header.join(",")}\n${data.join(",")}`));
    assert.equal(invalid.data, null);
    assert.equal(invalid.issues[0].field, "quantity");
  }
});

test("wide existing inventory counts retain only required values and validate late stock cells", async () => {
  const extras = Array.from({ length: 110 }, (_, index) => `Extra${index}`);
  const header = [...extras, "SKU", "On Hand", "Unit Cost"];
  const values = [...extras, product.sku, "7", "invalid ignored existing cost"];
  const result = await prepareCsv(
    request(`${header.join(",")}\n${values.join(",")}`, {
      kind: "inventory",
      rowLimit: 5000,
    }),
  );
  assert.equal(result.summary.error, null);
  assert.deepEqual(result.data.rows, [{ sku: product.sku, currentStock: 7 }]);
  assert.equal(result.summary.guided.sourceColumnCount, 113);
  assert.ok(result.summary.guided.columnIndices.includes(111));
});

test("wide Adjust import keeps original automatic columns available after clearing or remapping", async () => {
  const extras = Array.from({ length: 110 }, (_, index) => `Ignored${index}`);
  const header = [...extras, "Date", "SKU", "Quantity"];
  const values = extras.map(() => "unrelated");
  values[0] = product.sku;
  values[1] = "2026-10-05";
  const text = `${header.join(",")}\n${[...values, "2026-10-05", product.sku, "2"].join(",")}`;
  const original = await prepareCsv(request(text));
  assert.equal(original.summary.error, null);
  const options = original.summary.guided.options;
  assert.equal(options.mapping.product, 111);
  for (const [field, originalColumn, earlyColumn, label] of [
    ["product", 111, 0, "112: SKU"],
    ["date", 110, 1, "111: Date"],
  ])
    for (const column of [null, earlyColumn]) {
      const changed = await prepareCsv(
        request(text, {
          options: {
            ...options,
            mapping: { ...options.mapping, [field]: column },
          },
        }),
      );
      const guide = changed.summary.guided;
      assert.equal(guide.options.mapping[field], column);
      const choice = guide.columnIndices.indexOf(originalColumn);
      assert.ok(choice >= 0, "The originally detected field must remain selectable");
      assert.equal(guide.columns[choice], label);
      assert.ok(guide.columns.length <= 105);
      const restored = await prepareCsv(
        request(text, {
          options: {
            ...guide.options,
            mapping: { ...guide.options.mapping, [field]: originalColumn },
          },
        }),
      );
      assert.equal(restored.summary.error, null);
      assert.equal(restored.data.rows[0].productId, product.id);
    }
});

test("wide catalog-inferred identity columns remain selectable after an optional override", async () => {
  const extras = Array.from({ length: 110 }, (_, index) => `Ignored${index}`);
  const header = [...extras, "Date", "Legacy Identifier", "Quantity"];
  const text = `${header.join(",")}\n${[
    ...extras.map(() => "unrelated"),
    "2026-10-05",
    product.sku,
    "2",
  ].join(",")}`;
  const original = await prepareCsv(request(text));
  assert.equal(original.summary.error, null);
  assert.equal(original.summary.guided.options.mapping.product, 111);
  const options = original.summary.guided.options;
  const cleared = await prepareCsv(
    request(text, {
      options: { ...options, mapping: { ...options.mapping, product: null } },
    }),
  );
  assert.equal(cleared.data, null);
  const guide = cleared.summary.guided;
  const choice = guide.columnIndices.indexOf(111);
  assert.ok(choice >= 0);
  assert.equal(guide.columns[choice], "112: Legacy Identifier");
  assert.ok(guide.columns.length <= 103);
});

test("quoted backend exports preserve guarded SKU and real source keys during automatic re-import", async () => {
  const catalog = [{ ...product, sku: "=SYN" }];
  const rows = [
    ["id", "sku", "sale_date", "quantity", "source", "data_origin", "source_record_key"],
    ["server-sale-id", "\t=SYN", "2026-10-05", "2", "import", "synthetic", "\t+pos:1"],
  ];
  const text = rows
    .map((fields) => fields.map((value) => `"${value.replaceAll('"', '""')}"`).join(","))
    .join("\r\n");
  const result = await prepareCsv(request(text, { products: catalog }));
  assert.equal(result.summary.error, null);
  assert.equal(result.data.rows[0].productId, product.id);
  assert.equal(result.data.rows[0].sourceRecordKey, "+pos:1");
  assert.equal(result.data.rows[0].qty, 2);
  assert.equal(result.summary.guided.options.mapping.key, 6);
  assert.equal(result.sourceText, text);
});

test("ambiguous dates and quantities prepare automatically with stable defaults and allow overrides", async () => {
  const text = "Date;SKU;Quantity\n05/10/2026;000123;1,234";
  const result = await prepareCsv(request(text));
  assert.equal(result.summary.error, null);
  assert.equal(result.summary.guided.options.dateFormat, "dmy");
  assert.equal(result.summary.guided.options.numberFormat, "comma-grouped");
  assert.equal(result.data.rows[0].date, "2026-10-05");
  assert.equal(result.data.rows[0].qty, 1234);
  assert.equal(result.summary.guided.convertedPreview.length, 1);
  const dotted = await prepareCsv(request(text.replace("1,234", "1.234")));
  assert.equal(dotted.summary.error, null);
  assert.equal(dotted.data.rows[0].qty, 1.234);
  assert.equal(dotted.summary.guided.options.numberFormat, "decimal-point");
  const options = {
    ...result.summary.guided.options,
    dateFormat: "dmy",
    dateConfirmed: true,
    numberFormat: "decimal-comma",
    numberConfirmed: true,
  };
  const confirmed = await prepareCsv(request(text, { options }));
  assert.equal(confirmed.summary.error, null);
  assert.equal(confirmed.data.rows[0].date, "2026-10-05");
  assert.equal(confirmed.data.rows[0].qty, 1.234);
  const monthFirst = await prepareCsv(
    request(text, { options: { ...options, dateFormat: "mdy" } }),
  );
  assert.equal(monthFirst.data.rows[0].date, "2026-05-10");
  assert.equal(
    (await prepareCsv(request(text, { options: { ...options, numberFormat: "comma-grouped" } })))
      .data.rows[0].qty,
    1234,
  );
});

test("format detection uses evidence beyond the preview and retains malformed row errors", async () => {
  const text =
    "Date;SKU;Quantity\n" +
    Array.from({ length: 250 }, () => "05/10/2026;000123;1,234").join("\n") +
    "\n15/10/2026;000123;1,25\n31/04/2026;000123;bad";
  const result = await prepareCsv(request(text));
  assert.equal(result.data, null);
  assert.equal(result.summary.guided.options.dateFormat, "dmy");
  assert.equal(result.summary.guided.options.numberFormat, "decimal-comma");
  assert.equal(result.summary.guided.validRowCount, 251);
  assert.equal(result.summary.guided.invalidRowCount, 1);
  assert.deepEqual(
    result.issues.map((item) => item.field),
    ["date", "quantity"],
  );
});

test("equivalent interpretations need no question but revenue is never guessed as units sold", async () => {
  const equivalent = await prepareCsv(request("Date,SKU,Quantity\n01/01/2026,000123,2"));
  assert.equal(equivalent.summary.error, null);
  assert.equal(equivalent.data.rows[0].date, "2026-01-01");
  const revenue = await prepareCsv(request("When,Identifier,Amount\n2026-10-05,000123,200"));
  assert.equal(revenue.data, null);
  assert.equal(revenue.summary.guided.options.mapping.date, 0);
  assert.equal(revenue.summary.guided.options.mapping.product, 1);
  assert.equal(revenue.summary.guided.options.mapping.quantity, null);
});

test("common export aliases and punctuation automatically extract needed fields without receipt-wide keys", async () => {
  const result = await prepareCsv(
    request(
      "Customer;Qty. Sold;Item No.;Sale Date;Unit of Measure;Receipt No.;Amount;Line Key\nIgnored;1,25;000123;15/10/2026;bag;receipt:1;50;line:1",
    ),
  );
  assert.equal(result.summary.error, null);
  assert.deepEqual(result.data.rows[0], {
    id: "prepared-2",
    productId: product.id,
    date: "2026-10-15",
    qty: 1.25,
    sourceRecordKey: "line:1",
  });
  const noLineKey = await prepareCsv(
    request(
      "Sale Date,Product ID,Sales Qty,Receipt No.,Revenue,Unit Cost\n2026-10-05,synthetic-1,2,receipt:1,80,40",
    ),
  );
  assert.equal(noLineKey.summary.error, null);
  assert.equal(Object.hasOwn(noLineKey.data.rows[0], "sourceRecordKey"), false);
  assert.equal(noLineKey.data.rows[0].qty, 2);
  const stock = await prepareCsv(
    request("Item No.;Stock Count;Supplier\n000123;1,25;ignored", {
      kind: "inventory",
      rowLimit: 5000,
    }),
  );
  assert.equal(stock.summary.error, null);
  assert.deepEqual(stock.data.rows, [{ sku: "000123", currentStock: 1.25 }]);
});

test("historical sales quantities are never detected as current inventory stock counts", async () => {
  for (const quantityHeader of ["Quantity", "Qty", "Units Sold"]) {
    const result = await prepareCsv(
      request(`Date,SKU,${quantityHeader}\n2026-10-05,000123,2`, {
        kind: "inventory",
        rowLimit: 5000,
      }),
    );
    assert.equal(result.data, null);
    assert.equal(result.summary.guided.options.mapping.stock, null);
    assert.match(result.summary.error, /stock-count column/);
  }
});

test("conflicting repeated headers block whole-file preparation while agreeing duplicates import automatically", async () => {
  for (const [kind, text, field] of [
    ["sales", "Date,SKU,Quantity,Quantity\n2026-10-05,000123,1,2", "Quantity"],
    ["sales", "Date,Date,SKU,Quantity\n2026-10-05,bad,000123,1", "Date"],
    ["sales", "Date,SKU,SKU,Quantity\n2026-10-05,000123,UNKNOWN,1", "Product / SKU"],
    [
      "sales",
      "Date,Product,SKU,SKU,Quantity\n2026-10-05,Synthetic Rice,000123,UNKNOWN,1",
      "Product / SKU",
    ],
    ["sales", "Date,SKU,Quantity,Qty\n2026-10-05,000123,1,2", "Quantity"],
    ["sales", "Date,SKU,Units Sold,Quantity Sold\n2026-10-05,000123,1,2", "Quantity"],
    ["inventory", "SKU,On Hand,On Hand\n000123,1,2", "On Hand"],
    ["inventory", "SKU,On Hand,Current Stock\n000123,1,2", "On Hand"],
    ["inventory", "SKU,On Hand,Stock Count\n000123,1,2", "On Hand"],
    ["inventory", "SKU,On Hand,Unit Cost,Unit Cost\nNEW,1,40,50", "Unit Cost"],
    ["inventory", "SKU,On Hand,Product Name,Product Name\nNEW,1,Rice,Beans", "Product name"],
    [
      "sales",
      "Date,SKU,Quantity,Source Record Key,Source Record Key\n2026-10-05,000123,1,a,b",
      "Source Record Key",
    ],
  ]) {
    const conflict = await prepareCsv(request(text, { kind }));
    assert.equal(conflict.data, null, text);
    assert.ok(
      conflict.summary.guided.configurationErrors.some(
        (error) => error.includes(field) && error.includes("CSV headers"),
      ),
      text,
    );
  }
  for (const [kind, text] of [
    ["sales", "Date,SKU,Quantity,Quantity\n2026-10-05,000123,2,2"],
    ["sales", "Date,SKU,Quantity,Qty\n2026-10-05,000123,2,2"],
    ["sales", "Date,SKU,Units Sold,Quantity Sold\n2026-10-05,000123,2,2"],
    ["inventory", "SKU,On Hand,On Hand\n000123,2,2"],
    ["inventory", "SKU,On Hand,Current Stock\n000123,2,2"],
  ]) {
    const agreed = await prepareCsv(request(text, { kind }));
    assert.equal(agreed.summary.error, null, text);
    assert.equal(agreed.data.rows.length, 1);
  }
  const lateConflict = await prepareCsv(
    request(
      "Date,SKU,Quantity,Quantity\n" +
        Array.from({ length: 250 }, () => "2026-10-05,000123,1,1").join("\n") +
        "\n2026-10-05,000123,1,2",
    ),
  );
  assert.equal(lateConflict.data, null);
  assert.match(lateConflict.summary.error, /CSV headers/);
});

test("late file evidence selects month-first dates and mixed locale rows still block the whole import", async () => {
  const result = await prepareCsv(
    request(
      "Date;SKU;Quantity\n" +
        Array.from({ length: 250 }, () => "05/10/2026;000123;1,234").join("\n") +
        "\n10/15/2026;000123;2.50",
    ),
  );
  assert.equal(result.summary.error, null);
  assert.equal(result.summary.guided.options.dateFormat, "mdy");
  assert.equal(result.summary.guided.options.numberFormat, "comma-grouped");
  assert.equal(result.data.rows[0].date, "2026-05-10");
  assert.equal(result.data.rows.at(-1).date, "2026-10-15");
  assert.equal(result.data.rows.at(-1).qty, 2.5);
  for (const text of [
    "Date;SKU;Quantity\n15/10/2026;000123;1\n10/15/2026;000123;2",
    "Date;SKU;Quantity\n2026-10-05;000123;1,25\n2026-10-06;000123;1.25",
  ]) {
    const mixed = await prepareCsv(request(text));
    assert.equal(mixed.data, null);
    assert.ok(mixed.issues.length > 0);
  }
});

test("redundant SKU and name columns are accepted only when their product identities agree", async () => {
  const text = "Date,SKU,Product Name,Quantity\n2026-10-05,000123,Synthetic Rice,2";
  assert.equal((await prepareCsv(request(text))).summary.error, null);
  const other = { ...product, id: "other", sku: "other", name: "Other" };
  const conflict = await prepareCsv(
    request(text.replace("Synthetic Rice", "Other"), { products: [product, other] }),
  );
  assert.equal(conflict.data, null);
  assert.equal(conflict.summary.guided.options.mapping.product, null);
});

test("automatic identity inference blocks known contradictions despite unknown SKUs elsewhere", async () => {
  const catalog = [
    { ...product, id: "a", sku: "A", name: "Alpha" },
    { ...product, id: "b", sku: "B", name: "Beta" },
  ];
  for (const secondSku of ["OLD", "A"]) {
    const result = await prepareCsv(
      request(`Date,SKU,Product,Quantity\n2026-10-05,A,Beta,2\n2026-10-06,${secondSku},Beta,3`, {
        products: catalog,
      }),
    );
    assert.equal(result.data, null);
    assert.equal(result.summary.guided.options.mapping.product, null);
    assert.match(result.summary.error, /unambiguous Product \/ SKU/);
  }
});

test("automatic identity conflict checks include records beyond the converted preview", async () => {
  const catalog = [
    { ...product, id: "a", sku: "A", name: "Alpha" },
    { ...product, id: "b", sku: "B", name: "Beta" },
  ];
  const rows = Array.from(
    { length: 60 },
    (_, index) => `2026-10-05,${index === 0 ? "OLD" : index === 59 ? "A" : "B"},Beta,2`,
  );
  const result = await prepareCsv(
    request(`Date,SKU,Product,Quantity\n${rows.join("\n")}`, { products: catalog }),
  );
  assert.equal(result.summary.rowCount, 60);
  assert.equal(result.data, null);
  assert.equal(result.summary.guided.options.mapping.product, null);
  assert.match(result.summary.error, /unambiguous Product \/ SKU/);
});

test("unknown legacy SKUs still fall back to known names when every known identity agrees", async () => {
  const catalog = [
    { ...product, id: "a", sku: "A", name: "Alpha" },
    { ...product, id: "b", sku: "B", name: "Beta" },
  ];
  const result = await prepareCsv(
    request("Date,SKU,Product,Quantity\n2026-10-05,OLD,Beta,2\n2026-10-06,B,Beta,3", {
      products: catalog,
    }),
  );
  assert.equal(result.summary.error, null);
  assert.equal(result.summary.guided.options.mapping.product, 2);
  assert.deepEqual(
    result.data.rows.map((row) => [row.productId, row.qty]),
    [
      ["b", 2],
      ["b", 3],
    ],
  );
});

test("agreeing SKU, ID and name columns resolve inactive historical products automatically", async () => {
  const inactive = { ...product, id: "b", sku: "B", name: "Beta", isActive: false };
  const original = structuredClone(inactive);
  const result = await prepareCsv(
    request("Date,SKU,Product ID,Product Name,Quantity\n2026-10-05,B,b,Beta,2", {
      products: [inactive],
    }),
  );
  assert.equal(result.summary.error, null);
  assert.equal(result.summary.guided.options.mapping.product, 1);
  assert.equal(result.data.rows[0].productId, "b");
  assert.deepEqual(inactive, original);
});

test("explicit product-column and manual-match overrides retain their reviewed meaning", async () => {
  const catalog = [
    { ...product, id: "a", sku: "A", name: "Alpha" },
    { ...product, id: "b", sku: "B", name: "Beta" },
  ];
  const text = "Date,SKU,Product,Quantity\n2026-10-05,A,Beta,2\n2026-10-06,OLD,Beta,3";
  const automatic = await prepareCsv(request(text, { products: catalog }));
  const options = {
    ...automatic.summary.guided.options,
    mapping: { ...automatic.summary.guided.options.mapping, product: 1 },
    productMatches: { OLD: "b" },
  };
  const reviewed = await prepareCsv(request(text, { products: catalog, options }));
  assert.equal(reviewed.summary.error, null);
  assert.deepEqual(
    reviewed.data.rows.map((row) => [row.productId, row.qty]),
    [
      ["a", 2],
      ["b", 3],
    ],
  );
});

test("saved inventory metadata is previewed but omitted from count-only update requests", async () => {
  const result = await prepareCsv(
    request("SKU;Stock On Hand;Supplier\n000123;1,25;ignored", {
      kind: "inventory",
      rowLimit: 5000,
    }),
  );
  assert.equal(result.summary.error, null);
  assert.equal(result.summary.guided.reusedInventoryRows, 1);
  assert.deepEqual(result.data.rows, [{ sku: "000123", currentStock: 1.25 }]);
  assert.deepEqual(result.summary.guided.convertedPreview[0].fields, [
    "000123",
    "Synthetic Rice",
    "Synthetic",
    "bag",
    "1.25",
    "3",
    "1",
    "40",
  ]);
});

test("automatic existing-product counts ignore unused metadata and preserve their saved details", async () => {
  const text =
    "SKU;Inventory Level;Product;Category;Unit;Lead Time;Safety Stock;Unit Cost;Unit Cost;Supplier\n000123;1.234;;; ;1,25;bad;₱40;contradiction;ignored";
  const result = await prepareCsv(request(text, { kind: "inventory", rowLimit: 5000 }));
  assert.equal(result.summary.error, null);
  assert.equal(result.summary.guided.options.inventoryDetails, "new-only");
  assert.equal(result.summary.guided.options.numberFormat, "decimal-point");
  assert.equal(result.summary.guided.reusedInventoryRows, 1);
  assert.deepEqual(result.data.rows, [{ sku: "000123", currentStock: 1.234 }]);
  assert.deepEqual(result.summary.guided.convertedPreview[0].fields, [
    "000123",
    "Synthetic Rice",
    "Synthetic",
    "bag",
    "1.234",
    "3",
    "1",
    "40",
  ]);
  const updateDetails = await prepareCsv(
    request(text, {
      kind: "inventory",
      rowLimit: 5000,
      options: { ...result.summary.guided.options, inventoryDetails: "all" },
    }),
  );
  assert.equal(updateDetails.data, null);
  assert.ok(updateDetails.issues.some((issue) => issue.field === "name"));
  assert.ok(updateDetails.issues.some((issue) => issue.field === "cost"));
});

test("mixed inventory files use source details only for new products and never invent missing new details", async () => {
  const text =
    "SKU;Product;Category;Unit;On Hand;Lead Time;Safety Stock;Unit Cost;Unit Cost\n" +
    "000123;;;;2;not needed;bad;₱40;ignored\n" +
    "NEW;New Rice;Staples;bag;5;2;0.5;10.50;10.50";
  const result = await prepareCsv(request(text, { kind: "inventory", rowLimit: 5000 }));
  assert.equal(result.summary.error, null);
  assert.equal(result.summary.guided.reusedInventoryRows, 1);
  assert.deepEqual(result.data.rows, [
    { sku: "000123", currentStock: 2 },
    {
      sku: "NEW",
      name: "New Rice",
      category: "Staples",
      unit: "bag",
      currentStock: 5,
      leadTimeDays: 2,
      safetyStock: 0.5,
      unitCost: 10.5,
    },
  ]);
  const missing = await prepareCsv(
    request(text.replace("NEW;New Rice;Staples;bag", "NEW;;Staples;bag"), {
      kind: "inventory",
      rowLimit: 5000,
    }),
  );
  assert.equal(missing.data, null);
  assert.equal(missing.summary.guided.validRowCount, 1);
  assert.equal(missing.summary.guided.invalidRowCount, 1);
  assert.equal(missing.issues[0].field, "name");
});

test("ignoring existing inventory metadata retains all explicit nonblank unit checks", async () => {
  for (const text of [
    "SKU,Stock,Unit\n000123,2,piece",
    "SKU,Stock,Unit,UOM\n000123,2,bag,piece",
    "SKU,Stock,Unit,Unit\n000123,2,bag,piece",
  ]) {
    const result = await prepareCsv(request(text, { kind: "inventory", rowLimit: 5000 }));
    assert.equal(result.data, null, text);
    assert.ok(
      result.issues.some((issue) => issue.field === "unit"),
      text,
    );
  }
});

test("unused trailing CSV cells may vary while required values, units, and stable keys retain validation", async () => {
  const text =
    "Date,SKU,Quantity,Unit,Source Record Key,Notes\n" +
    "2026-10-05,000123,2,,key:1\n" +
    "2026-10-06,000123,3,bag,key:2,ignored,extra\n" +
    "2026-10-07,000123,4";
  const result = await prepareCsv(request(text));
  assert.equal(result.summary.error, null);
  assert.deepEqual(
    result.data.rows.map((row) => [row.qty, row.sourceRecordKey]),
    [
      [2, "key:1"],
      [3, "key:2"],
      [4, undefined],
    ],
  );
  const inventory = await prepareCsv(
    request("SKU,On Hand,Notes\n000123,2", {
      kind: "inventory",
      rowLimit: 5000,
    }),
  );
  assert.equal(inventory.summary.error, null);
  for (const broken of [
    text + "\n2026-10-08,000123",
    text.replace("3,bag,key:2", "3,piece,key:2"),
    text.replace("key:2", "key:1"),
    text + '\n2026-10-08,000123,1,bag,key:3,"unclosed',
  ]) {
    const invalid = await prepareCsv(request(broken));
    assert.equal(invalid.data, null, broken);
    assert.ok(invalid.summary.error);
  }
});

test("count-only inventory rejects incomplete new SKUs and incompatible nonblank units", async () => {
  const mixed = await prepareCsv(
    request("SKU,On Hand\n000123,2\nNEW,3", { kind: "inventory", rowLimit: 5000 }),
  );
  assert.equal(mixed.data, null);
  assert.equal(mixed.summary.guided.validRowCount, 1);
  assert.equal(mixed.summary.guided.invalidRowCount, 1);
  assert.equal(mixed.issues.length, 6);
  const blankUnit = await prepareCsv(
    request("SKU,On Hand,Unit\n000123,2,", { kind: "inventory", rowLimit: 5000 }),
  );
  assert.equal(blankUnit.summary.error, null);
  assert.deepEqual(blankUnit.data.rows, [{ sku: "000123", currentStock: 2 }]);
  for (const unit of ["piece"]) {
    const result = await prepareCsv(
      request(`SKU,On Hand,Unit\n000123,2,${unit}`, { kind: "inventory", rowLimit: 5000 }),
    );
    assert.equal(result.data, null);
    assert.equal(result.issues[0].field, "unit");
  }
});

test("a headerless sale containing a header-like SKU is not discarded", async () => {
  const catalog = [{ ...product, sku: "SKU" }];
  const result = await prepareCsv(request("2026-10-05,SKU,2", { products: catalog }));
  assert.equal(result.summary.error, null);
  assert.equal(result.summary.rowCount, 1);
  assert.equal(result.summary.guided.options.header, false);
});

test("ignored saved-product lead times cannot change stock number interpretation; explicit detail updates still validate", async () => {
  const text = "SKU;On Hand;Lead Time\n000123;1.001;1.001";
  const pending = await prepareCsv(request(text, { kind: "inventory", rowLimit: 5000 }));
  assert.equal(pending.summary.error, null);
  assert.deepEqual(pending.data.rows, [{ sku: "000123", currentStock: 1.001 }]);
  assert.equal(pending.summary.guided.options.numberFormat, "decimal-point");
  assert.equal(pending.issues.length, 0);
  assert.equal(pending.summary.guided.convertedPreview[0].fields[4], "1.001");
  const options = {
    ...pending.summary.guided.options,
    numberFormat: "decimal-point",
    numberConfirmed: true,
    inventoryDetails: "all",
  };
  const corrected = await prepareCsv(request(text, { kind: "inventory", rowLimit: 5000, options }));
  assert.equal(corrected.data, null);
  assert.deepEqual(
    corrected.issues.map((item) => item.field),
    ["lead"],
  );
  assert.equal(corrected.summary.guided.convertedPreview[0].fields[4], "1.001");
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

test("conflicting quantity synonyms stay invalid while explicit sold quantities take priority", async () => {
  const text = "Date,SKU,Product Name,Quantity,Qty\n2026-10-05,000123,Synthetic Rice,1,2";
  const automatic = await prepareCsv(request(text));
  assert.equal(automatic.data, null);
  assert.match(automatic.summary.error, /equivalent CSV headers/);
  assert.equal(automatic.summary.guided.options.mapping.product, 1);
  const explicitSold = await prepareCsv(request(text.replace("Qty", "Units Sold")));
  assert.equal(explicitSold.summary.error, null);
  assert.equal(explicitSold.data.rows[0].qty, 2);
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
  const inactive = validate(text, "sales", result.options, [{ ...product, isActive: false }]);
  assert.equal(inactive.data.rows.length, 2);
  const stale = validate(text, "sales", result.options, []);
  assert.equal(stale.data, null);
  assert.match(stale.issues[0].message, /no longer in the catalog/);
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
    ]).data.rows[0].productId,
    product.id,
  );
  assert.equal(
    validate("Date,SKU,Quantity\n2026-10-05,000123,1", "sales", undefined, [product, product]).data,
    null,
  );
});

test("historical sales automatically include inactive catalog products without changing them", async () => {
  const catalog = [
    {
      ...product,
      id: "sample-water",
      sku: "SAMPLE-WATER",
      name: "Sample Water 500ml",
      unit: "bottle",
      isActive: false,
    },
    {
      ...product,
      id: "sample-noodles",
      sku: "SAMPLE-NOODLES",
      name: "Sample Instant Noodles",
      unit: "pack",
      isActive: true,
    },
    { ...product, id: "sample-rice", sku: "SAMPLE-RICE", name: "Sample Rice 1kg", isActive: true },
  ];
  const original = structuredClone(catalog);
  const rows = Array.from({ length: 7 }, (_, day) =>
    catalog.map((item) => `2026-10-0${day + 1},${item.sku},${item.name},12`).join("\n"),
  ).join("\n");
  // Both SKU and product-name columns must agree across active and inactive products.
  const result = await prepareCsv(
    request(`Date,SKU,Product Name,Quantity\n${rows}`, { products: catalog }),
  );
  assert.equal(result.summary.error, null);
  assert.equal(result.summary.guided.unresolvedProductCount, 0);
  assert.equal(result.summary.guided.validRowCount, 21);
  assert.equal(result.data.rows.length, 21);
  assert.equal(result.data.rows.filter((row) => row.productId === "sample-water").length, 7);
  assert.deepEqual(catalog, original);
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
    ["name", "unit", "safety"],
  );
  assert.equal(result.validRowCount, 1);
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
  const options = configure(text, { numberConfirmed: true });
  const result = await prepareCsv(request(text, { options }));
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
  const lateError = await prepareCsv(
    request(text + "\n2026-02-30,000123,1.0001,last", { options }),
  );
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
