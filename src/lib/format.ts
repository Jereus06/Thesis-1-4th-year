export function peso(value: number): string {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    maximumFractionDigits: 0,
  }).format(value);
}

export function num(value: number, digits = 0): string {
  if (!Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-PH", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(value);
}

export function metric(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return num(value, 2);
}

export function pct(value: number, digits = 0): string {
  if (!Number.isFinite(value)) return "—";
  return `${num(value, digits)}%`;
}
