import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { CsvImportReview } from "@/components/csv-import-review";
import type { CsvImportOptions } from "@/lib/guided-csv";
import type {
  CsvPreparationSummary,
  CsvWorkerRequest,
  CsvWorkerResponse,
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
      onImport: (rows: InventoryRow[]) => Promise<boolean>;
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

/** Owns preparation state so CSV edits never rerender the surrounding records or catalog. */
export function CsvImporter(props: ImporterProps) {
  const { kind, rowLimit, disabled = false } = props;
  const products = props.products ?? EMPTY_PRODUCTS;
  const currentCatalog = useRef(products);
  currentCatalog.current = products;
  const inputId = useId();
  const [method, setMethod] = useState<"file" | "paste">("file");
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState("");
  const [summary, setSummary] = useState<CsvPreparationSummary | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [cancelled, setCancelled] = useState(false);
  const [importing, setImporting] = useState(false);
  const [options, setOptions] = useState<CsvImportOptions | undefined>();
  const [reviewed, setReviewed] = useState(false);
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

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useLayoutEffect(() => {
    if (!summary) return;
    performance.measure("csv-preview-render", "csv-preview-render-start");
    const frame = requestAnimationFrame(() => {
      performance.measure("csv-preview-frame", "csv-preview-render-start");
    });
    return () => cancelAnimationFrame(frame);
  }, [summary]);

  useEffect(() => {
    const requestId = ++generation.current;
    let active = true;
    let worker: Worker | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setError(null);
    setReviewed(false);
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
  const ready = phase === "ready" && !!summary && summary.rowCount > 0 && reviewed;
  const locked = importing || disabled;
  const guide = summary?.guided;
  const selectedOptions = preparing ? (options ?? guide?.options) : (guide?.options ?? options);

  function replacePreparation(nextPhase: Phase) {
    workerRef.current?.terminate();
    workerRef.current = null;
    ++generation.current;
    preparedCatalog.current = null;
    pendingRows.current?.reject(new Error("CSV preparation was cancelled or replaced."));
    pendingRows.current = null;
    setSummary(null);
    setError(null);
    setPhase(nextPhase);
    setReviewed(false);
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
    setReviewed(false);
    setPhase("validating");
    setOptions(next);
  }

  function switchMethod(next: "file" | "paste") {
    if (next === method) return;
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
    if (!ready || locked || !worker || preparedCatalog.current !== products) return;
    const requestId = generation.current;
    setImporting(true);
    setError(null);
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
      const clear =
        props.kind === "sales"
          ? await props.onImport(rows as Sale[])
          : await props.onImport(rows as InventoryRow[]);
      if (clear && mounted.current) {
        setFile(null);
        setText("");
        setSummary(null);
        setPhase("idle");
        setOptions(undefined);
        setAdjustOpen(false);
        setReviewed(false);
      }
    } catch (failure) {
      if (mounted.current && requestId === generation.current)
        setError(failure instanceof Error ? failure.message : "Import failed.");
    } finally {
      if (mounted.current) setImporting(false);
    }
  }

  return (
    <div className="grid gap-3" data-csv-state={preparing ? "preparing" : phase}>
      <div className="flex flex-wrap gap-2" aria-label="CSV input method">
        <Button
          variant={method === "file" ? "secondary" : "outline"}
          disabled={locked}
          onClick={() => switchMethod("file")}
          aria-pressed={method === "file"}
        >
          Uploaded file
        </Button>
        <Button
          variant={method === "paste" ? "secondary" : "outline"}
          disabled={locked}
          onClick={() => switchMethod("paste")}
          aria-pressed={method === "paste"}
        >
          Paste CSV
        </Button>
      </div>
      {method === "file" ? (
        <div className="grid gap-2">
          <label
            className={`inline-flex h-11 w-fit items-center justify-center rounded-lg border border-border bg-surface px-4 text-sm font-medium ${locked ? "opacity-50" : "cursor-pointer hover:bg-surface-2"}`}
          >
            Upload CSV file
            <input
              type="file"
              disabled={locked}
              accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain"
              className="sr-only"
              onChange={(event) => {
                const selected = event.currentTarget.files?.[0];
                event.currentTarget.value = "";
                if (!selected) return;
                replacePreparation("reading");
                setCancelled(false);
                setOptions(undefined);
                setAdjustOpen(false);
                setFile(selected);
              }}
            />
          </label>
          {file && (
            <p className="break-all text-sm">
              <span className="font-medium">{file.name}</span> · {file.size.toLocaleString()} bytes
            </p>
          )}
        </div>
      ) : (
        <div className="grid gap-2">
          <Label htmlFor={inputId}>Paste CSV text</Label>
          <textarea
            id={inputId}
            value={text}
            disabled={locked}
            onChange={(event) => {
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
      <p className="text-sm text-muted" role="status" aria-live="polite">
        {importing
          ? "Importing prepared rows…"
          : preparing
            ? preparationLabels[phase]
            : phase === "cancelled"
              ? "Preparation cancelled. Your source is retained."
              : phase === "error"
                ? "CSV preparation needs attention."
                : summary
                  ? `${summary.rowCount.toLocaleString()} rows prepared · ${summary.encoding}. Review the converted values before importing.`
                  : "Choose a file or paste CSV to prepare its records."}
      </p>
      {error && (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      )}
      {summary?.limitExceeded && !summary.error && (
        <p className="text-sm text-danger" role="alert">
          This CSV has {summary.rowCount.toLocaleString()} rows; the maximum for one {kind} import
          is {summary.rowLimit?.toLocaleString()}. No rows have been submitted.
        </p>
      )}
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
          canReview={phase === "ready"}
          reviewed={reviewed}
          adjustOpen={adjustOpen}
          onAdjust={setAdjustOpen}
          onReview={setReviewed}
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
      {rowLimit !== null && (
        <p className="text-xs text-muted">
          Maximum {rowLimit.toLocaleString()} data rows per import. Files above this limit can be
          previewed; no rows are submitted.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={submit} disabled={!ready || locked}>
          {importing ? "Importing…" : props.importLabel}
        </Button>
        {preparing && (
          <Button variant="outline" onClick={cancelPreparation}>
            Cancel preparation
          </Button>
        )}
        {cancelled && (
          <Button variant="outline" disabled={locked} onClick={() => setCancelled(false)}>
            Prepare again
          </Button>
        )}
      </div>
    </div>
  );
}
