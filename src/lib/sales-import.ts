import type { Sale, SalesImportError, SalesImportResult } from "./types";

// Demo imports use the same explicit source identities as API imports.
// Equal-looking sales without a source ID remain separate transactions.
export function deduplicateSales(existing: Sale[], incoming: Sale[]) {
  const recordsByKey = new Map<string, Set<string>>();
  function remember(row: Sale) {
    const key = row.sourceRecordKey?.trim();
    if (!key) return;
    const records = recordsByKey.get(key) ?? new Set<string>();
    records.add(JSON.stringify([row.productId, row.date, row.qty]));
    recordsByKey.set(key, records);
  }
  existing.forEach(remember);
  const accepted: Sale[] = [];
  const errors: SalesImportError[] = [];
  incoming.forEach((original, index) => {
    const key = original.sourceRecordKey?.trim() || undefined;
    const row = { ...original, sourceRecordKey: key };
    const records = key ? recordsByKey.get(key) : undefined;
    if (records) {
      const matches =
        records.size === 1 && records.has(JSON.stringify([row.productId, row.date, row.qty]));
      errors.push({
        row: index + 1,
        code: matches ? "duplicate_source_record_key" : "source_record_key_conflict",
      });
      return;
    }
    accepted.push(row);
    remember(row);
  });
  const result: SalesImportResult = {
    acceptedRows: accepted.length,
    rejectedRows: errors.length,
    errors,
  };
  return { accepted, result };
}
