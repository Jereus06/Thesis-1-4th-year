import { loadConfig } from "./config.ts";
import { runMigrations } from "./migrate.ts";
import { createPostgresPool } from "./postgres-pool.ts";

const pool = createPostgresPool(loadConfig());
try {
  const applied = await runMigrations(pool);
  console.log(applied.length ? `Applied: ${applied.join(", ")}` : "Database is up to date.");
} finally {
  await pool.end();
}
