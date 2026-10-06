import {
  csvRowsForSubmission,
  prepareCsv,
  type CsvWorkerRequest,
  type CsvWorkerResponse,
  type PreparedCsv,
} from "./csv-preparation";

// Keep complete source and validated rows here; only a bounded preview reaches React.
let prepared: PreparedCsv | null = null;
let currentRequestId: number | null = null;
const send = (response: CsvWorkerResponse) => globalThis.postMessage(response);

globalThis.onmessage = async (event: MessageEvent<CsvWorkerRequest>) => {
  const request = event.data;
  if (request.type === "prepare") {
    currentRequestId = request.requestId;
    prepared = null;
    const result = await prepareCsv(request, (phase) =>
      send({ type: "phase", requestId: request.requestId, phase }),
    );
    // File reads are async; a later request must never be replaced by their completion.
    if (currentRequestId !== request.requestId) return;
    prepared = result;
    send({ type: "prepared", requestId: request.requestId, summary: result.summary });
    return;
  }
  if (request.requestId !== currentRequestId) return;
  if (!prepared?.data || prepared.summary.error) {
    send({
      type: "error",
      requestId: request.requestId,
      message: prepared?.summary.error ?? "Prepare a valid CSV before importing.",
    });
    return;
  }
  // Import retrieves the cached payload, without repeating decode/parse/validation.
  send({ type: "rows", requestId: request.requestId, ...csvRowsForSubmission(prepared.data) });
};
