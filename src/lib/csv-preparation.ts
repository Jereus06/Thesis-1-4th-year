import {
  csvDataRecordCount,
  csvFileEncoding,
  decodeCsvFile,
  parseCsvRecords,
  parseInventoryRecords,
  parseSalesRecords,
  type CsvRecord,
} from "./import-csv";
import type { Product, Sale } from "./types";
import {
  CSV_ISSUE_PREVIEW_LIMIT,
  validateGuidedCsv,
  type CsvImportIssue,
  type CsvImportOptions,
  type CsvProductResolution,
} from "./guided-csv";

export type CsvImportKind = "inventory" | "sales";
export type CsvImportSource = { type: "file"; file: File } | { type: "text"; text: string };
export type CsvPreparationPhase = "reading" | "decoding" | "parsing" | "validating";
// Existing Python request limits (backend/app/schemas.py), not batch-splitting targets.
export const CSV_API_ROW_LIMITS = { inventory: 5_000, sales: 100_000 } as const;
export const CSV_PREVIEW_RECORD_LIMIT = 50;

export type CsvPreparationTimings = {
  readMs: number;
  decodeMs: number;
  parseMs: number;
  validateMs: number;
  totalMs: number;
};

export type CsvPreparationSummary = {
  filename: string | null;
  byteSize: number;
  encoding: string;
  preview: CsvRecord[];
  logicalRecordCount: number;
  rowCount: number;
  previewTruncated: boolean;
  previewValuesTruncated: boolean;
  error: string | null;
  limitExceeded: boolean;
  rowLimit: number | null;
  timings: CsvPreparationTimings;
  guided: {
    options: CsvImportOptions;
    columns: string[];
    configurationErrors: string[];
    issuePreview: CsvImportIssue[];
    issueCount: number;
    validRowCount: number;
    invalidRowCount: number;
    convertedPreview: CsvRecord[];
    convertedHeaders: string[];
    unresolvedProducts: CsvProductResolution[];
    unresolvedProductCount: number;
  } | null;
};

export type CsvPreparedRows =
  { kind: "inventory"; rows: Omit<Product, "id">[] } | { kind: "sales"; rows: Sale[] };

export type CsvPrepareRequest = {
  type: "prepare";
  requestId: number;
  kind: CsvImportKind;
  source: CsvImportSource;
  products: Product[];
  rowLimit: number | null;
  guided?: boolean;
  options?: CsvImportOptions;
};
export type CsvWorkerRequest = CsvPrepareRequest | { type: "rows" | "issues"; requestId: number };
export type CsvWorkerResponse =
  | { type: "phase"; requestId: number; phase: CsvPreparationPhase }
  | { type: "prepared"; requestId: number; summary: CsvPreparationSummary }
  | ({ type: "rows"; requestId: number } & CsvPreparedRows)
  | { type: "issues"; requestId: number; report: Blob }
  | { type: "error"; requestId: number; message: string };

export type PreparedCsv = {
  summary: CsvPreparationSummary;
  data: CsvPreparedRows | null;
  // The exact complete decoded source stays in the worker, independently of preview limits.
  sourceText: string;
  issues: CsvImportIssue[];
};

let salesSubmissionSequence = 0;

/** Reuse validated values, while giving each attempted sale its own browser ledger ID. */
export function csvRowsForSubmission(data: CsvPreparedRows): CsvPreparedRows {
  if (data.kind === "inventory") return data;
  // Source Record Keys remain the duplicate-import identity. Unkeyed rows intentionally
  // remain separate transactions on retry, so their ephemeral Sale IDs must be fresh.
  // A sequence separates requests within one millisecond; randomness separates workers.
  const random = crypto.getRandomValues(new Uint32Array(4)).join("-");
  const submission = `${Date.now()}-${++salesSubmissionSequence}-${random}`;
  return {
    kind: "sales",
    rows: data.rows.map((row, index) => ({
      ...row,
      id: `imp-${row.productId}-${row.date}-${index}-${submission}`,
    })),
  };
}

function boundedPreview(records: CsvRecord[]): {
  preview: CsvRecord[];
  previewValuesTruncated: boolean;
} {
  let remainingCharacters = 24_000;
  let previewValuesTruncated = false;
  const preview = records.slice(0, CSV_PREVIEW_RECORD_LIMIT).map((record) => {
    if (record.fields.length > 12) previewValuesTruncated = true;
    return {
      record: record.record,
      line: record.line,
      fields: record.fields.slice(0, 12).map((field) => {
        const limit = Math.min(500, remainingCharacters);
        const shortened = field.length > limit;
        const value = shortened ? `${field.slice(0, limit)}\u2026` : field;
        remainingCharacters -= Math.min(field.length, limit);
        if (shortened) previewValuesTruncated = true;
        return value;
      }),
    };
  });
  return { preview, previewValuesTruncated };
}

/** Runs inside a worker in the browser; exported for data-correctness regression checks. */
export async function prepareCsv(
  request: CsvPrepareRequest,
  onPhase: (phase: CsvPreparationPhase) => void = () => {},
): Promise<PreparedCsv> {
  const started = performance.now();
  const timings: CsvPreparationTimings = {
    readMs: 0,
    decodeMs: 0,
    parseMs: 0,
    validateMs: 0,
    totalMs: 0,
  };
  const summary: CsvPreparationSummary = {
    filename: request.source.type === "file" ? request.source.file.name : null,
    byteSize: request.source.type === "file" ? request.source.file.size : 0,
    encoding: request.source.type === "file" ? "unknown" : "pasted Unicode text",
    preview: [],
    logicalRecordCount: 0,
    rowCount: 0,
    previewTruncated: false,
    previewValuesTruncated: false,
    error: null,
    limitExceeded: false,
    rowLimit: request.rowLimit,
    timings,
    guided: null,
  };
  let sourceText = "";
  let data: CsvPreparedRows | null = null;
  let issues: CsvImportIssue[] = [];
  let limitMessage: string | null = null;
  const measure = <T>(phase: CsvPreparationPhase, operation: () => T): T => {
    onPhase(phase);
    const phaseStarted = performance.now();
    try {
      return operation();
    } finally {
      const duration = performance.now() - phaseStarted;
      if (phase === "decoding") timings.decodeMs = duration;
      else if (phase === "parsing") timings.parseMs = duration;
      else if (phase === "validating") timings.validateMs = duration;
    }
  };
  try {
    if (request.source.type === "file") {
      onPhase("reading");
      const readStarted = performance.now();
      let buffer: ArrayBuffer;
      try {
        buffer = await request.source.file.arrayBuffer();
      } finally {
        timings.readMs = performance.now() - readStarted;
      }
      sourceText = measure("decoding", () => {
        summary.encoding = csvFileEncoding(buffer);
        return decodeCsvFile(buffer);
      });
    } else {
      sourceText = request.source.text;
      summary.byteSize = new TextEncoder().encode(sourceText).byteLength;
    }
    const records = measure("parsing", () =>
      parseCsvRecords(
        sourceText,
        request.options?.delimiter === "auto" ? undefined : request.options?.delimiter,
      ),
    );
    summary.logicalRecordCount = records.length;
    summary.previewTruncated = records.length > CSV_PREVIEW_RECORD_LIMIT;
    Object.assign(summary, boundedPreview(records));
    data = measure("validating", () => {
      const guided = request.guided
        ? validateGuidedCsv(records, request.kind, request.products, request.options)
        : null;
      summary.rowCount = guided?.rowCount ?? csvDataRecordCount(records, request.kind);
      if (guided) {
        issues = guided.issues;
        summary.guided = {
          options: guided.options,
          columns: guided.columns,
          configurationErrors: guided.configurationErrors,
          issuePreview: guided.issues.slice(0, CSV_ISSUE_PREVIEW_LIMIT),
          issueCount: guided.issues.length,
          validRowCount: guided.validRowCount,
          invalidRowCount: guided.invalidRowCount,
          convertedPreview: guided.convertedPreview,
          convertedHeaders: guided.convertedHeaders,
          unresolvedProducts: guided.unresolvedProducts,
          unresolvedProductCount: guided.unresolvedProductCount,
        };
      }
      if (request.rowLimit !== null && summary.rowCount > request.rowLimit) {
        summary.limitExceeded = true;
        limitMessage =
          `This CSV contains ${summary.rowCount.toLocaleString("en-US")} ${request.kind} rows. ` +
          `The existing import limit is ${request.rowLimit.toLocaleString("en-US")} rows per request. ` +
          "Choose a smaller source file; no rows have been submitted.";
      }
      if (guided) {
        if (guided.configurationErrors.length) throw new Error(guided.configurationErrors[0]);
        if (guided.issues.length)
          throw new Error(
            `${guided.invalidRowCount.toLocaleString("en-US")} rows need correction (${guided.issues.length.toLocaleString("en-US")} problems). Review the error report; no rows have been submitted.`,
          );
        return guided.data;
      }
      const preparedData: CsvPreparedRows =
        request.kind === "inventory"
          ? { kind: "inventory", rows: parseInventoryRecords(records) }
          : { kind: "sales", rows: parseSalesRecords(records, request.products) };
      if (!summary.rowCount) throw new Error("CSV contains no data records to import.");
      return preparedData;
    });
    summary.error = limitMessage;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not prepare this CSV.";
    summary.error = limitMessage ? `${message} ${limitMessage}` : message;
  } finally {
    timings.totalMs = performance.now() - started;
  }
  return { summary, data, sourceText, issues };
}
