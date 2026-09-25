import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Pool } from "pg";

const migrationsDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "../db/migrations");
const lockId = 7_341_921;

export async function runMigrations(pool: Pool, directory = migrationsDirectory) {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [lockId]);
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      filename text PRIMARY KEY,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const filenames = (await readdir(directory)).filter((name) => name.endsWith(".up.sql")).sort();
    const applied: string[] = [];
    for (const filename of filenames) {
      const source = await readFile(resolve(directory, filename), "utf8");
      const checksum = createHash("sha256").update(source).digest("hex");
      const existing = await client.query(
        "SELECT checksum FROM schema_migrations WHERE filename=$1",
        [filename],
      );
      if (existing.rows[0]) {
        if (existing.rows[0].checksum !== checksum)
          throw new Error(`Applied migration ${filename} has changed`);
        continue;
      }
      await client.query("BEGIN");
      try {
        await client.query(withoutTransactionWrapper(source));
        await client.query("INSERT INTO schema_migrations (filename,checksum) VALUES ($1,$2)", [
          filename,
          checksum,
        ]);
        await client.query("COMMIT");
        applied.push(filename);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
    return applied;
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [lockId]);
    client.release();
  }
}

function withoutTransactionWrapper(source: string) {
  return source.replace(/^\s*BEGIN;\s*/i, "").replace(/\s*COMMIT;\s*$/i, "");
}
