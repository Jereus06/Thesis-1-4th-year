import assert from "node:assert/strict";
import test from "node:test";
import { fromApiSettings, toApiSettings } from "../src/lib/settings.ts";

const defaults = {
  storeName: "Demo",
  storeLocation: "Placeholder",
  maWindow: 7,
  forecastHorizon: 14,
  holdoutDays: 28,
  coverDays: 7,
  minWeeks: 8,
  minimumNonzeroDays: 100,
  timezone: "Asia/Manila",
  topNProducts: 8,
  cvFolds: 3,
  useFallbackIfThin: true,
  dataScenario: "partner",
};
const saved = {
  businessId: "business-test",
  movingAverageWindow: 14,
  forecastHorizonDays: 21,
  targetCoverDays: 10,
  minimumHistoryWeeks: 12,
  minimumNonzeroDays: 150,
  topNProducts: 12,
  cvFolds: 4,
  timezone: "America/New_York",
};
const business = { name: "Synthetic Test Store", location: "Synthetic City" };

test("backend model settings survive an unchanged frontend save", () => {
  const settings = fromApiSettings(saved, business, defaults);
  const { businessName, businessLocation, ...payload } = toApiSettings(settings);
  const { businessId: _businessId, ...expected } = saved;
  assert.deepEqual(payload, expected);
  assert.equal(businessName, business.name);
  assert.equal(businessLocation, business.location);
  assert.equal(settings.holdoutDays, defaults.holdoutDays);
  assert.equal(settings.timezone, "America/New_York");
  assert.equal(settings.minimumNonzeroDays, 150);
});

test("editing a visible setting preserves thresholds, timezone, and CV count", () => {
  const settings = fromApiSettings(saved, business, defaults);
  const payload = toApiSettings({ ...settings, forecastHorizon: 30, storeName: "Renamed Store" });
  assert.equal(payload.forecastHorizonDays, 30);
  assert.equal(payload.businessName, "Renamed Store");
  assert.equal(payload.minimumNonzeroDays, 150);
  assert.equal(payload.minimumHistoryWeeks, 12);
  assert.equal(payload.timezone, "America/New_York");
  assert.equal(payload.cvFolds, 4);
  assert.equal(saved.forecastHorizonDays, 21);
});

test("a saved API response replaces old frontend values without replacing demo controls", () => {
  const old = fromApiSettings(saved, business, defaults);
  const refreshed = fromApiSettings(
    { ...saved, minimumNonzeroDays: 120, timezone: "Asia/Singapore", cvFolds: 2 },
    { ...business, location: null },
    old,
  );
  assert.equal(refreshed.minimumNonzeroDays, 120);
  assert.equal(refreshed.timezone, "Asia/Singapore");
  assert.equal(refreshed.cvFolds, 2);
  assert.equal(refreshed.storeLocation, "");
  assert.equal(refreshed.useFallbackIfThin, old.useFallbackIfThin);
});
