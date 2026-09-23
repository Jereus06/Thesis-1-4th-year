export const ISO_ITEMS = [
  {
    id: "functional",
    title: "Functional suitability",
    prompt: "The system forecasts demand, calculates reorder points, and recommends restock quantities.",
  },
  {
    id: "reliability",
    title: "Reliability",
    prompt: "The system behaves consistently on the same sales history and does not lose catalog data.",
  },
  {
    id: "usability",
    title: "Interaction capability",
    prompt: "A non-technical owner can read the briefing, confidence flags, and restock recommendations.",
  },
  {
    id: "performance",
    title: "Performance efficiency",
    prompt: "Forecasts and the dashboard feel responsive enough for day-to-day use.",
  },
  {
    id: "maintainability",
    title: "Maintainability",
    prompt: "Settings, catalog, and sales records can be updated without breaking the rest of the system.",
  },
] as const;

export type IsoId = (typeof ISO_ITEMS)[number]["id"];
export type IsoScores = Record<IsoId, number>;

const STORAGE_KEY = "stockcast-iso-eval-v1";

export function emptyIsoScores(): IsoScores {
  return {
    functional: 0,
    reliability: 0,
    usability: 0,
    performance: 0,
    maintainability: 0,
  };
}

export function loadIsoScores(): IsoScores {
  if (typeof window === "undefined") return emptyIsoScores();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyIsoScores();
    const parsed = JSON.parse(raw) as Partial<IsoScores>;
    return { ...emptyIsoScores(), ...parsed };
  } catch {
    return emptyIsoScores();
  }
}

export function saveIsoScores(scores: IsoScores) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(scores));
}

export function isoAverage(scores: IsoScores): number | null {
  const values = ISO_ITEMS.map((item) => scores[item.id]).filter((n) => n > 0);
  if (!values.length) return null;
  return values.reduce((sum, n) => sum + n, 0) / values.length;
}
