import assert from "node:assert/strict";
import test from "node:test";
import { ZodError } from "zod";
import { loadConfig } from "./config.ts";

test("loads PostgreSQL environment configuration with safe defaults", () => {
  const config = loadConfig({
    DATABASE_URL: "postgresql://stockcast:secret@localhost:5432/stockcast",
  });
  assert.deepEqual(config, {
    databaseUrl: "postgresql://stockcast:secret@localhost:5432/stockcast",
    port: 3001,
    nodeEnv: "development",
    host: "127.0.0.1",
    corsOrigin: "http://localhost:5173",
    databaseSsl: false,
  });
});

test("requires a PostgreSQL DATABASE_URL", () => {
  assert.throws(() => loadConfig({ DATABASE_URL: "sqlite:test.db" }), ZodError);
});
