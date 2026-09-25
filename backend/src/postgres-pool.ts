import { Pool } from "pg";
import type { BackendConfig } from "./config.ts";

export function createPostgresPool(config: Pick<BackendConfig, "databaseUrl" | "databaseSsl">) {
  return new Pool({
    connectionString: config.databaseUrl,
    ssl: config.databaseSsl ? { rejectUnauthorized: false } : undefined,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
}

export async function checkPostgres(pool: Pool): Promise<boolean> {
  try {
    const result = await pool.query("SELECT 1 AS connected");
    return result.rows[0]?.connected === 1;
  } catch {
    return false;
  }
}
