import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";

const migrationsUrl = new URL("./migrations/", import.meta.url);
const filenames = await readdir(migrationsUrl);
const readMatching = async (suffix) =>
  (
    await Promise.all(
      filenames
        .filter((filename) => filename.endsWith(suffix))
        .sort()
        .map((filename) => readFile(new URL(filename, migrationsUrl), "utf8")),
    )
  ).join("\n");
const [up, down] = await Promise.all([readMatching(".up.sql"), readMatching(".down.sql")]);

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
  "sessions",
  "idempotency_keys",
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
for (const filename of filenames) {
  const sql = await readFile(new URL(filename, migrationsUrl), "utf8");
  assert.ok(sql.trimStart().startsWith("BEGIN;"), `${filename} must be transactional`);
  assert.ok(sql.trimEnd().endsWith("COMMIT;"), `${filename} must commit`);
}

console.log(`Schema contract check passed for ${tables.length} tables.`);
