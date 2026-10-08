import type { CsvDelimiter, CsvRecord } from "./import-csv";
import type { InventoryImportRow, Product, Sale } from "./types";

export type GuidedCsvKind = "inventory" | "sales";
export type CsvDateFormat = "iso" | "dmy" | "mdy";
export type CsvNumberFormat = "decimal-point" | "comma-grouped" | "decimal-comma";
export type CsvMapping = Record<string, number | null>;
export type CsvImportOptions = {
  header: boolean;
  delimiter: CsvDelimiter | "auto";
  mapping: CsvMapping;
  dateFormat: CsvDateFormat;
  numberFormat: CsvNumberFormat;
  dateConfirmed?: boolean;
  numberConfirmed?: boolean;
  // Exact, trimmed source identifiers are mapped to a current product ID by the user.
  productMatches: Record<string, string>;
  constants?: Record<string, string>;
};
export type CsvField = { key: string; label: string; required: boolean; aliases: string[] };
export const CSV_IMPORT_FIELDS: Record<GuidedCsvKind, CsvField[]> = {
  inventory: [
    {
      key: "sku",
      label: "SKU",
      required: true,
      aliases: ["sku", "itemcode", "productcode", "stockcode", "itemsku", "productsku"],
    },
    {
      key: "name",
      label: "Product name",
      required: true,
      aliases: ["product", "name", "productname", "itemname", "description"],
    },
    {
      key: "category",
      label: "Category",
      required: true,
      aliases: ["category", "productcategory", "group"],
    },
    { key: "unit", label: "Unit", required: true, aliases: ["unit", "uom", "countingunit"] },
    {
      key: "stock",
      label: "On Hand",
      required: true,
      aliases: [
        "onhand",
        "currentstock",
        "stock",
        "stockonhand",
        "quantityonhand",
        "quantityavailable",
        "availablequantity",
      ],
    },
    { key: "lead", label: "Lead Time", required: true, aliases: ["leadtime", "leadtimedays"] },
    {
      key: "safety",
      label: "Safety Stock",
      required: true,
      aliases: ["safetystock", "bufferstock"],
    },
    {
      key: "cost",
      label: "Unit Cost",
      required: true,
      aliases: ["unitcost", "cost", "costperunit"],
    },
  ],
  sales: [
    {
      key: "date",
      label: "Date",
      required: true,
      aliases: ["date", "saledate", "salesdate", "transactiondate", "bookedon", "posteddate"],
    },
    {
      key: "product",
      label: "Product / SKU",
      required: true,
      aliases: [
        "product",
        "sku",
        "itemcode",
        "productcode",
        "productname",
        "itemname",
        "itemsku",
        "productsku",
      ],
    },
    {
      key: "quantity",
      label: "Quantity",
      required: true,
      aliases: [
        "quantity",
        "qty",
        "unitssold",
        "quantitysold",
        "soldqty",
        "soldquantity",
        "salesquantity",
      ],
    },
    {
      key: "key",
      label: "Source Record Key",
      required: false,
      aliases: ["sourcerecordkey", "salelineid", "transactionlineid", "linekey"],
    },
    {
      key: "unit",
      label: "Unit (optional check)",
      required: false,
      aliases: ["unit", "uom", "countingunit"],
    },
  ],
};
export const CSV_DATE_FORMATS: { value: CsvDateFormat; label: string }[] = [
  { value: "iso", label: "YYYY-MM-DD (2026-10-05)" },
  { value: "dmy", label: "Day / month / year (05/10/2026)" },
  { value: "mdy", label: "Month / day / year (10/05/2026)" },
];
export const CSV_NUMBER_FORMATS: { value: CsvNumberFormat; label: string }[] = [
  { value: "decimal-point", label: "Decimal point, no grouping (1234.50)" },
  { value: "comma-grouped", label: "Decimal point, comma grouping (1,234.50)" },
  { value: "decimal-comma", label: "Decimal comma, dot grouping (1.234,50)" },
];
export const CSV_ISSUE_PREVIEW_LIMIT = 50;
export const CSV_COLUMN_LIMIT = 100;
export const CSV_INVENTORY_FIXED_FIELDS = ["category", "unit", "lead", "safety", "cost"];

export type CsvImportIssue = {
  record: number;
  line: number;
  field: string;
  value: string;
  message: string;
};
export type CsvProductResolution = {
  source: string;
  reason: "unknown" | "ambiguous";
  rows: number;
};
export type CsvFormatQuestion = {
  field: "date" | "number";
  sample: string;
  choices: { value: string; label: string }[];
};
export type GuidedCsvValidation = {
  options: CsvImportOptions;
  columns: string[];
  configurationErrors: string[];
  issues: CsvImportIssue[];
  rowCount: number;
  validRowCount: number;
  invalidRowCount: number;
  convertedPreview: CsvRecord[];
  convertedHeaders: string[];
  unresolvedProducts: CsvProductResolution[];
  unresolvedProductCount: number;
  reusedInventoryRows: number;
  data: { kind: "inventory"; rows: InventoryImportRow[] } | { kind: "sales"; rows: Sale[] } | null;
};

const normalizedHeader = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[\s_-]/g, "");
function short(value: string, limit = 200): string {
  if (value.length <= limit) return value;
  let prefix = "",
    count = 0;
  for (const character of value) {
    if (count === limit) return `${prefix}…`;
    prefix += character;
    count++;
  }
  return prefix;
}

/** Suggest explicit header aliases or the documented headerless column order. */
export function suggestCsvOptions(
  records: CsvRecord[],
  kind: GuidedCsvKind,
  headerOverride?: boolean,
): CsvImportOptions {
  const fields = CSV_IMPORT_FIELDS[kind];
  const first = records[0]?.fields ?? [];
  const names = first.map(normalizedHeader);
  const looksLikeData =
    kind === "sales"
      ? /^\d{4}-\d{2}-\d{2}$|^\d{1,2}[/.-]\d{1,2}[/.-]\d{4}$/.test(first[0]?.trim() ?? "")
      : first.length === 8 && /^\d+(?:[.,]\d+)?$/.test(first[4]?.trim() ?? "");
  const header = headerOverride ?? !looksLikeData;
  const mapping: CsvMapping = {};
  fields.forEach((field, position) => {
    const candidates = names.flatMap((name, index) =>
      field.aliases.includes(name) ? [index] : [],
    );
    // Ambiguous aliases stay unselected. Two fields cannot quietly share one source column.
    mapping[field.key] = header
      ? candidates.length === 1
        ? candidates[0]
        : null
      : position < first.length && !(kind === "sales" && field.key === "unit")
        ? position
        : null;
  });
  return {
    header,
    delimiter: "auto",
    mapping,
    dateFormat: "iso",
    numberFormat: "decimal-point",
    productMatches: {},
  };
}

function convertedDate(raw: string, format: CsvDateFormat): string {
  const value = raw.trim();
  let iso = value;
  if (format !== "iso") {
    const match = /^(\d{1,2})([/.-])(\d{1,2})\2(\d{4})$/.exec(value);
    if (!match)
      throw new Error(
        "Use the selected date format with a four-digit year; timestamps are not sale dates.",
      );
    const day = format === "dmy" ? match[1] : match[3];
    const month = format === "dmy" ? match[3] : match[1];
    iso = `${match[4]}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }
  const parsed = new Date(`${iso}T00:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(iso) ||
    iso.startsWith("0000") ||
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== iso
  )
    throw new Error("Date is not a valid calendar date in the selected format.");
  return iso;
}

/** Reject malformed grouping, currency, exponents, excess precision and lossy JS transport. */
function convertedNumber(
  raw: string,
  format: CsvNumberFormat,
  decimals: number,
  positive = false,
): number {
  const value = raw.trim();
  const pattern =
    format === "decimal-comma"
      ? /^(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d+)?$/
      : format === "comma-grouped"
        ? /^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/
        : /^\d+(?:\.\d+)?$/;
  if (!pattern.test(value))
    throw new Error(
      "Use a nonnegative number in the selected number format; no currency signs or mixed separators.",
    );
  const canonical =
    format === "decimal-comma"
      ? value.replaceAll(".", "").replace(",", ".")
      : format === "comma-grouped"
        ? value.replaceAll(",", "")
        : value;
  const [whole, fraction = ""] = canonical.split(".");
  const significantFraction = fraction.replace(/0+$/, "");
  if (significantFraction.length > decimals)
    throw new Error(
      `Allows at most ${decimals} decimal places; values are never rounded during import.`,
    );
  const padded = significantFraction.padEnd(decimals, "0");
  const normalizedWhole = whole.replace(/^0+(?=\d)/, "");
  const scaled = BigInt(normalizedWhole + padded);
  const number = Number(canonical);
  if (
    scaled > BigInt(Number.MAX_SAFE_INTEGER) ||
    !Number.isFinite(number) ||
    number.toFixed(decimals) !== `${normalizedWhole}${decimals ? `.${padded}` : ""}`
  )
    throw new Error(
      "Number is too large to transfer exactly. Correct the value; it has not been rounded.",
    );
  if (positive && number <= 0) throw new Error("Sold quantity must be greater than zero.");
  if (decimals === 0 && number > 2_147_483_647)
    throw new Error("Lead Time exceeds the supported whole-number range.");
  return number;
}

type Lookup = Map<string, Product | null>;
function add(lookup: Lookup, key: string, product: Product) {
  if (!lookup.has(key)) lookup.set(key, product);
  else lookup.set(key, null);
}

/** Infer only interpretations supported by the whole file, and ask when values differ. */
export function analyzeCsvOptions(
  records: CsvRecord[],
  kind: GuidedCsvKind,
  products: Product[],
  supplied?: CsvImportOptions,
): { options: CsvImportOptions; questions: CsvFormatQuestion[] } {
  const options = supplied
    ? { ...supplied, mapping: { ...supplied.mapping } }
    : suggestCsvOptions(records, kind);
  const rows = records.slice(options.header ? 1 : 0);
  const questions: CsvFormatQuestion[] = [];
  if (!supplied && kind === "sales" && rows.length) {
    const exact: Lookup = new Map(),
      sku: Lookup = new Map(),
      names: Lookup = new Map();
    for (const product of products) {
      if (product.isActive === false) continue;
      add(exact, product.id, product);
      if (product.sku !== product.id) add(exact, product.sku, product);
      add(sku, product.sku.toLowerCase(), product);
      add(names, product.name.toLowerCase(), product);
    }
    const resolve = (raw: string) => {
      const value = raw.trim();
      const direct = exact.get(value);
      if (direct !== undefined) return direct;
      const code = sku.get(value.toLowerCase());
      return code !== undefined ? code : names.get(value.toLowerCase());
    };
    if (options.mapping.product === null && options.header) {
      const candidates = (records[0]?.fields ?? []).flatMap((_value, column) =>
        rows.slice(0, 200).every((record) => resolve(record.fields[column] ?? "")) ? [column] : [],
      );
      // Prefer a clearly named SKU over a redundant name only if every row agrees.
      const codeColumns = candidates.filter((column) =>
        ["sku", "itemcode", "productcode", "itemsku", "productsku"].includes(
          normalizedHeader(records[0].fields[column]),
        ),
      );
      if (candidates.length === 1) options.mapping.product = candidates[0];
      else if (
        codeColumns.length === 1 &&
        candidates.every((column) =>
          rows.every(
            (record) =>
              resolve(record.fields[column] ?? "")?.id ===
              resolve(record.fields[codeColumns[0]] ?? "")?.id,
          ),
        )
      )
        options.mapping.product = codeColumns[0];
    }
    if (options.mapping.date === null && options.header) {
      const candidates = (records[0]?.fields ?? []).flatMap((_value, column) =>
        rows
          .slice(0, 200)
          .every((record) =>
            /^\d{4}-\d{2}-\d{2}$|^\d{1,2}[/.-]\d{1,2}[/.-]\d{4}$/.test(
              (record.fields[column] ?? "").trim(),
            ),
          )
          ? [column]
          : [],
      );
      if (candidates.length === 1) options.mapping.date = candidates[0];
    }
  }
  // Cache repeated observations, but bound extra memory for large files.
  const infer = <T extends string>(
    formats: T[],
    observations: Iterable<{ raw: string; decimals: number }>,
    convert: (raw: string, format: T, decimals: number) => string | number,
  ) => {
    let candidates = [...formats];
    const disagreements: { raw: string; values: Map<T, string | number> }[] = [];
    const cache = new Map<string, Map<T, string | number>>();
    for (const { raw, decimals } of observations) {
      const key = `${decimals}:${raw}`;
      let values = cache.get(key);
      if (!values) {
        values = new Map();
        for (const format of formats) {
          try {
            values.set(format, convert(raw, format, decimals));
          } catch {
            /* Invalid rows remain row errors. */
          }
        }
        if (cache.size < 1_000) cache.set(key, values);
      }
      if (!values.size) continue;
      candidates = candidates.filter((format) => values!.has(format));
      // Three pairs at most; retain a sample for each differing pair without retaining rows.
      for (let a = 0; a < formats.length; a++)
        for (let b = a + 1; b < formats.length; b++) {
          if (
            values.has(formats[a]) &&
            values.has(formats[b]) &&
            values.get(formats[a]) !== values.get(formats[b]) &&
            !disagreements.some(
              (item) =>
                item.values.has(formats[a]) &&
                item.values.has(formats[b]) &&
                item.values.get(formats[a]) !== item.values.get(formats[b]),
            )
          )
            disagreements.push({ raw, values });
        }
    }
    const ambiguous = disagreements.find(
      (item) =>
        new Set(candidates.map((format) => item.values.get(format))).size > 1 &&
        candidates.every((format) => item.values.has(format)),
    );
    return { candidates, ambiguous };
  };
  if (kind === "sales" && !options.dateConfirmed && options.mapping.date != null) {
    const result = infer(
      CSV_DATE_FORMATS.map((item) => item.value),
      rows.map((row) => ({ raw: (row.fields[options.mapping.date!] ?? "").trim(), decimals: 0 })),
      convertedDate,
    );
    if (result.ambiguous)
      questions.push({
        field: "date",
        sample: short(result.ambiguous.raw),
        choices: result.candidates.map((format) => ({
          value: format,
          label: `${new Date(`${result.ambiguous!.values.get(format)}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })} (${format === "dmy" ? "day first" : "month first"})`,
        })),
      });
    else if (result.candidates.length)
      options.dateFormat = result.candidates.includes(options.dateFormat)
        ? options.dateFormat
        : result.candidates[0];
  }
  if (!options.numberConfirmed) {
    const numericFields =
      kind === "sales"
        ? [["quantity", 3] as const]
        : ([
            ["stock", 3],
            ["lead", 0],
            ["safety", 3],
            ["cost", 4],
          ] as const);
    function* observations() {
      for (const row of rows)
        for (const [field, decimals] of numericFields) {
          const column = options.mapping[field];
          if (column != null) yield { raw: (row.fields[column] ?? "").trim(), decimals };
        }
      for (const [field, decimals] of numericFields)
        if (options.mapping[field] == null && Object.hasOwn(options.constants ?? {}, field))
          yield { raw: options.constants![field].trim(), decimals };
    }
    const result = infer(
      CSV_NUMBER_FORMATS.map((item) => item.value),
      observations(),
      convertedNumber,
    );
    if (result.ambiguous)
      questions.push({
        field: "number",
        sample: short(result.ambiguous.raw),
        choices: result.candidates
          .filter(
            (format, index, formats) =>
              formats.findIndex(
                (candidate) =>
                  result.ambiguous!.values.get(candidate) === result.ambiguous!.values.get(format),
              ) === index,
          )
          .map((format) => ({
            value: format,
            label: `${Number(result.ambiguous!.values.get(format)).toLocaleString("en-US", { maximumFractionDigits: 4 })} (${Number.isInteger(result.ambiguous!.values.get(format)) ? "whole number" : "decimal number"})`,
          })),
      });
    else if (result.candidates.length)
      options.numberFormat = result.candidates.includes(options.numberFormat)
        ? options.numberFormat
        : result.candidates[0];
  }
  return { options, questions };
}

export function validateGuidedCsv(
  records: CsvRecord[],
  kind: GuidedCsvKind,
  products: Product[],
  supplied?: CsvImportOptions,
  questions: CsvFormatQuestion[] = [],
): GuidedCsvValidation {
  const options = supplied ?? suggestCsvOptions(records, kind);
  const fields = CSV_IMPORT_FIELDS[kind];
  const first = records[0]?.fields ?? [];
  const columnCount = first.length;
  const rows = records.slice(options.header ? 1 : 0);
  const result: GuidedCsvValidation = {
    options,
    columns: first
      .slice(0, CSV_COLUMN_LIMIT)
      .map((name, index) =>
        options.header
          ? `${index + 1}: ${short(name || "(blank header)", 80)}`
          : `${index + 1}: Column ${index + 1}`,
      ),
    configurationErrors: [],
    issues: [],
    rowCount: rows.length,
    validRowCount: 0,
    invalidRowCount: 0,
    convertedPreview: [],
    convertedHeaders:
      kind === "inventory"
        ? [
            "SKU",
            "Product",
            "Category",
            "Unit",
            "On Hand",
            "Lead Time",
            "Safety Stock",
            "Unit Cost",
          ]
        : ["Date", "SKU", "Product", "Quantity", "Unit", "Source Record Key"],
    unresolvedProducts: [],
    unresolvedProductCount: 0,
    reusedInventoryRows: 0,
    data: null,
  };
  if (columnCount > CSV_COLUMN_LIMIT)
    result.configurationErrors.push(
      `This import supports at most ${CSV_COLUMN_LIMIT} source columns. Export only the relevant columns first.`,
    );
  const occupied = new Map<number, string>();
  for (const field of fields) {
    const column = options.mapping[field.key];
    if (column === null || column === undefined) {
      if (
        kind === "inventory" &&
        CSV_INVENTORY_FIXED_FIELDS.includes(field.key) &&
        Object.hasOwn(options.constants ?? {}, field.key)
      ) {
        if (!options.constants?.[field.key]?.trim())
          result.configurationErrors.push(
            `Enter a verified value for ${field.label} that applies to every row.`,
          );
      } else if (field.required && (kind !== "inventory" || ["sku", "stock"].includes(field.key)))
        result.configurationErrors.push(`Select a source column for ${field.label}.`);
    } else if (!Number.isInteger(column) || column < 0 || column >= columnCount)
      result.configurationErrors.push(`Select a valid source column for ${field.label}.`);
    else if (occupied.has(column))
      result.configurationErrors.push(
        `${field.label} and ${occupied.get(column)} use the same source column. Choose separate columns.`,
      );
    else occupied.set(column, field.label);
  }
  if (!rows.length) result.configurationErrors.push("CSV contains no data records to import.");
  if (questions.length)
    result.configurationErrors.push(
      "Answer the date or number question below, then check the preview.",
    );
  if (result.configurationErrors.length) return result;

  const exact: Lookup = new Map(),
    sku: Lookup = new Map(),
    names: Lookup = new Map();
  const byId = new Map<string, Product>();
  for (const product of products) {
    byId.set(product.id, product);
    if (kind === "sales" && product.isActive === false) continue;
    add(exact, product.id, product);
    if (product.sku !== product.id) add(exact, product.sku, product);
    add(sku, product.sku.toLowerCase(), product);
    add(names, product.name.toLowerCase(), product);
  }
  const unknown = new Map<string, CsvProductResolution>();
  const inventory: InventoryImportRow[] = [],
    sales: Sale[] = [];
  const inventorySkus = new Map<string, number>();
  const sourceKeys = new Map<
    string,
    { record: number; productId?: string; date?: string; qty?: number }
  >();
  const metadataFields = {
    name: "name",
    category: "category",
    unit: "unit",
    lead: "leadTimeDays",
    safety: "safetyStock",
    cost: "unitCost",
  } as const;
  for (const record of rows) {
    const before = result.issues.length;
    const issue = (field: string, raw: string, message: string) =>
      result.issues.push({
        record: record.record,
        line: record.line,
        field,
        value: short(raw),
        message,
      });
    const savedProduct =
      kind === "inventory"
        ? sku.get((record.fields[options.mapping.sku ?? -1] ?? "").trim().toLowerCase())
        : undefined;
    const suppliedField = (key: string) =>
      (options.mapping[key] !== null && options.mapping[key] !== undefined) ||
      Object.hasOwn(options.constants ?? {}, key);
    const value = (key: string) => {
      const index = options.mapping[key];
      if (index !== null && index !== undefined) return (record.fields[index] ?? "").trim();
      if (kind !== "inventory") return "";
      if (Object.hasOwn(options.constants ?? {}, key))
        return (options.constants?.[key] ?? "").trim();
      const property = metadataFields[key as keyof typeof metadataFields];
      return savedProduct && property ? String(savedProduct[property]) : "";
    };
    const check = <T>(field: string, operation: () => T): T | undefined => {
      try {
        return operation();
      } catch (error) {
        issue(field, value(field), error instanceof Error ? error.message : "Invalid value.");
      }
    };
    if (record.fields.length !== columnCount)
      issue(
        "row",
        "",
        `Expected ${columnCount} source columns, found ${record.fields.length}. Correct separators or missing fields.`,
      );
    const text = (key: string, max: number) =>
      check(key, () => {
        const raw = value(key);
        if (!raw) throw new Error("Required value is missing; no default has been invented.");
        if (Array.from(raw).length > max) throw new Error(`Allows at most ${max} characters.`);
        return raw;
      });
    if (kind === "inventory") {
      const code = text("sku", 100),
        name = text("name", 200),
        category = text("category", 100),
        unit = text("unit", 50);
      const currentStock = check("stock", () =>
        convertedNumber(value("stock"), options.numberFormat, 3),
      );
      const detailNumber = (key: "lead" | "safety" | "cost", decimals: number) =>
        check(key, () => {
          if (!value(key))
            throw new Error(
              "New SKU needs this product detail. Add it in Products first or adjust the import.",
            );
          // Saved values are already canonical numbers, independent of the source's locale.
          return convertedNumber(
            value(key),
            suppliedField(key) ? options.numberFormat : "decimal-point",
            decimals,
          );
        });
      const leadTimeDays = detailNumber("lead", 0);
      const safetyStock = detailNumber("safety", 3);
      const unitCost = detailNumber("cost", 4);
      if (code) {
        const folded = code.toLowerCase(),
          previous = inventorySkus.get(folded);
        if (previous !== undefined)
          issue(
            "sku",
            code,
            `Duplicate SKU in this file; first appears in CSV record ${previous}. Keep one verified stock count per SKU.`,
          );
        else inventorySkus.set(folded, record.record);
        const existing = sku.get(folded);
        if (existing === null)
          issue(
            "sku",
            code,
            "SKU matches multiple catalog products. Correct the catalog before importing.",
          );
        else if (existing && unit && unit.toLowerCase() !== existing.unit.trim().toLowerCase())
          issue(
            "unit",
            unit,
            `Existing SKU is counted in ${short(existing.unit, 50)}. Verify the counting unit and correct the file; quantities are not converted.`,
          );
      }
      if (result.convertedPreview.length < 50)
        result.convertedPreview.push({
          ...record,
          fields: [
            code ?? value("sku"),
            name ?? value("name"),
            category ?? value("category"),
            unit ?? value("unit"),
            currentStock?.toString() ?? "",
            leadTimeDays?.toString() ?? "",
            safetyStock?.toString() ?? "",
            unitCost?.toString() ?? "",
          ].map((item) => short(item)),
        });
      if (result.issues.length === before) {
        const details = {
          name: name!,
          category: category!,
          unit: unit!,
          leadTimeDays: leadTimeDays!,
          safetyStock: safetyStock!,
          unitCost: unitCost!,
        };
        const row: InventoryImportRow = { sku: code!, currentStock: currentStock! };
        for (const [field, property] of Object.entries(metadataFields)) {
          if (suppliedField(field))
            Object.assign(row, { [property]: details[property as keyof typeof details] });
        }
        if (savedProduct && Object.keys(metadataFields).some((field) => !suppliedField(field)))
          result.reusedInventoryRows++;
        // Omitted details remain omitted in the request: the API preserves its current saved values.
        inventory.push(row);
      }
    } else {
      const date = check("date", () => convertedDate(value("date"), options.dateFormat));
      const qty = check("quantity", () =>
        convertedNumber(value("quantity"), options.numberFormat, 3, true),
      );
      const key = value("product");
      let match: Product | null | undefined;
      if (Object.hasOwn(options.productMatches, key)) {
        match = byId.get(options.productMatches[key]);
        if (!match || match.isActive === false) {
          issue("product", key, "Selected product is no longer active. Select a current product.");
          match = undefined;
        }
      } else {
        match = exact.get(key);
        if (match === undefined) match = sku.get(key.toLowerCase());
        if (match === undefined) match = names.get(key.toLowerCase());
        if (!match) {
          issue(
            "product",
            key,
            key
              ? match === null
                ? "Ambiguous product. Select the correct existing product below."
                : "Unknown product. Select an existing product or add the product in Products first."
              : "Product identifier is required.",
          );
          // Oversized malformed identifiers must be corrected in the source, never cloned into React.
          if (key && key.length <= 200) {
            const entry = unknown.get(key);
            if (entry) entry.rows++;
            else
              unknown.set(key, {
                source: key,
                reason: match === null ? "ambiguous" : "unknown",
                rows: 1,
              });
          }
        }
      }
      const sourceRecordKey = value("key");
      if (Array.from(sourceRecordKey).length > 200)
        issue("key", sourceRecordKey, "Source Record Key allows at most 200 characters.");
      const unit = value("unit");
      if (
        options.mapping.unit !== null &&
        options.mapping.unit !== undefined &&
        (!unit || (match && unit.toLowerCase() !== match.unit.trim().toLowerCase()))
      )
        issue(
          "unit",
          unit,
          `Use the matched product's counting unit${match ? ` (${short(match.unit, 50)})` : ""}. No pack/piece conversion is performed.`,
        );
      if (sourceRecordKey) {
        const previous = sourceKeys.get(sourceRecordKey);
        if (previous) {
          const comparable =
            previous.productId &&
            previous.date &&
            previous.qty !== undefined &&
            match &&
            date &&
            qty !== undefined;
          issue(
            "key",
            sourceRecordKey,
            `${!comparable || (previous.productId === match!.id && previous.date === date && previous.qty === qty) ? "Repeated" : "Conflicting"} Source Record Key; first appears in CSV record ${previous.record}. Correct the source file before importing.`,
          );
        } else
          sourceKeys.set(sourceRecordKey, {
            record: record.record,
            productId: match?.id,
            date,
            qty,
          });
      }
      if (result.convertedPreview.length < 50)
        result.convertedPreview.push({
          ...record,
          fields: [
            date ?? "",
            match?.sku ?? key,
            match?.name ?? "Unresolved",
            qty?.toString() ?? "",
            match?.unit ?? "",
            sourceRecordKey,
          ].map((item) => short(item)),
        });
      if (result.issues.length === before)
        sales.push({
          id: `prepared-${record.record}`,
          productId: match!.id,
          date: date!,
          qty: qty!,
          ...(sourceRecordKey ? { sourceRecordKey } : {}),
        });
    }
    if (result.issues.length > before) result.invalidRowCount++;
    else result.validRowCount++;
  }
  result.unresolvedProductCount = unknown.size;
  result.unresolvedProducts = Array.from(unknown.values()).slice(0, 50);
  if (!result.issues.length)
    result.data = kind === "inventory" ? { kind, rows: inventory } : { kind, rows: sales };
  return result;
}

/** Safe spreadsheet-readable diagnostics, generated in the worker only on download. */
export function csvIssueReport(issues: CsvImportIssue[]): string {
  const cell = (raw: string) => {
    let start = 0;
    while (start < raw.length && (raw.charCodeAt(start) <= 32 || /\s/.test(raw[start]))) start++;
    const safe = ["=", "+", "@", "-"].includes(raw[start]) ? `'${raw}` : raw;
    return `"${safe.replaceAll('"', '""')}"`;
  };
  return (
    "\uFEFF" +
    [
      ["CSV record", "Starting line", "Field", "Original value (max 200 characters)", "Problem"],
      ...issues.map((issue) => [
        String(issue.record),
        String(issue.line),
        issue.field,
        issue.value,
        issue.message,
      ]),
    ]
      .map((row) => row.map(cell).join(","))
      .join("\r\n")
  );
}
