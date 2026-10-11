import type { Product, Sale } from "./types";

/** Read standard spreadsheet Unicode exports without guessing legacy encodings. */
export function csvFileEncoding(buffer: ArrayBuffer): "utf-8" | "utf-16le" | "utf-16be" {
  const bytes = new Uint8Array(buffer);
  if (
    (bytes[0] === 0xff && bytes[1] === 0xfe && bytes[2] === 0 && bytes[3] === 0) ||
    (bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 0xfe && bytes[3] === 0xff)
  )
    throw new Error("UTF-32 CSV is not supported. Export as UTF-8 CSV or BOM-marked UTF-16 text.");
  return bytes[0] === 0xff && bytes[1] === 0xfe
    ? "utf-16le"
    : bytes[0] === 0xfe && bytes[1] === 0xff
      ? "utf-16be"
      : "utf-8";
}

export function decodeCsvFile(buffer: ArrayBuffer): string {
  const encoding = csvFileEncoding(buffer);
  try {
    const text = new TextDecoder(encoding, { fatal: true }).decode(buffer);
    if (text.includes("\0")) throw new Error("Unsupported binary or unmarked UTF-16 file.");
    return text;
  } catch {
    throw new Error(
      "Could not read CSV text. Export as UTF-8 CSV or UTF-16 Unicode text with a BOM.",
    );
  }
}

export type CsvDelimiter = "," | ";" | "\t";
type Delimiter = CsvDelimiter;
export type CsvRecord = { fields: string[]; record: number; line: number };

/** Bound diagnostic text only; the parsed field and retained source stay complete. */
function diagnosticValue(value: string): string {
  if (value.length <= 200) return value;
  let prefix = "";
  let characters = 0;
  for (const character of value) {
    if (characters === 200) return `${prefix}\u2026`;
    prefix += character;
    characters++;
  }
  return value;
}

function recordError(record: CsvRecord, message: string): Error {
  return new Error(`CSV record ${record.record} (line ${record.line}): ${message}`);
}

function detectDelimiter(source: string): Delimiter {
  const candidates: Delimiter[] = [",", ";", "\t"];
  const counts = [0, 0, 0];
  const samples: number[][] = [];
  const headerScores = [0, 0, 0];
  let quoted = false;
  let value = false;
  let recordCount = 0;
  let recordStart = 0;
  let fallbackCounts: number[] | null = null;
  const sample = (end: number) => {
    // Report titles and delimiter-only padding do not establish a table's separator.
    if (!value || !counts.some((count) => count > 0)) return;
    fallbackCounts ??= [...counts];
    const firstText = source.slice(recordStart, Math.min(end, recordStart + 500));
    const reportTitle =
      /\b(?:report|statement|summary|export)\b/i.test(firstText) &&
      !/\b(?:sku|quantity|qty|on\s*hand|stock\s*count|product|item\s*code)\b/i.test(firstText);
    if (!reportTitle) {
      if (!samples.length) {
        const heading = source.slice(recordStart, Math.min(end, recordStart + 8_000));
        for (const [column, delimiter] of candidates.entries()) {
          try {
            // Reuse the parser's existing header vocabulary to break equal-width
            // ties, such as semicolon reports whose notes contain many commas.
            const fields = parseCsvRecords(heading, delimiter)[0]?.fields ?? [];
            const roles = (aliases: Record<string, string>) =>
              new Set(
                fields.flatMap((field) => {
                  const name = normalizeHeader(field);
                  return Object.hasOwn(aliases, name) ? [aliases[name]] : [];
                }),
              );
            const sales = roles(salesAliases);
            const inventory = roles(inventoryAliases);
            if (["date", "product", "quantity"].every((field) => sales.has(field)))
              headerScores[column] = sales.size;
            if (["sku", "stock"].every((field) => inventory.has(field)))
              headerScores[column] = Math.max(headerScores[column], inventory.size);
          } catch {
            // A candidate separator can make otherwise valid quoting look malformed.
          }
        }
      }
      samples.push([...counts]);
    }
  };
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (char === '"') {
      if (quoted && source[index + 1] === '"') {
        value = true;
        index++;
      } else quoted = !quoted;
    } else if (!quoted && (char === "\r" || char === "\n")) {
      sample(index);
      if (value) recordCount++;
      counts.fill(0);
      value = false;
      if (char === "\r" && source[index + 1] === "\n") index++;
      recordStart = index + 1;
      if (recordCount >= 50) break;
    } else if (!quoted && candidates.includes(char as Delimiter)) {
      counts[candidates.indexOf(char as Delimiter)]++;
    } else if (char.trim()) value = true;
  }
  if (recordCount < 50) sample(source.length);
  if (!samples.length) {
    const fallback = fallbackCounts ?? counts;
    return candidates[fallback.indexOf(Math.max(...fallback))];
  }
  // A real separator repeats a table's width across rows. A comma-rich note or
  // heading must not outweigh consistent semicolon/tab records by raw frequency.
  const scores = candidates.map((_candidate, column) => {
    const frequencies = new Map<number, number>();
    let populated = 0;
    for (const row of samples) {
      if (!row[column]) continue;
      populated++;
      frequencies.set(row[column], (frequencies.get(row[column]) ?? 0) + 1);
    }
    let agreement = 0;
    let width = 0;
    for (const [count, frequency] of frequencies)
      if (frequency > agreement || (frequency === agreement && count > width)) {
        agreement = frequency;
        width = count;
      }
    return { column, header: headerScores[column], agreement, populated, width };
  });
  scores.sort(
    (left, right) =>
      right.header - left.header ||
      right.agreement - left.agreement ||
      right.populated - left.populated ||
      right.width - left.width ||
      left.column - right.column,
  );
  return candidates[scores[0].column];
}

/** Parse complete logical CSV records, retaining their starting physical line for errors. */
export function parseCsvRecords(text: string, selectedDelimiter?: CsvDelimiter): CsvRecord[] {
  let source = text.replace(/^\uFEFF/, "");
  let line = 1;
  let delimiter: Delimiter;
  const directive = /^[ \t\r\n]*sep=([^\r\n]*)(?:\r\n|\r|\n|$)/i.exec(source);
  if (directive) {
    const separator = directive[1].replace(/ +$/g, "");
    if (![",", ";", "\t"].includes(separator))
      throw new Error("CSV separator directive must specify a comma, semicolon, or tab.");
    delimiter = selectedDelimiter ?? (separator as Delimiter);
    line += directive[0].match(/\r\n|\r|\n/g)?.length ?? 0;
    source = source.slice(directive[0].length);
  } else delimiter = selectedDelimiter ?? detectDelimiter(source);

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

function headerColumnNames(
  record: CsvRecord | undefined,
  aliases: Record<string, string>,
  required: string[],
): (string | undefined)[] | null {
  if (!record) return null;
  const names = record.fields.map((value) => {
    const normalized = normalizeHeader(value);
    return Object.hasOwn(aliases, normalized) ? aliases[normalized] : undefined;
  });
  if (names[0] !== required[0] && !required.every((name) => names.includes(name))) return null;
  return names;
}

function headerColumns(
  record: CsvRecord | undefined,
  aliases: Record<string, string>,
  required: string[],
): Record<string, number> | null {
  const names = headerColumnNames(record, aliases, required);
  if (!names || !record) return null;
  const columns: Record<string, number> = {};
  names.forEach((name, index) => {
    if (!name)
      throw recordError(record, `Unsupported column "${diagnosticValue(record.fields[index])}".`);
    if (name in columns)
      throw recordError(record, `Duplicate column "${diagnosticValue(record.fields[index])}".`);
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
  return parseInventoryRecords(parseCsvRecords(text));
}

/** Validate already parsed records; worker preparation never parses the source twice. */
export function parseInventoryRecords(records: CsvRecord[]): Omit<Product, "id">[] {
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
  return parseSalesRecords(parseCsvRecords(text), products);
}

/** Count data records using the same header rules as validation. */
export function csvDataRecordCount(records: CsvRecord[], kind: "inventory" | "sales"): number {
  const header =
    kind === "inventory"
      ? headerColumnNames(records[0], inventoryAliases, inventoryOrder)
      : headerColumnNames(records[0], salesAliases, ["date", "product", "quantity"]);
  return Math.max(0, records.length - (header ? 1 : 0));
}

type ProductLookup = Map<string, Product | null>;

function addMatch(lookup: ProductLookup, key: string, product: Product): void {
  if (!lookup.has(key)) lookup.set(key, product);
  else lookup.set(key, null);
}

/** Validate against indexed lookups, preserving each matching tier's ambiguity rules. */
export function parseSalesRecords(records: CsvRecord[], products: Product[]): Sale[] {
  const header = headerColumns(records[0], salesAliases, ["date", "product", "quantity"]);
  const columns = header ?? { date: 0, product: 1, quantity: 2, key: 3 };
  const exact: ProductLookup = new Map();
  const foldedSku: ProductLookup = new Map();
  const foldedName: ProductLookup = new Map();
  for (const product of products) {
    addMatch(exact, product.id, product);
    // ID and SKU can be identical for one product. That is one match, as with filter().
    if (product.sku !== product.id) addMatch(exact, product.sku, product);
    addMatch(foldedSku, product.sku.toLowerCase(), product);
    addMatch(foldedName, product.name.toLowerCase(), product);
  }
  const importedAt = Date.now();
  const columnCount = header ? Object.keys(header).length : null;
  return records.slice(header ? 1 : 0).map((record, index) => {
    if (header ? record.fields.length !== columnCount : ![3, 4].includes(record.fields.length))
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
    const uniqueMatch = (lookup: ProductLookup, key: string) => {
      const match = lookup.get(key);
      if (match === null)
        throw recordError(
          record,
          `Product "${diagnosticValue(productKey)}" matches multiple products. Use an unambiguous exact SKU or product ID.`,
        );
      return match;
    };
    const foldedKey = productKey.toLowerCase();
    const match =
      uniqueMatch(exact, productKey) ??
      uniqueMatch(foldedSku, foldedKey) ??
      uniqueMatch(foldedName, foldedKey);
    if (!match) throw recordError(record, `Unknown product: ${diagnosticValue(productKey)}`);
    const sourceRecordKey =
      columns.key === undefined ? "" : (record.fields[columns.key] ?? "").trim();
    if (Array.from(sourceRecordKey).length > 200)
      throw recordError(record, "Source Record Key must be at most 200 characters.");
    return {
      id: `imp-${match.id}-${date}-${index}-${importedAt}`,
      productId: match.id,
      date,
      qty,
      ...(sourceRecordKey ? { sourceRecordKey } : {}),
    };
  });
}
