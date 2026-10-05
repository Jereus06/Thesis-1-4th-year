import assert from "node:assert/strict";
import test from "node:test";
import {
  decodeCsvFile,
  parseCsvRecords,
  parseInventoryCsv,
  parseSalesCsv,
} from "../src/lib/import-csv.ts";

const product = {
  id: "synthetic-product",
  sku: "SYNTHETIC-001",
  name: 'Rice, "Premium"\n5 kg',
  category: "Staples",
  unit: "bag",
  currentStock: 20,
  leadTimeDays: 3,
  safetyStock: 5,
  unitCost: 45,
};
const products = [product];
const inventoryHeader = "SKU,Product,Category,Unit,On Hand,Lead Time,Safety Stock,Unit Cost";
const withoutIds = (rows) => rows.map(({ id: _id, ...row }) => row);

test("quoted commas, escaped quotes, and multiline values remain in one logical record", () => {
  const records = parseCsvRecords('SKU,Product\r\nSYNTHETIC-001,"Rice, ""Premium""\r\n5 kg"\r\n');
  assert.deepEqual(records, [
    { fields: ["SKU", "Product"], record: 1, line: 1 },
    { fields: ["SYNTHETIC-001", product.name.replace("\n", "\r\n")], record: 2, line: 2 },
  ]);
});

test("blank lines are ignored, quoted empties and trailing fields remain", () => {
  assert.deepEqual(parseCsvRecords('\n  \n"",value,\n'), [
    { fields: ["", "value", ""], record: 1, line: 3 },
  ]);
});

test("spreadsheet BOM, sep directive, semicolon delimiter, and CR line endings work", () => {
  const csv = "\uFEFFsep=;\rDate;SKU;Quantity\r2026-09-01;SYNTHETIC-001;2\r";
  assert.deepEqual(withoutIds(parseSalesCsv(csv, products)), [
    { productId: product.id, date: "2026-09-01", qty: 2 },
  ]);
  assert.equal(parseCsvRecords(csv)[0].line, 2);
});

test("semicolon and tab spreadsheet exports are detected without a directive", () => {
  for (const delimiter of [";", "\t"]) {
    const csv = [
      ["Date", "SKU", "Quantity"].join(delimiter),
      ["2026-09-01", product.sku, "2.5"].join(delimiter),
    ].join("\r\n");
    assert.equal(parseSalesCsv(csv, products)[0].qty, 2.5);
  }
});

test("a tab separator directive preserves quoted tabs", () => {
  assert.deepEqual(parseCsvRecords('sep=\t\n"left\tright"\tvalue')[0].fields, [
    "left\tright",
    "value",
  ]);
});

for (const [text, reason] of [
  ['Date,Product,Quantity\n2026-09-01,"Unclosed\nname,2', /Unclosed quoted field/],
  ['Date,Product,Quantity\n2026-09-01,Ri"ce,2', /quote inside a field/],
  ['Date,Product,Quantity\n2026-09-01,"Rice"oops,2', /Unexpected text after a closing quote/],
]) {
  test(`malformed quoted data reports its logical record and starting line: ${reason.source}`, () => {
    assert.throws(
      () => parseCsvRecords(text),
      (error) => {
        assert.match(error.message, /CSV record 2 \(line 2\)/);
        assert.match(error.message, reason);
        return true;
      },
    );
  });
}

test("inventory uses decoded names and reorders named spreadsheet columns", () => {
  const csv =
    'Unit Cost,SKU,Unit,Product,On Hand,Category,Safety Stock,Lead Time\n45,SYNTHETIC-001,bag,"Rice, ""Premium""\n5 kg",20,Staples,5,3';
  const { id: _id, ...expected } = product;
  assert.deepEqual(parseInventoryCsv(csv), [expected]);
});

test("inventory column counts and blank quantities are rejected before import", () => {
  for (const row of [
    "SYNTHETIC-001,Rice,Staples,bag,20,3,5",
    "SYNTHETIC-001,Rice,Staples,bag,20,3,5,45,extra",
    "SYNTHETIC-001,Rice,Staples,bag,,3,5,45",
  ]) {
    assert.throws(() => parseInventoryCsv(`${inventoryHeader}\n${row}`), /CSV record 2 \(line 2\)/);
  }
});

test("sales match quoted multiline product names", () => {
  const csv = 'Date,Product,Quantity\n2026-09-01,"Rice, ""Premium""\n5 kg",2';
  assert.deepEqual(withoutIds(parseSalesCsv(csv, products)), [
    { productId: product.id, date: "2026-09-01", qty: 2 },
  ]);
});

test("named sales columns preserve case-sensitive stable IDs and equal-looking separate sales", () => {
  const csv =
    "source_record_key,Quantity,sku,sale_date\nTill-A:10:1,2,SYNTHETIC-001,2026-09-01\nTill-A:10:2,2,SYNTHETIC-001,2026-09-01";
  assert.deepEqual(withoutIds(parseSalesCsv(csv, products)), [
    { productId: product.id, date: "2026-09-01", qty: 2, sourceRecordKey: "Till-A:10:1" },
    { productId: product.id, date: "2026-09-01", qty: 2, sourceRecordKey: "Till-A:10:2" },
  ]);
});

test("three-column imports remain supported and four-column keys are never synthesized", () => {
  assert.equal(
    "sourceRecordKey" in parseSalesCsv("2026-09-01,SYNTHETIC-001,2", products)[0],
    false,
  );
  assert.equal(
    "sourceRecordKey" in parseSalesCsv("2026-09-01,SYNTHETIC-001,2,   ", products)[0],
    false,
  );
  assert.equal(
    parseSalesCsv("2026-09-01,SYNTHETIC-001,2,  Till:1  ", products)[0].sourceRecordKey,
    "Till:1",
  );
});

test("all source-key header aliases preserve literal ID content", () => {
  for (const column of ["Source Record Key", "source_record_key", "sourceRecordKey"]) {
    const csv = `Date,SKU,Quantity,${column}\n2026-09-01,SYNTHETIC-001,2,"Till ""A""\nLine 1"`;
    assert.equal(parseSalesCsv(csv, products)[0].sourceRecordKey, 'Till "A"\nLine 1');
  }
});

test("source keys longer than the API limit are rejected with a record diagnostic", () => {
  assert.throws(
    () => parseSalesCsv(`2026-09-01,SYNTHETIC-001,2,${"a".repeat(201)}`, products),
    /CSV record 1 \(line 1\): Source Record Key must be at most 200 characters/,
  );
});

test("invalid dates, quantities, products, and unsupported headers are rejected", () => {
  for (const row of [
    "2026-02-30,SYNTHETIC-001,2",
    "09/01/2026,SYNTHETIC-001,2",
    "2026-09-01,SYNTHETIC-001,",
    "2026-09-01,SYNTHETIC-001,-2",
    "2026-09-01,UNKNOWN,2",
  ])
    assert.throws(() => parseSalesCsv(row, products), /CSV record 1 \(line 1\)/);
  assert.throws(
    () => parseSalesCsv("id,sku,sale_date,quantity,source,data_origin", products),
    /Unsupported column "id"/,
  );
  assert.throws(
    () => parseSalesCsv("Date,SKU,Quantity,sourceRecordKey,source_record_key", products),
    /Duplicate column/,
  );
});

test("file decoding supports UTF-8 with or without BOM and UTF-16LE/BE spreadsheet BOMs", () => {
  const text =
    "Date\tSKU\tQuantity\tSource Record Key\r\n2026-09-01\tSYNTHETIC-001\t2\tCafé-日本語-😀";
  const utf8 = new TextEncoder().encode(text);
  const utf16le = new Uint8Array(text.length * 2);
  const utf16be = new Uint8Array(text.length * 2);
  for (let index = 0; index < text.length; index++) {
    const value = text.charCodeAt(index);
    utf16le[index * 2] = value & 0xff;
    utf16le[index * 2 + 1] = value >> 8;
    utf16be[index * 2] = value >> 8;
    utf16be[index * 2 + 1] = value & 0xff;
  }
  const files = [
    utf8,
    new Uint8Array([0xef, 0xbb, 0xbf, ...utf8]),
    new Uint8Array([0xff, 0xfe, ...utf16le]),
    new Uint8Array([0xfe, 0xff, ...utf16be]),
  ];
  for (const bytes of files) {
    assert.equal(decodeCsvFile(bytes.buffer), text);
    assert.equal(
      parseSalesCsv(decodeCsvFile(bytes.buffer), products)[0].sourceRecordKey,
      "Café-日本語-😀",
    );
  }
});

test("invalid or legacy-encoded file bytes get a useful decoding error", () => {
  for (const bytes of [new Uint8Array([0xe9]), new Uint8Array([0xff, 0xfe, 0x61])])
    assert.throws(() => decodeCsvFile(bytes.buffer), /Export as UTF-8 CSV or UTF-16 Unicode text/);
});

test("quoting round-trips separators, literal quotes, empty cells, and newlines", () => {
  const fields = [
    "id",
    "comma,inside",
    "semicolon;inside",
    "tab\tinside",
    'say "hello"',
    "line\nnext",
    "",
  ];
  for (const delimiter of [",", ";", "\t"]) {
    const encoded = fields.map((value) => `"${value.replaceAll('"', '""')}"`).join(delimiter);
    assert.deepEqual(parseCsvRecords(`sep=${delimiter}\n${encoded}`)[0].fields, fields);
  }
});

test("errors following multiline records point to the next record's physical line", () => {
  assert.throws(
    () => parseCsvRecords('left,right\n"multi\nline",ok\nnext,"unclosed'),
    /CSV record 3 \(line 4\)/,
  );
  assert.throws(() => parseCsvRecords("sep=|\nleft|right"), /separator directive/);
});

test("quoted field newline content remains exact across CR, LF, and CRLF files", () => {
  for (const newline of ["\r", "\n", "\r\n"]) {
    const key = `Receipt${newline}Line`;
    const csv = `Date,SKU,Quantity,Source Record Key${newline}2026-09-01,SYNTHETIC-001,2,"${key}"${newline}`;
    assert.equal(parseSalesCsv(csv, products)[0].sourceRecordKey, key);
    assert.equal(parseCsvRecords(csv)[1].line, 2);
  }
});

test("source-key length counts Unicode characters consistently with the API", () => {
  const key = "😀".repeat(200);
  assert.equal(
    parseSalesCsv(`2026-09-01,SYNTHETIC-001,2,${key}`, products)[0].sourceRecordKey,
    key,
  );
  assert.throws(
    () => parseSalesCsv(`2026-09-01,SYNTHETIC-001,2,${key}x`, products),
    /200 characters/,
  );
});

test("exact SKUs and product IDs resolve before ambiguous folded names or SKUs", () => {
  const sameNames = [
    { ...product, id: "synthetic-first", sku: "Tea-A", name: "Practice Tea" },
    { ...product, id: "synthetic-second", sku: "TEA-A", name: "Practice Tea" },
  ];
  for (const candidate of sameNames) {
    assert.equal(
      parseSalesCsv(`2026-09-01,${candidate.sku},2`, sameNames)[0].productId,
      candidate.id,
    );
    assert.equal(
      parseSalesCsv(`2026-09-01,${candidate.id},2`, sameNames)[0].productId,
      candidate.id,
    );
  }
  for (const key of ["tea-a", "PRACTICE TEA", "Practice Tea"]) {
    assert.throws(
      () => parseSalesCsv(`Date,Product,Quantity\n2026-09-01,${key},2`, sameNames),
      /CSV record 2 \(line 2\): Product .* matches multiple products. Use an unambiguous exact SKU or product ID/,
    );
  }
});

test("unique folded SKUs and names still resolve without choosing from collisions", () => {
  assert.equal(parseSalesCsv("2026-09-01,synthetic-001,2", products)[0].productId, product.id);
  const simple = { ...product, name: "Practice Rice" };
  assert.equal(parseSalesCsv("2026-09-01,PRACTICE RICE,2", [simple])[0].productId, product.id);
  const skuIdCollision = [
    { ...product, id: "shared-key", sku: "FIRST" },
    { ...product, id: "second", sku: "shared-key" },
  ];
  assert.throws(
    () => parseSalesCsv("2026-09-01,shared-key,2", skuIdCollision),
    /matches multiple products/,
  );
});
