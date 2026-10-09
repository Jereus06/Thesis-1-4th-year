import type { CsvRecord } from "./import-csv";
import {
  CSV_IMPORT_FIELDS,
  suggestCsvOptions,
  type CsvImportOptions,
  type GuidedCsvKind,
} from "./guided-csv";
import type { Product } from "./types";

const normalizedHeader = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
const dateShaped = (value: string) =>
  /^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}(?:[ T].*)?$|^\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}(?:[ T].*)?$/.test(
    value,
  );
const numericSummary = (value: string) => /^[+-]?\d+(?:[., ]\d+)*$/.test(value);
const summaryLabel = (value: string) =>
  /^(?:total|grandtotal|subtotal)$/.test(
    value
      .trim()
      .toLowerCase()
      .replace(/[\s_:-]/g, ""),
  );

function completeHeader(record: CsvRecord, kind: GuidedCsvKind): boolean {
  const names = record.fields.map(normalizedHeader);
  const required = kind === "sales" ? ["date", "product", "quantity"] : ["sku", "stock"];
  return required.every((key) =>
    CSV_IMPORT_FIELDS[kind]
      .find((field) => field.key === key)!
      .aliases.some((alias) => names.includes(alias)),
  );
}

/** Keep operational records intact while removing narrowly identifiable export decoration. */
export function extractCsvTable(
  records: CsvRecord[],
  kind: GuidedCsvKind,
  products: Product[],
  options?: CsvImportOptions,
): { records: CsvRecord[]; ignoredRowCount: number } {
  let table = records.filter((record) => record.fields.some((value) => value.trim()));
  // Positional data can itself contain alias words such as SKU, Stock, Date or Quantity.
  // Decide automatic headerlessness before treating matching records as report decoration.
  if (
    !table.length ||
    options?.header === false ||
    (options?.header !== true && !suggestCsvOptions([table[0]], kind).header)
  )
    return { records: table, ignoredRowCount: records.length - table.length };

  const catalogIdentifiers = new Set(
    products.flatMap((product) =>
      [product.id, product.sku, product.name].map((value) => value.trim().toLowerCase()),
    ),
  );
  const isCatalogIdentifier = (value: string) => catalogIdentifiers.has(value.trim().toLowerCase());
  const safeTitle = (record: CsvRecord) => {
    const values = record.fields.map((value) => value.trim()).filter(Boolean);
    return (
      values.length === 1 &&
      !isCatalogIdentifier(values[0]) &&
      !dateShaped(values[0]) &&
      !numericSummary(values[0]) &&
      (/^[,;\t\s]+$/.test(values[0]) ||
        /\b(?:report|statement|summary|export)\b/i.test(values[0]) ||
        /^(?:sales|inventory|stock)$/i.test(values[0]))
    );
  };
  let headerIndex = -1;
  for (let index = 0; index < Math.min(50, table.length); index++) {
    if (completeHeader(table[index], kind)) {
      headerIndex = index;
      break;
    }
    if (!safeTitle(table[index])) break;
  }
  if (headerIndex < 0) return { records: table, ignoredRowCount: records.length - table.length };
  table = table.slice(headerIndex);
  const header = table[0];
  const headerValues = header.fields.map((value) => value.trim().toLowerCase());
  table = table.filter(
    (record, index) =>
      index === 0 ||
      record.fields.length !== headerValues.length ||
      record.fields.some((value, column) => value.trim().toLowerCase() !== headerValues[column]),
  );

  const protectedAliases = new Set([
    ...CSV_IMPORT_FIELDS[kind]
      .filter((field) => ["sku", "product", "name"].includes(field.key))
      .flatMap((field) => field.aliases),
    ...CSV_IMPORT_FIELDS.sales.find((field) => field.key === "key")!.aliases,
  ]);
  const protectedColumns = new Set(
    header.fields.flatMap((value, column) =>
      protectedAliases.has(normalizedHeader(value)) ? [column] : [],
    ),
  );
  for (const field of ["sku", "product", "name", "key"]) {
    const column = options?.mapping[field];
    if (column != null && Number.isInteger(column) && column >= 0) protectedColumns.add(column);
  }
  const isFooter = (record: CsvRecord) => {
    if ([...protectedColumns].some((column) => record.fields[column]?.trim())) return false;
    const values = record.fields.map((value) => value.trim()).filter(Boolean);
    return (
      values.some(summaryLabel) &&
      values.every(
        (value) =>
          !dateShaped(value) &&
          !isCatalogIdentifier(value) &&
          (summaryLabel(value) || numericSummary(value)),
      )
    );
  };
  while (table.length > 1 && isFooter(table[table.length - 1])) table.pop();
  return { records: table, ignoredRowCount: records.length - table.length };
}
