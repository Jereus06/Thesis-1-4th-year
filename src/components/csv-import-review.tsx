import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  CSV_COLUMN_PREVIEW_LIMIT,
  CSV_DATE_FORMATS,
  CSV_IMPORT_FIELDS,
  CSV_INVENTORY_FIXED_FIELDS,
  CSV_NUMBER_FORMATS,
  type CsvImportOptions,
} from "@/lib/guided-csv";
import type { CsvPreparationSummary, CsvImportKind } from "@/lib/csv-preparation";
import type { Product } from "@/lib/types";

type Props = {
  kind: CsvImportKind;
  guide: NonNullable<CsvPreparationSummary["guided"]>;
  options: CsvImportOptions;
  products: Product[];
  locked: boolean;
  cancelled: boolean;
  preparing: boolean;
  downloading: boolean;
  adjustOpen: boolean;
  onAdjust: (open: boolean) => void;
  onOptions: (options: CsvImportOptions) => void;
  onDownload: () => void;
};

/** Bound catalog choices too: many unknown identifiers must not create thousands of options each. */
function ProductMatchControl({
  source,
  productId,
  products,
  disabled,
  onChange,
}: {
  source: string;
  productId: string;
  products: Product[];
  disabled: boolean;
  onChange: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const search = query.trim().toLowerCase();
  const matching = products.filter(
    (item) => !search || `${item.sku} ${item.name}`.toLowerCase().includes(search),
  );
  const choices = matching.slice(0, 50);
  const selected = products.find((item) => item.id === productId);
  if (selected && !choices.some((item) => item.id === selected.id)) choices.unshift(selected);
  return (
    <div className="grid gap-2">
      <label className="grid gap-1 text-sm">
        Find catalog product for {source}
        <Input
          aria-label={`Find catalog product for ${source}`}
          value={query}
          disabled={disabled}
          placeholder="Search SKU or product name"
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <label className="grid gap-1 text-sm">
        Match product for {source}
        <Select
          aria-label={`Match product for ${source}`}
          value={productId}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="">
            {productId ? "Remove this match" : "Choose the matching product"}
          </option>
          {choices.map((item) => (
            <option key={item.id} value={item.id}>
              {item.sku} — {item.name} ({item.unit}){item.isActive === false ? " · Inactive" : ""}
            </option>
          ))}
        </Select>
      </label>
      {matching.length > 50 && (
        <p className="text-xs text-muted">
          Showing 50 of {matching.length.toLocaleString()} matching products. Search to narrow the
          choices.
        </p>
      )}
    </div>
  );
}

/** Bounded setup and review UI; complete source/rows/diagnostics stay in the worker. */
export function CsvImportReview({
  kind,
  guide,
  options,
  products,
  locked,
  cancelled,
  preparing,
  downloading,
  adjustOpen,
  onAdjust,
  onOptions,
  onDownload,
}: Props) {
  const [matchSearch, setMatchSearch] = useState("");
  const [matchPage, setMatchPage] = useState(0);
  const selectedMatches = useMemo(
    () => Object.entries(options.productMatches),
    [options.productMatches],
  );
  const productLabels = useMemo(
    () => new Map(products.map((product) => [product.id, `${product.sku} ${product.name}`])),
    [products],
  );
  const filteredMatches = useMemo(() => {
    const query = matchSearch.trim().toLowerCase();
    return query
      ? selectedMatches.filter(([source, id]) =>
          `${source} ${productLabels.get(id) ?? ""}`.toLowerCase().includes(query),
        )
      : selectedMatches;
  }, [matchSearch, selectedMatches, productLabels]);
  const pageCount = Math.max(1, Math.ceil(filteredMatches.length / 50));
  const currentPage = Math.min(matchPage, pageCount - 1);
  const pageStart = currentPage * 50;
  const visibleMatches = filteredMatches.slice(pageStart, pageStart + 50);

  return (
    <div className="grid gap-4 rounded-xl border border-border p-3" aria-label="CSV import setup">
      <p className="font-medium">Automatic CSV preview</p>
      <p className="text-sm text-muted">
        StockCast reads the columns it needs, matches existing products, and leaves extra columns
        out. The converted records are shown below. Adjust import is optional.
      </p>
      <p className="text-xs text-muted" aria-label="CSV formats used">
        {kind === "sales" &&
          `Dates: ${CSV_DATE_FORMATS.find((format) => format.value === options.dateFormat)?.label}. `}
        Numbers: {CSV_NUMBER_FORMATS.find((format) => format.value === options.numberFormat)?.label}
        .
      </p>
      {guide.reusedInventoryRows > 0 && (
        <p className="text-sm text-muted">
          {options.inventoryDetails === "all"
            ? `${guide.reusedInventoryRows.toLocaleString()} existing products keep saved details for columns missing from this file.`
            : `Saved details are kept for ${guide.reusedInventoryRows.toLocaleString()} existing products; their stock counts are updated.`}
        </p>
      )}
      <details
        className="rounded-lg border border-border p-3"
        open={adjustOpen}
        onToggle={(event) => onAdjust(event.currentTarget.open)}
      >
        <summary className="cursor-pointer text-sm font-medium">Adjust import</summary>
        <div className="mt-3 grid gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={options.header}
              disabled={locked || cancelled}
              onChange={(event) => onOptions({ ...options, header: event.target.checked })}
            />
            First row contains column names
          </label>
          {kind === "inventory" && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={options.inventoryDetails === "all"}
                disabled={locked || cancelled}
                onChange={(event) =>
                  onOptions({
                    ...options,
                    inventoryDetails: event.target.checked ? "all" : "new-only",
                  })
                }
              />
              Update existing product details from CSV
            </label>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-sm">
              Column separator
              <Select
                aria-label="Column separator"
                value={options.delimiter}
                disabled={locked || cancelled}
                onChange={(event) =>
                  onOptions({
                    ...options,
                    delimiter: event.target.value as CsvImportOptions["delimiter"],
                  })
                }
              >
                <option value="auto">Detect comma, semicolon, or tab</option>
                <option value=",">Comma</option>
                <option value=";">Semicolon</option>
                <option value={"\t"}>Tab</option>
              </Select>
            </label>
            <label className="grid gap-1 text-sm">
              Number format
              <Select
                aria-label="Number format"
                value={options.numberFormat}
                disabled={locked || cancelled}
                onChange={(event) =>
                  onOptions({
                    ...options,
                    numberFormat: event.target.value as CsvImportOptions["numberFormat"],
                    numberConfirmed: true,
                  })
                }
              >
                {CSV_NUMBER_FORMATS.map((format) => (
                  <option key={format.value} value={format.value}>
                    {format.label}
                  </option>
                ))}
              </Select>
            </label>
            {kind === "sales" && (
              <label className="grid gap-1 text-sm">
                Date format
                <Select
                  aria-label="Date format"
                  value={options.dateFormat}
                  disabled={locked || cancelled}
                  onChange={(event) =>
                    onOptions({
                      ...options,
                      dateFormat: event.target.value as CsvImportOptions["dateFormat"],
                      dateConfirmed: true,
                    })
                  }
                >
                  {CSV_DATE_FORMATS.map((format) => (
                    <option key={format.value} value={format.value}>
                      {format.label}
                    </option>
                  ))}
                </Select>
              </label>
            )}
            {CSV_IMPORT_FIELDS[kind].map((field) => (
              <div key={field.key} className="grid gap-1 text-sm">
                {field.label}
                {field.required ? " *" : ""}
                <Select
                  aria-label={`${field.label}${field.required ? " *" : ""}`}
                  value={
                    options.mapping[field.key] ??
                    (Object.hasOwn(options.constants ?? {}, field.key) ? "fixed" : "")
                  }
                  disabled={locked || cancelled}
                  onChange={(event) => {
                    const constants = { ...options.constants };
                    if (event.target.value === "fixed") constants[field.key] = "";
                    else delete constants[field.key];
                    onOptions({
                      ...options,
                      mapping: {
                        ...options.mapping,
                        [field.key]: ["", "fixed"].includes(event.target.value)
                          ? null
                          : Number(event.target.value),
                      },
                      constants,
                    });
                  }}
                >
                  <option value="">
                    {kind === "inventory" && !["sku", "stock"].includes(field.key)
                      ? "Keep saved details (existing SKUs)"
                      : field.required
                        ? "Choose a source column"
                        : "Do not use a column"}
                  </option>
                  {kind === "inventory" && CSV_INVENTORY_FIXED_FIELDS.includes(field.key) && (
                    <option value="fixed">Enter a verified value for every row</option>
                  )}
                  {guide.columns.map((column, index) => (
                    <option key={guide.columnIndices[index]} value={guide.columnIndices[index]}>
                      {column}
                    </option>
                  ))}
                </Select>
                {Object.hasOwn(options.constants ?? {}, field.key) && (
                  <Input
                    aria-label={`Verified value for ${field.label}`}
                    value={options.constants?.[field.key] ?? ""}
                    disabled={locked || cancelled}
                    placeholder="Enter the verified shared value"
                    onChange={(event) =>
                      onOptions({
                        ...options,
                        constants: {
                          ...options.constants,
                          [field.key]: event.target.value,
                        },
                      })
                    }
                  />
                )}
              </div>
            ))}
          </div>
          <p className="text-xs text-muted">
            Shown unused source columns:{" "}
            {guide.columns
              .filter(
                (_column, index) =>
                  !Object.values(options.mapping).includes(guide.columnIndices[index]),
              )
              .join("; ") || "none"}
            .
            {guide.sourceColumnCount > guide.columns.length &&
              ` Column choices show the first ${CSV_COLUMN_PREVIEW_LIMIT} source columns and any detected or selected columns from this ${guide.sourceColumnCount.toLocaleString()}-column file. Extra columns are ignored automatically.`}
            {kind === "inventory" &&
              " Existing SKUs keep saved product details unless detail updates are enabled. New SKUs require all product details (*). A verified shared value can supply Category, Unit, Lead Time, Safety Stock, or Unit Cost when it applies to every new product."}
            {kind === "sales" &&
              " Map a Source Record Key only when it identifies one sale line; a receipt number alone may repeat. Changing the product column, separator, or header choice clears manual product matches for a fresh review."}
          </p>
          {guide.unresolvedProducts.length > 0 && (
            <div className="grid gap-3" aria-label="Resolve sales products">
              <p className="font-medium">Match the unrecognized products</p>
              <p className="text-xs text-muted">
                Choose the existing product with the same counting unit. If it is missing, add it in
                Products first, then return to the import. Matches apply to every row with that
                exact source identifier. No products or unit conversions are created automatically.
                {guide.unresolvedProductCount > guide.unresolvedProducts.length &&
                  ` Showing the first ${guide.unresolvedProducts.length} of ${guide.unresolvedProductCount} unresolved identifiers; more appear after these are resolved.`}
              </p>
              {guide.unresolvedProducts.map((product) => (
                <div key={product.source} className="grid gap-1 text-sm">
                  {product.source} · {product.reason} · {product.rows.toLocaleString()} rows
                  <ProductMatchControl
                    source={product.source}
                    products={products}
                    productId={
                      Object.hasOwn(options.productMatches, product.source)
                        ? options.productMatches[product.source]
                        : ""
                    }
                    disabled={locked || cancelled || preparing}
                    onChange={(id) =>
                      onOptions({
                        ...options,
                        productMatches: {
                          ...options.productMatches,
                          [product.source]: id,
                        },
                      })
                    }
                  />
                </div>
              ))}
            </div>
          )}
          {kind === "sales" && selectedMatches.length > 0 && (
            <div className="grid gap-3" role="region" aria-label="Selected product matches">
              <p className="font-medium">Selected product matches</p>
              <label className="grid gap-1 text-sm">
                Find selected product matches
                <Input
                  value={matchSearch}
                  disabled={locked || cancelled}
                  placeholder="Search source identifier, SKU, or product name"
                  onChange={(event) => {
                    setMatchSearch(event.target.value);
                    setMatchPage(0);
                  }}
                />
              </label>
              <p className="text-xs text-muted" role="status">
                {filteredMatches.length
                  ? `Showing ${pageStart + 1}–${pageStart + visibleMatches.length} of ${filteredMatches.length.toLocaleString()} matches.`
                  : "No selected matches found."}{" "}
                Every selected match remains available for review, editing, or removal.
              </p>
              {visibleMatches.map(([source, productId]) => (
                <div key={source} className="grid gap-1 text-sm">
                  {source}
                  <ProductMatchControl
                    source={source}
                    products={products}
                    productId={productId}
                    disabled={locked || cancelled || preparing}
                    onChange={(id) => {
                      const matches = { ...options.productMatches };
                      if (id) matches[source] = id;
                      else delete matches[source];
                      onOptions({ ...options, productMatches: matches });
                    }}
                  />
                </div>
              ))}
              {pageCount > 1 && (
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="outline"
                    disabled={locked || cancelled || currentPage === 0}
                    onClick={() => setMatchPage(currentPage - 1)}
                  >
                    Previous selected matches
                  </Button>
                  <span className="text-xs text-muted">
                    Page {currentPage + 1} of {pageCount}
                  </span>
                  <Button
                    variant="outline"
                    disabled={locked || cancelled || currentPage === pageCount - 1}
                    onClick={() => setMatchPage(currentPage + 1)}
                  >
                    Next selected matches
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      </details>
      <p className="font-medium">Import preview</p>
      <p className="text-sm" aria-live="polite">
        {guide.configurationErrors.length
          ? "The required information could not be found. Import details are available below."
          : guide.invalidRowCount
            ? `${guide.validRowCount.toLocaleString()} complete records found; ${guide.invalidRowCount.toLocaleString()} records need readable required information before import.`
            : `${guide.validRowCount.toLocaleString()} records ready to import.`}
        {preparing && " These counts will update when preparation finishes."}
      </p>
      {guide.convertedPreview.length > 0 && (
        <div className="max-h-72 overflow-auto rounded-lg border border-border">
          <table className="w-full text-left text-xs" aria-label="Converted CSV preview">
            <thead>
              <tr>
                <th className="px-2 py-1">CSV record</th>
                {guide.convertedHeaders.map((header) => (
                  <th className="px-2 py-1" key={header}>
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {guide.convertedPreview.map((record) => (
                <tr key={record.record} className="border-t border-border">
                  <th className="px-2 py-1" scope="row">
                    {record.record}
                  </th>
                  {record.fields.map((field, index) => (
                    <td
                      className="min-w-24 max-w-xs break-words whitespace-pre-wrap px-2 py-1"
                      key={index}
                    >
                      {field || "—"}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-muted">
        Converted preview shows at most the first 50 data records; long text is shortened for
        display. Required values are checked throughout the file. Unreadable values are blank in
        this preview.
      </p>
      {(guide.configurationErrors.length > 0 || guide.issueCount > 0) && (
        <details className="rounded-lg border border-border p-3">
          <summary className="cursor-pointer text-sm font-medium">Import details</summary>
          <div className="mt-3 grid gap-3">
            {guide.configurationErrors.length > 0 && (
              <ul className="list-disc pl-5 text-sm text-muted">
                {guide.configurationErrors.map((message, index) => (
                  <li key={index}>{message}</li>
                ))}
              </ul>
            )}
            {guide.issueCount > 0 && (
              <>
                <div className="max-h-72 overflow-auto rounded-lg border border-border">
                  <table className="w-full text-left text-xs" aria-label="CSV row errors">
                    <thead>
                      <tr>
                        {["Record / line", "Field", "Original value", "Problem"].map((name) => (
                          <th key={name} className="px-2 py-1">
                            {name}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {guide.issuePreview.map((issue, index) => (
                        <tr key={index} className="border-t border-border">
                          <td className="px-2 py-1">
                            {issue.record} / {issue.line}
                          </td>
                          <td className="px-2 py-1">{issue.field}</td>
                          <td className="max-w-xs break-words whitespace-pre-wrap px-2 py-1">
                            {issue.value}
                          </td>
                          <td className="px-2 py-1">{issue.message}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-xs text-muted">
                  Showing at most 50 entries. Download the complete report for source record and
                  line details. Sales or stock records with missing required values must be
                  completed before import.
                </p>
                <Button
                  variant="outline"
                  disabled={locked || preparing || cancelled || downloading}
                  onClick={onDownload}
                >
                  {downloading ? "Preparing report…" : "Download complete error report"}
                </Button>
              </>
            )}
          </div>
        </details>
      )}
      <p className="text-sm text-muted">
        {kind === "inventory"
          ? "Importing stock counts replaces the current counts for matching SKUs."
          : "Importing historical sales does not deduct current stock."}
      </p>
    </div>
  );
}
