import type { PersistAdapter } from "./cache";
import type { PipelineResult } from "@/lib/types";

const CACHE_KEY = "stockcast-forecast-cache-v5";

type CacheEntry = { key: string; result: PipelineResult };

export const localForecastCache: PersistAdapter = {
  read() {
    if (typeof window === "undefined") return null;
    try {
      const raw = window.localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      return JSON.parse(raw) as CacheEntry;
    } catch {
      return null;
    }
  },
  write(entry) {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(CACHE_KEY, JSON.stringify(entry));
    } catch {
      /* quota — serving still works from memory */
    }
  },
  clear() {
    if (typeof window === "undefined") return;
    window.localStorage.removeItem(CACHE_KEY);
  },
};
