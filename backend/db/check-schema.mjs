import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const upUrl = new URL("./migrations/001_initial_schema.up.sql", import.meta.url);
const downUrl = new URL("./migrations/001_initial_schema.down.sql", import.meta.url);
const [up, down] = await Promise.all([readFile(upUrl, "utf8"), readFile(downUrl, "utf8")]);

const tables = [
  "businesses",
  "users",
  "products",
  "sales",
  "inventory_movements",
  "data_imports",
  "business_settings",
  "forecast_runs",
  "forecast_predictions",
  "forecast_metrics",
  "reorder_recommendations",
];

for (const table of tables) {
  assert.match(up, new RegExp(`CREATE TABLE ${table} \\(`), `missing table ${table}`);
  assert.match(
    down,
    new RegExp(`DROP TABLE IF EXISTS ${table};`),
    `down migration does not drop ${table}`,
  );
}

for (const method of ["moving_average", "xgboost", "ensemble", "fallback", "rule"]) {
  assert.match(up, new RegExp(`'${method}'`), `missing forecast method ${method}`);
}

for (const split of ["train", "validation", "final_test"]) {
  assert.match(up, new RegExp(`'${split}'`), `missing dataset split ${split}`);
}

for (const productField of [
  "sku text NOT NULL",
  "name text NOT NULL",
  "category text NOT NULL",
  "unit text NOT NULL",
  "current_stock numeric",
  "lead_time_days integer",
  "safety_stock numeric",
  "unit_cost numeric",
]) {
  assert.ok(up.includes(productField), `missing product field: ${productField}`);
}

assert.ok(
  up.includes("training_end < validation_start"),
  "training and validation must not overlap",
);
assert.ok(
  up.includes("validation_end < final_test_start"),
  "validation and final test must not overlap",
);
assert.ok(up.includes("quantity_delta numeric"), "inventory movement delta is required");
assert.ok(
  up.includes("FOREIGN KEY (business_id, import_id) REFERENCES data_imports(business_id, id)"),
  "sale import provenance is required",
);
assert.ok(
  up.includes("xgboost_verified boolean NOT NULL DEFAULT false"),
  "XGBoost must default to unverified",
);
assert.ok(up.trimStart().startsWith("BEGIN;"), "up migration must be transactional");
assert.ok(up.trimEnd().endsWith("COMMIT;"), "up migration must commit");
assert.ok(down.trimStart().startsWith("BEGIN;"), "down migration must be transactional");
assert.ok(down.trimEnd().endsWith("COMMIT;"), "down migration must commit");

console.log(`Schema contract check passed for ${tables.length} tables.`);
