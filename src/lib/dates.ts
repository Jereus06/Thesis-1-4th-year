export function parseDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function formatISO(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function addDays(iso: string, days: number): string {
  const date = parseDate(iso);
  date.setDate(date.getDate() + days);
  return formatISO(date);
}

export function enumerateDays(start: string, end: string): string[] {
  const out: string[] = [];
  let cursor = start;
  while (cursor <= end) {
    out.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return out;
}

export function minDate(dates: string[]): string {
  return dates.reduce((a, b) => (a < b ? a : b));
}

export function maxDate(dates: string[]): string {
  return dates.reduce((a, b) => (a > b ? a : b));
}

export function formatLong(iso: string): string {
  return parseDate(iso).toLocaleDateString("en-PH", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export function formatShort(iso: string): string {
  return parseDate(iso).toLocaleDateString("en-PH", {
    day: "numeric",
    month: "short",
  });
}

export function todayISO(): string {
  return formatISO(new Date());
}
