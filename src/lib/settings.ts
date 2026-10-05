import type { Settings } from "./types";

export type ApiSettings = {
  businessId: string;
  movingAverageWindow: number;
  forecastHorizonDays: number;
  targetCoverDays: number;
  minimumHistoryWeeks: number;
  minimumNonzeroDays: number;
  topNProducts: number;
  cvFolds: number;
  timezone: string;
};

export function fromApiSettings(
  saved: ApiSettings,
  business: { name: string; location: string | null },
  defaults: Settings,
): Settings {
  return {
    ...defaults,
    maWindow: saved.movingAverageWindow,
    forecastHorizon: saved.forecastHorizonDays,
    coverDays: saved.targetCoverDays,
    minWeeks: saved.minimumHistoryWeeks,
    minimumNonzeroDays: saved.minimumNonzeroDays,
    topNProducts: saved.topNProducts,
    cvFolds: saved.cvFolds,
    timezone: saved.timezone,
    storeName: business.name,
    storeLocation: business.location ?? "",
  };
}

export function toApiSettings(settings: Settings): Omit<ApiSettings, "businessId"> & {
  businessName: string;
  businessLocation: string;
} {
  return {
    movingAverageWindow: settings.maWindow,
    businessName: settings.storeName,
    businessLocation: settings.storeLocation,
    forecastHorizonDays: settings.forecastHorizon,
    targetCoverDays: settings.coverDays,
    minimumHistoryWeeks: settings.minWeeks,
    minimumNonzeroDays: settings.minimumNonzeroDays,
    topNProducts: settings.topNProducts,
    cvFolds: settings.cvFolds,
    timezone: settings.timezone,
  };
}
