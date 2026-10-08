import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
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
  canReview: boolean;
  reviewed: boolean;
  adjustOpen: boolean;
  onAdjust: (open: boolean) => void;
  onOptions: (options: CsvImportOptions) => void;
  onReview: (reviewed: boolean) => void;
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
    (item) =>
      item.isActive !== false &&
      (!search || `${item.sku} ${item.name}`.toLowerCase().includes(search)),
  );
  const choices = matching.slice(0, 50);
  const selected = products.find((item) => item.id === productId && item.isActive !== false);
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
              {item.sku} — {item.name} ({item.unit})
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
  canReview,
  reviewed,
  adjustOpen,
  onAdjust,
  onOptions,
  onReview,
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
      <p className="font-medium">Check what StockCast will import</p>
      <p className="text-sm text-muted">
        We detected the useful columns and skipped the others. Check the preview below. Use Adjust
        import if a column was matched incorrectly.
      </p>
      {guide.formatQuestions.map((question) => (
        <label
          key={question.field}
          className="grid gap-2 rounded-lg border border-border p-3 text-sm"
        >
          {question.field === "date" ? "What date does" : "What number does"} “{question.sample}”
          mean in this file?
          <Select
            aria-label={
              question.field === "date" ? "Confirm date meaning" : "Confirm number meaning"
            }
            value=""
            disabled={locked || cancelled || preparing}
            onChange={(event) =>
              onOptions(
                question.field === "date"
                  ? {
                      ...options,
                      dateFormat: event.target.value as CsvImportOptions["dateFormat"],
                      dateConfirmed: true,
                    }
                  : {
                      ...options,
                      numberFormat: event.target.value as CsvImportOptions["numberFormat"],
                      numberConfirmed: true,
                    },
              )
            }
          >
            <option value="">Choose the correct meaning</option>
            {question.choices.map((choice) => (
              <option key={choice.value} value={choice.value}>
                {choice.label}
              </option>
            ))}
          </Select>
        </label>
      ))}
      {CSV_IMPORT_FIELDS[kind]
        .filter(
          (field) =>
            field.required &&
            (kind === "sales" || ["sku", "stock"].includes(field.key)) &&
            options.mapping[field.key] == null,
        )
        .map((field) => (
          <label key={field.key} className="grid gap-2 rounded-lg border border-border p-3 text-sm">
            {field.key === "quantity"
              ? "Which column shows the number of units sold?"
              : field.key === "stock"
                ? "Which column shows the current stock count?"
                : field.key === "date"
                  ? "Which column contains the sale date?"
                  : field.key === "product"
                    ? "Which column identifies the product sold?"
                    : "Which column contains the SKU / product code?"}
            <Select
              aria-label={`Choose ${field.label} column`}
              value=""
              disabled={locked || cancelled || preparing}
              onChange={(event) =>
                onOptions({
                  ...options,
                  mapping: { ...options.mapping, [field.key]: Number(event.target.value) },
                })
              }
            >
              <option value="">Choose a column</option>
              {guide.columns.map((column, index) => (
                <option key={index} value={index}>
                  {column}
                </option>
              ))}
            </Select>
          </label>
        ))}
      {guide.reusedInventoryRows > 0 && (
        <p className="text-sm text-muted">
          {guide.reusedInventoryRows.toLocaleString()} existing products will keep saved details for
          columns missing from this file. Only supplied details and verified stock counts will be
          updated.
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
                    <option key={index} value={index}>
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
            Ignored source columns:{" "}
            {guide.columns
              .filter((_column, index) => !Object.values(options.mapping).includes(index))
              .join("; ") || "none"}
            .
            {kind === "inventory" &&
              " Existing SKUs can keep saved details when columns are absent. New SKUs require all product details (*). A verified shared value can supply Category, Unit, Lead Time, Safety Stock, or Unit Cost when it applies to every row."}
            {kind === "sales" &&
              " Map a Source Record Key only when it identifies one sale line; a receipt number alone may repeat. Changing the product column, separator, or header choice clears manual product matches for a fresh review."}
          </p>
        </div>
      </details>
      {guide.configurationErrors.length > 0 && (
        <ul className="list-disc pl-5 text-sm text-danger">
          {guide.configurationErrors.map((message, index) => (
            <li key={index}>{message}</li>
          ))}
        </ul>
      )}
      {guide.unresolvedProducts.length > 0 && (
        <div className="grid gap-3" aria-label="Resolve sales products">
          <p className="font-medium">Match the unrecognized products</p>
          <p className="text-xs text-muted">
            Choose the existing product with the same counting unit. If it is missing, add it in
            Products first, then return to the import. Matches apply to every row with that exact
            source identifier. No products or unit conversions are created automatically.
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
      <p className="font-medium">Import preview</p>
      <p className="text-sm" aria-live="polite">
        {guide.configurationErrors.length
          ? "The preview will appear after the questions are answered or the import settings are corrected."
          : `${guide.validRowCount.toLocaleString()} valid rows · ${guide.invalidRowCount.toLocaleString()} rows with errors · ${guide.issueCount.toLocaleString()} problems.`}
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
        display. Invalid numeric/date values are blank here; the error report describes them. All
        rows are checked.
      </p>
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
            Showing at most 50 problems. Download the report for every problem and its source
            record/line. Correct the source file and select it again; no invalid rows are silently
            dropped.
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
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-1"
          checked={reviewed}
          disabled={!canReview || locked}
          onChange={(event) => onReview(event.target.checked)}
        />
        I checked these records and their counting units.
        {kind === "inventory"
          ? " These are verified current stock counts; matching SKUs will replace existing counts."
          : " These are past sales already reflected in current stock; importing them will not deduct stock."}
      </label>
    </div>
  );
}
