import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { CsvImportReview } from "@/components/csv-import-review";
import type { CsvImportOptions } from "@/lib/guided-csv";
import {
  CSV_MAX_SOURCE_BYTES,
  type CsvPreparationSummary,
  type CsvWorkerRequest,
  type CsvWorkerResponse,
} from "@/lib/csv-preparation";
import type { InventoryImportRow, Product, Sale } from "@/lib/types";

type InventoryRow = InventoryImportRow;
type ImportRows = Sale[] | InventoryRow[];
type ImporterProps = {
  placeholder: string;
  importLabel: string;
  rowLimit: number | null;
  disabled?: boolean;
} & (
  | { kind: "sales"; products: Product[]; onImport: (rows: Sale[]) => Promise<boolean> }
  | {
      kind: "inventory";
      products?: Product[];
      onImport: (rows: InventoryRow[], idempotencyKey: string) => Promise<boolean>;
    }
);
type Phase =
  | "idle"
  | "queued"
  | "reading"
  | "decoding"
  | "parsing"
  | "validating"
  | "ready"
  | "error"
  | "cancelled";
const EMPTY_PRODUCTS: Product[] = [];
const preparationLabels: Partial<Record<Phase, string>> = {
  queued: "Waiting for typing to pause…",
  reading: "Reading CSV file…",
  decoding: "Decoding CSV text…",
  parsing: "Parsing CSV records…",
  validating: "Validating CSV records…",
};

function recordPreparationTimings(operation: () => void) {
  try {
    operation();
  } catch {
    // Optional browser timing support must never stop CSV preparation or rendering.
  }
}

/** Owns preparation state so CSV edits never rerender the surrounding records or catalog. */
export function CsvImporter(props: ImporterProps) {
  const { kind, rowLimit, disabled = false } = props;
  const products = props.products ?? EMPTY_PRODUCTS;
  const currentCatalog = useRef(products);
  currentCatalog.current = products;
  const fileInput = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const [method, setMethod] = useState<"file" | "paste">("file");
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState("");
  const [summary, setSummary] = useState<CsvPreparationSummary | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [importFailed, setImportFailed] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const [importing, setImporting] = useState(false);
  const [options, setOptions] = useState<CsvImportOptions | undefined>();
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const workerRef = useRef<Worker | null>(null);
  const preparedCatalog = useRef<Product[] | null>(null);
  const generation = useRef(0);
  const pendingRows = useRef<{
    resolve: (rows: ImportRows) => void;
    reject: (error: Error) => void;
  } | null>(null);
  const mounted = useRef(false);
  const submitting = useRef(false);
  const inventorySubmission = useRef<{
    signature: string;
    key: string;
    rows: InventoryRow[];
    options: CsvImportOptions | undefined;
  } | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useLayoutEffect(() => {
    if (!summary) return;
    recordPreparationTimings(() =>
      performance.measure("csv-preview-render", "csv-preview-render-start"),
    );
    const frame = requestAnimationFrame(() => {
      recordPreparationTimings(() =>
        performance.measure("csv-preview-frame", "csv-preview-render-start"),
      );
    });
    return () => cancelAnimationFrame(frame);
  }, [summary]);

  useEffect(() => {
    const requestId = ++generation.current;
    let active = true;
    let worker: Worker | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setError(null);
    setImportFailed(false);
    setDownloading(false);
    const source =
      method === "file"
        ? file
          ? { type: "file" as const, file }
          : null
        : text.trim()
          ? { type: "text" as const, text }
          : null;

    if (cancelled) setPhase("cancelled");
    else if (!source) setPhase("idle");
    else {
      const fail = (message: string) => {
        if (!active || generation.current !== requestId) return;
        setError(message);
        setSummary(null);
        setDownloading(false);
        setPhase("error");
        pendingRows.current?.reject(new Error(message));
        pendingRows.current = null;
      };
      const start = () => {
        if (!active) return;
        setPhase(source.type === "file" ? "reading" : "parsing");
        try {
          worker = new Worker(new URL("../lib/csv-import.worker.ts", import.meta.url), {
            type: "module",
          });
          workerRef.current = worker;
          worker.onmessage = ({ data }: MessageEvent<CsvWorkerResponse>) => {
            if (!active || generation.current !== requestId || data.requestId !== requestId) return;
            if (data.type === "phase") setPhase(data.phase);
            else if (data.type === "prepared") {
              recordPreparationTimings(() => {
                for (const [name, duration] of [
                  ["csv-read", data.summary.timings.readMs],
                  ["csv-decode", data.summary.timings.decodeMs],
                  ["csv-parse", data.summary.timings.parseMs],
                  ["csv-validation", data.summary.timings.validateMs],
                  ["csv-worker-total", data.summary.timings.totalMs],
                ] as const) {
                  performance.clearMeasures(name);
                  performance.measure(name, {
                    start: 0,
                    duration,
                    detail: { thread: "worker", requestId, scope: "duration-only" },
                  });
                }
                performance.clearMeasures("csv-preview-render");
                performance.clearMeasures("csv-preview-frame");
                performance.mark("csv-preview-render-start");
              });
              preparedCatalog.current = products;
              setSummary(data.summary);
              setError(data.summary.error);
              setPhase(data.summary.error || data.summary.limitExceeded ? "error" : "ready");
            } else if (data.type === "error") fail(data.message);
            else if (data.type === "issues") {
              const url = URL.createObjectURL(data.report);
              const anchor = document.createElement("a");
              anchor.href = url;
              anchor.download = `stockcast-${kind}-import-errors.csv`;
              anchor.click();
              setTimeout(() => URL.revokeObjectURL(url), 1_000);
              setDownloading(false);
            } else if (data.type === "rows" && data.kind === kind) {
              pendingRows.current?.resolve(data.rows);
              pendingRows.current = null;
            }
          };
          worker.onerror = (event) => {
            event.preventDefault();
            fail(
              "CSV preparation could not start or finish. Select the file again or try pasted CSV.",
            );
          };
          worker.onmessageerror = () =>
            fail("CSV preparation returned unreadable data. Select the file again.");
          const request: CsvWorkerRequest = {
            type: "prepare",
            requestId,
            kind,
            source,
            products,
            rowLimit,
            guided: true,
            options,
          };
          worker.postMessage(request);
        } catch (failure) {
          fail(failure instanceof Error ? failure.message : "CSV preparation could not start.");
        }
      };
      if (method === "paste" || options) {
        setPhase(method === "paste" ? "queued" : "validating");
        timer = setTimeout(start, method === "paste" ? 300 : 150);
      } else start();
    }

    return () => {
      active = false;
      if (timer) clearTimeout(timer);
      worker?.terminate();
      if (workerRef.current === worker) workerRef.current = null;
      pendingRows.current?.reject(new Error("CSV preparation was cancelled or replaced."));
      pendingRows.current = null;
    };
  }, [method, file, text, products, kind, rowLimit, cancelled, options]);

  const preparing = phase in preparationLabels;
  const ready =
    phase === "ready" &&
    !!summary &&
    summary.rowCount > 0 &&
    !!workerRef.current &&
    preparedCatalog.current === products;
  const locked = importing || disabled;
  const guide = summary?.guided;
  const selectedOptions = preparing ? (options ?? guide?.options) : (guide?.options ?? options);
  const firstIssue = guide?.issuePreview[0];
  const preparationReason =
    guide?.configurationErrors[0] ??
    (firstIssue
      ? `Record ${firstIssue.record}, ${firstIssue.field}: ${firstIssue.message}`
      : error);

  function replacePreparation(nextPhase: Phase) {
    workerRef.current?.terminate();
    workerRef.current = null;
    ++generation.current;
    preparedCatalog.current = null;
    pendingRows.current?.reject(new Error("CSV preparation was cancelled or replaced."));
    pendingRows.current = null;
    setSummary(null);
    setError(null);
    setImportFailed(false);
    setPhase(nextPhase);
    setDownloading(false);
  }

  function changeOptions(next: CsvImportOptions) {
    const previous = options ?? summary?.guided?.options;
    if (
      kind === "sales" &&
      previous &&
      (previous.mapping.product !== next.mapping.product ||
        previous.header !== next.header ||
        previous.delimiter !== next.delimiter)
    ) {
      // Manual choices belong to identifiers in this source column and structure.
      next = { ...next, productMatches: {} };
    }
    // Invalidate immediately; keep the bounded preview/controls visible during revalidation.
    workerRef.current?.terminate();
    workerRef.current = null;
    ++generation.current;
    preparedCatalog.current = null;
    setPhase("validating");
    setOptions(next);
  }

  function switchMethod(next: "file" | "paste") {
    if (next === method) return;
    inventorySubmission.current = null;
    replacePreparation("idle");
    setCancelled(false);
    setMethod(next);
    setOptions(undefined);
    setAdjustOpen(false);
  }

  function cancelPreparation() {
    // Stop synchronous worker work immediately; the effect also clears a pending paste debounce.
    replacePreparation("cancelled");
    setCancelled(true);
  }

  async function submit() {
    const worker = workerRef.current;
    if (!ready || locked || submitting.current || !worker || preparedCatalog.current !== products)
      return;
    const requestId = generation.current;
    submitting.current = true;
    setImporting(true);
    setError(null);
    setImportFailed(false);
    try {
      const rows = await new Promise<ImportRows>((resolve, reject) => {
        pendingRows.current = { resolve, reject };
        worker.postMessage({ type: "rows", requestId } satisfies CsvWorkerRequest);
      });
      if (
        !mounted.current ||
        requestId !== generation.current ||
        preparedCatalog.current !== currentCatalog.current
      )
        return;
      let clear: boolean;
      if (props.kind === "sales") clear = await props.onImport(rows as Sale[]);
      else {
        const signature = JSON.stringify(rows);
        // Retry the original request after an uncertain response, including when catalog refresh
        // makes a newly created product prepare as an existing-product count with less metadata.
        const previous = inventorySubmission.current;
        if (!previous || (previous.options !== options && previous.signature !== signature))
          inventorySubmission.current = {
            signature,
            key: crypto.randomUUID(),
            rows: rows as InventoryRow[],
            options,
          };
        else previous.options = options;
        const submission = inventorySubmission.current!;
        clear = await props.onImport(submission.rows, submission.key);
      }
      if (clear && mounted.current) {
        inventorySubmission.current = null;
        setFile(null);
        setText("");
        setSummary(null);
        setPhase("idle");
        setOptions(undefined);
        setAdjustOpen(false);
      }
    } catch (failure) {
      if (mounted.current && requestId === generation.current) {
        setImportFailed(true);
        setError(failure instanceof Error ? failure.message : "Import failed.");
      }
    } finally {
      submitting.current = false;
      if (mounted.current) setImporting(false);
    }
  }

  return (
    <div className="grid gap-3" data-csv-state={preparing ? "preparing" : phase}>
      <div className="flex flex-wrap gap-2" aria-label="CSV input method">
        <Button
          type="button"
          variant={method === "file" ? "secondary" : "outline"}
          disabled={locked}
          onClick={() => fileInput.current?.click()}
        >
          Choose CSV file
        </Button>
        <Button
          type="button"
          variant={method === "paste" ? "secondary" : "outline"}
          disabled={locked}
          onClick={() => switchMethod("paste")}
          aria-pressed={method === "paste"}
        >
          Paste CSV
        </Button>
      </div>
      <input
        ref={fileInput}
        type="file"
        disabled={locked}
        accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain"
        className="hidden"
        aria-label="CSV file"
        onChange={(event) => {
          const selected = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (!selected) return;
          inventorySubmission.current = null;
          replacePreparation("reading");
          setCancelled(false);
          setOptions(undefined);
          setAdjustOpen(false);
          setMethod("file");
          setFile(selected);
        }}
      />
      {method === "paste" && (
        <div className="grid gap-2">
          <Label htmlFor={inputId}>Paste CSV text</Label>
          <textarea
            id={inputId}
            value={text}
            disabled={locked}
            onChange={(event) => {
              inventorySubmission.current = null;
              replacePreparation("queued");
              setCancelled(false);
              setOptions(undefined);
              setText(event.target.value);
            }}
            rows={8}
            className="w-full rounded-xl border border-border bg-surface p-3 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            placeholder={props.placeholder}
          />
        </div>
      )}
      <div
        className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface-2 p-3"
        aria-label="CSV upload actions"
      >
        <p className="min-w-0 flex-1 break-all text-sm" data-csv-filename>
          {method === "file" ? (
            file ? (
              <>
                <span className="font-medium">{file.name}</span> · {file.size.toLocaleString()}{" "}
                bytes
              </>
            ) : (
              "No CSV file chosen"
            )
          ) : (
            "Pasted CSV"
          )}
        </p>
        <Button type="button" onClick={submit} disabled={!ready || locked}>
          {importing ? "Uploading…" : props.importLabel}
        </Button>
      </div>
      <p className="text-sm text-muted" role="status" aria-live="polite">
        {importing
          ? "Uploading CSV records…"
          : preparing
            ? preparationLabels[phase]
            : phase === "cancelled"
              ? "Preparation cancelled. Your source is retained."
              : phase === "error"
                ? summary?.guided
                  ? "The extracted records are shown below."
                  : "No records could be read from this file."
                : summary
                  ? `${summary.rowCount.toLocaleString()} ${kind} records extracted.`
                  : "Choose a file or paste CSV to prepare its records."}
      </p>
      <p className="text-sm text-muted" aria-live="polite" data-csv-feedback>
        {importing
          ? "Saving extracted records…"
          : importFailed
            ? "Upload did not finish. Your selected file is kept."
            : ready
              ? `File ready: ${summary!.rowCount.toLocaleString()} ${kind} records. Select ${props.importLabel} to save.`
              : phase === "error" && !summary?.limitExceeded && preparationReason
                ? `File not uploaded. ${preparationReason}`
                : phase === "ready"
                  ? "Checking the latest product details before upload…"
                  : null}
      </p>
      {error && importFailed && (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      )}
      {error && !importFailed && !summary?.guided && (
        <details className="text-sm text-muted">
          <summary className="cursor-pointer">File details</summary>
          <p className="mt-2">{error}</p>
        </details>
      )}
      {summary?.limitExceeded && (
        <p className="text-sm text-muted">
          This CSV has {summary.rowCount.toLocaleString()} rows; the maximum for one {kind} import
          is {summary.rowLimit?.toLocaleString()}. No rows have been submitted.
        </p>
      )}
      {!!summary?.ignoredRowCount && (
        <p className="text-sm text-muted" aria-label="Ignored CSV rows">
          {summary.ignoredRowCount.toLocaleString()} blank or report rows ignored automatically.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {preparing && (
          <Button type="button" variant="outline" onClick={cancelPreparation}>
            Cancel preparation
          </Button>
        )}
        {cancelled && (
          <Button
            type="button"
            variant="outline"
            disabled={locked}
            onClick={() => setCancelled(false)}
          >
            Prepare again
          </Button>
        )}
      </div>
      {guide && selectedOptions && (
        <CsvImportReview
          kind={kind}
          guide={guide}
          options={selectedOptions}
          products={products}
          locked={locked}
          cancelled={cancelled}
          preparing={preparing}
          downloading={downloading}
          adjustOpen={adjustOpen}
          onAdjust={setAdjustOpen}
          onOptions={changeOptions}
          onDownload={() => {
            if (workerRef.current) {
              setDownloading(true);
              workerRef.current.postMessage({
                type: "issues",
                requestId: generation.current,
              } satisfies CsvWorkerRequest);
            }
          }}
        />
      )}
      {summary && method === "file" && summary.preview.length > 0 && (
        <details className="grid gap-2">
          <summary className="cursor-pointer text-sm">View original file</summary>
          <p className="text-xs text-muted">
            {summary.previewTruncated
              ? `Truncated preview: first ${summary.preview.length} of ${summary.logicalRecordCount.toLocaleString()} logical CSV records (including any header).`
              : `Preview: all ${summary.logicalRecordCount.toLocaleString()} logical CSV records (including any header).`}{" "}
            The complete file is retained for import.
            {summary.previewValuesTruncated &&
              " Long preview values or extra columns are shortened; original values are retained."}
          </p>
          <div className="max-h-72 overflow-auto rounded-lg border border-border">
            <table className="w-full text-left font-mono text-xs" aria-label="Uploaded CSV preview">
              <tbody>
                {summary.preview.map((record) => (
                  <tr key={record.record} className="border-b border-border last:border-0">
                    <th
                      className="sticky left-0 bg-surface px-2 py-1 align-top text-muted"
                      scope="row"
                    >
                      {record.record}
                    </th>
                    {record.fields.map((field, index) => (
                      <td
                        key={index}
                        className="min-w-24 max-w-xs px-2 py-1 align-top break-words whitespace-pre-wrap"
                      >
                        {field}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
      <p className="text-xs text-muted">
        Maximum {CSV_MAX_SOURCE_BYTES / (1024 * 1024)} MiB per file or pasted CSV.
        {rowLimit !== null && (
          <>
            {" "}
            Maximum {rowLimit.toLocaleString()} data rows per import. Sources within the size limit
            but above the row limit can be previewed; no rows are submitted.
          </>
        )}
      </p>
    </div>
  );
}
