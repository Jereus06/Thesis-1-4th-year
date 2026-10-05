import type { Product, Sale } from "./types";

/** Read standard spreadsheet Unicode exports without guessing legacy encodings. */
export function decodeCsvFile(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const encoding =
    bytes[0] === 0xff && bytes[1] === 0xfe
      ? "utf-16le"
      : bytes[0] === 0xfe && bytes[1] === 0xff
        ? "utf-16be"
        : "utf-8";
  try {
    return new TextDecoder(encoding, { fatal: true }).decode(bytes);
  } catch {
    throw new Error(
      "Could not read CSV text. Export as UTF-8 CSV or UTF-16 Unicode text with a BOM.",
    );
  }
}

type Delimiter = "," | ";" | "\t";
export type CsvRecord = { fields: string[]; record: number; line: number };

function recordError(record: CsvRecord, message: string): Error {
  return new Error(`CSV record ${record.record} (line ${record.line}): ${message}`);
}

function detectDelimiter(source: string): Delimiter {
  const candidates: Delimiter[] = [",", ";", "\t"];
  const counts = [0, 0, 0];
  let quoted = false;
  let content = false;
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (char === '"') {
      content = true;
      if (quoted && source[index + 1] === '"') index++;
      else quoted = !quoted;
    } else if (!quoted && (char === "\r" || char === "\n")) {
      if (content) break;
    } else if (!quoted && candidates.includes(char as Delimiter)) {
      counts[candidates.indexOf(char as Delimiter)]++;
      content = true;
    } else if (char.trim()) content = true;
  }
  return candidates[counts.indexOf(Math.max(...counts))];
}

/** Parse complete logical CSV records, retaining their starting physical line for errors. */
export function parseCsvRecords(text: string): CsvRecord[] {
  let source = text.replace(/^\uFEFF/, "");
  let line = 1;
  let delimiter: Delimiter;
  const directive = /^(?:[ \t]*(?:\r\n|\r|\n))*[ \t]*sep=([^\r\n]*)(?:\r\n|\r|\n|$)/i.exec(source);
  if (directive) {
    const separator = directive[1].replace(/ +$/g, "");
    if (![",", ";", "\t"].includes(separator))
      throw new Error("CSV separator directive must specify a comma, semicolon, or tab.");
    delimiter = separator as Delimiter;
    line += directive[0].match(/\r\n|\r|\n/g)?.length ?? 0;
    source = source.slice(directive[0].length);
  } else delimiter = detectDelimiter(source);

  const records: CsvRecord[] = [];
  let recordLine = line;
  let fields: string[] = [];
  let field = "";
  let state: "unquoted" | "quoted" | "closed" = "unquoted";
  let content = false;
  const error = (message: string) =>
    recordError({ fields: [], record: records.length + 1, line: recordLine }, message);
  const finishField = () => {
    fields.push(field);
    field = "";
    state = "unquoted";
  };
  const finishRecord = () => {
    finishField();
    if (content) records.push({ fields, record: records.length + 1, line: recordLine });
    fields = [];
    content = false;
  };

  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (state === "quoted") {
      if (char === '"') {
        if (source[index + 1] === '"') {
          field += '"';
          index++;
        } else state = "closed";
      } else {
        field += char;
        if (char === "\r") {
          if (source[index + 1] === "\n") {
            field += "\n";
            index++;
          }
          line++;
        } else if (char === "\n") line++;
      }
      continue;
    }
    if (char === delimiter) {
      finishField();
      content = true;
    } else if (char === "\r" || char === "\n") {
      finishRecord();
      if (char === "\r" && source[index + 1] === "\n") index++;
      line++;
      recordLine = line;
    } else if (state === "closed") {
      if (char !== " " && char !== "\t")
        throw error("Unexpected text after a closing quote; separate fields with the delimiter.");
    } else if (char === '"') {
      if (field.trim())
        throw error("A quote inside a field must be escaped inside a quoted field.");
      field = "";
      state = "quoted";
      content = true;
    } else {
      field += char;
      if (char.trim()) content = true;
    }
  }
  if (state === "quoted") throw error("Unclosed quoted field.");
  finishRecord();
  return records;
}

function normalizeHeader(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s_-]/g, "");
}

function headerColumns(
  record: CsvRecord | undefined,
  aliases: Record<string, string>,
  required: string[],
): Record<string, number> | null {
  if (!record) return null;
  const names = record.fields.map((value) => {
    const normalized = normalizeHeader(value);
    return Object.hasOwn(aliases, normalized) ? aliases[normalized] : undefined;
  });
  if (names[0] !== required[0] && !required.every((name) => names.includes(name))) return null;
  const columns: Record<string, number> = {};
  names.forEach((name, index) => {
    if (!name) throw recordError(record, `Unsupported column "${record.fields[index]}".`);
    if (name in columns) throw recordError(record, `Duplicate column "${record.fields[index]}".`);
    columns[name] = index;
  });
  if (!required.every((name) => name in columns))
    throw recordError(record, "The header is missing required columns.");
  return columns;
}

const inventoryAliases: Record<string, string> = {
  sku: "sku",
  product: "name",
  name: "name",
  productname: "name",
  category: "category",
  unit: "unit",
  onhand: "stock",
  currentstock: "stock",
  leadtime: "lead",
  leadtimedays: "lead",
  safetystock: "safety",
  unitcost: "cost",
};
const inventoryOrder = ["sku", "name", "category", "unit", "stock", "lead", "safety", "cost"];

export function parseInventoryCsv(text: string): Omit<Product, "id">[] {
  const records = parseCsvRecords(text);
  const header = headerColumns(records[0], inventoryAliases, inventoryOrder);
  const columns = header ?? Object.fromEntries(inventoryOrder.map((name, index) => [name, index]));
  return records.slice(header ? 1 : 0).map((record) => {
    if (record.fields.length !== 8)
      throw recordError(
        record,
        "Expected 8 inventory columns: SKU, Product, Category, Unit, On Hand, Lead Time, Safety Stock, Unit Cost.",
      );
    const value = (name: string) => record.fields[columns[name]].trim();
    const [sku, name, category, unit] = ["sku", "name", "category", "unit"].map(value);
    const numbers = ["stock", "lead", "safety", "cost"].map(value);
    const [currentStock, leadTimeDays, safetyStock, unitCost] = numbers.map(Number);
    if (!sku || !name || !category || !unit)
      throw recordError(record, "SKU, Product, Category, and Unit are required.");
    if (numbers.some((raw) => !raw) || numbers.some((raw) => !Number.isFinite(Number(raw))))
      throw recordError(
        record,
        "Inventory quantities and unit cost must be numbers, not blank values.",
      );
    if (
      [currentStock, leadTimeDays, safetyStock, unitCost].some((value) => value < 0) ||
      !Number.isInteger(leadTimeDays)
    )
      throw recordError(
        record,
        "Inventory quantities must be nonnegative and lead time must be a whole number.",
      );
    return { sku, name, category, unit, currentStock, leadTimeDays, safetyStock, unitCost };
  });
}

const salesAliases: Record<string, string> = {
  date: "date",
  saledate: "date",
  product: "product",
  sku: "product",
  quantity: "quantity",
  qty: "quantity",
  sourcerecordkey: "key",
};

export function parseSalesCsv(text: string, products: Product[]): Sale[] {
  const records = parseCsvRecords(text);
  const header = headerColumns(records[0], salesAliases, ["date", "product", "quantity"]);
  const columns = header ?? { date: 0, product: 1, quantity: 2, key: 3 };
  return records.slice(header ? 1 : 0).map((record, index) => {
    if (
      header
        ? record.fields.length !== Object.keys(header).length
        : ![3, 4].includes(record.fields.length)
    )
      throw recordError(
        record,
        "Expected Date, Product, Quantity, and an optional Source Record Key.",
      );
    const date = record.fields[columns.date].trim();
    const productKey = record.fields[columns.product].trim();
    const qtyRaw = record.fields[columns.quantity].trim();
    const qty = Number(qtyRaw);
    const parsedDate = new Date(`${date}T00:00:00Z`);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      date.startsWith("0000") ||
      !Number.isFinite(parsedDate.getTime()) ||
      parsedDate.toISOString().slice(0, 10) !== date
    )
      throw recordError(record, "Date must be a valid YYYY-MM-DD date.");
    if (!qtyRaw || !Number.isFinite(qty) || qty <= 0)
      throw recordError(record, "Quantity must be a positive number.");
    const uniqueMatch = (predicate: (product: Product) => boolean) => {
      const matches = products.filter(predicate);
      if (matches.length > 1)
        throw recordError(
          record,
          `Product "${productKey}" matches multiple products. Use an unambiguous exact SKU or product ID.`,
        );
      return matches[0];
    };
    const match =
      uniqueMatch((product) => product.id === productKey || product.sku === productKey) ??
      uniqueMatch((product) => product.sku.toLowerCase() === productKey.toLowerCase()) ??
      uniqueMatch((product) => product.name.toLowerCase() === productKey.toLowerCase());
    if (!match) throw recordError(record, `Unknown product: ${productKey}`);
    const sourceRecordKey =
      columns.key === undefined ? "" : (record.fields[columns.key] ?? "").trim();
    if (Array.from(sourceRecordKey).length > 200)
      throw recordError(record, "Source Record Key must be at most 200 characters.");
    return {
      id: `imp-${match.id}-${date}-${index}-${Date.now()}`,
      productId: match.id,
      date,
      qty,
      ...(sourceRecordKey ? { sourceRecordKey } : {}),
    };
  });
}
