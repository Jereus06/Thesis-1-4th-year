import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";
import { runMigrations } from "./migrate.ts";

test("migration runner locks, applies, records, and unlocks a migration", async () => {
  const statements: string[] = [];
  const client = {
    async query(sql: string) {
      statements.push(sql);
      if (sql.startsWith("SELECT checksum")) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 0 };
    },
    release() {
      statements.push("RELEASE");
    },
  };
  const pool = {
    async connect() {
      return client;
    },
  } as unknown as Pool;
  const applied = await runMigrations(pool);
  assert.deepEqual(applied, ["001_initial_schema.up.sql"]);
  assert.ok(statements[0].startsWith("SELECT pg_advisory_lock"));
  assert.ok(statements.includes("BEGIN"));
  assert.ok(statements.some((sql) => sql.startsWith("INSERT INTO schema_migrations")));
  assert.ok(statements.includes("COMMIT"));
  assert.ok(statements.some((sql) => sql.startsWith("SELECT pg_advisory_unlock")));
  assert.equal(statements.at(-1), "RELEASE");
});
