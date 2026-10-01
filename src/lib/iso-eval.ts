export const ISO_ITEMS = [
  {
    id: "functional",
    title: "Functional suitability",
    prompt:
      "The system forecasts demand, calculates reorder points, and recommends restock quantities.",
  },
  {
    id: "reliability",
    title: "Reliability",
    prompt:
      "The system behaves consistently on the same sales history and does not lose catalog data.",
  },
  {
    id: "usability",
    title: "Interaction capability",
    prompt:
      "A non-technical owner can read the briefing, confidence flags, and restock recommendations.",
  },
  {
    id: "performance",
    title: "Performance efficiency",
    prompt: "Forecasts and the dashboard feel responsive enough for day-to-day use.",
  },
  {
    id: "maintainability",
    title: "Maintainability",
    prompt:
      "Settings, catalog, and sales records can be updated without breaking the rest of the system.",
  },
] as const;

export type IsoId = (typeof ISO_ITEMS)[number]["id"];
export type IsoScores = Record<IsoId, number>;

const STORAGE_KEY = "stockcast-iso-eval-v1";

export function accountIsoStorageKey(businessId: string, userId: string): string {
  return STORAGE_KEY + ":api:" + encodeURIComponent(businessId) + ":" + encodeURIComponent(userId);
}

export function emptyIsoScores(): IsoScores {
  return {
    functional: 0,
    reliability: 0,
    usability: 0,
    performance: 0,
    maintainability: 0,
  };
}

function validScore(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 5;
}

export function loadIsoScores(storageKey = STORAGE_KEY): IsoScores {
  const scores = emptyIsoScores();
  if (typeof window === "undefined") return scores;
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return scores;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return scores;
    const values = parsed as Record<string, unknown>;
    for (const item of ISO_ITEMS) {
      if (validScore(values[item.id])) scores[item.id] = values[item.id] as number;
    }
    return scores;
  } catch {
    return scores;
  }
}

export function saveIsoScores(scores: IsoScores, storageKey = STORAGE_KEY) {
  const clean = emptyIsoScores();
  for (const item of ISO_ITEMS) {
    const value = scores[item.id];
    if (value !== 0 && !validScore(value))
      throw new Error("Ratings must be whole numbers from 1 to 5.");
    clean[item.id] = value;
  }
  window.localStorage.setItem(storageKey, JSON.stringify(clean));
}

export function isoAverage(scores: IsoScores): number | null {
  const values = ISO_ITEMS.map((item) => scores[item.id]).filter(validScore);
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
