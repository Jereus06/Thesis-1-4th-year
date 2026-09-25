import { loadConfig } from "./config.ts";
import { createPostgresPool } from "./postgres-pool.ts";

export const POSTGRES_DEMO_BUSINESS_ID = "00000000-0000-4000-8000-000000000001";

const pool = createPostgresPool(loadConfig());
const client = await pool.connect();
try {
  await client.query("BEGIN");
  await client.query(
    `INSERT INTO businesses (id,name,location,data_origin)
     VALUES ($1,'StockCast Demo Store','Demonstration only','demo')
     ON CONFLICT (id) DO NOTHING`,
    [POSTGRES_DEMO_BUSINESS_ID],
  );
  await client.query(
    `INSERT INTO business_settings (business_id)
     VALUES ($1) ON CONFLICT (business_id) DO NOTHING`,
    [POSTGRES_DEMO_BUSINESS_ID],
  );
  await client.query("COMMIT");
  console.log(`Demo business ready: ${POSTGRES_DEMO_BUSINESS_ID}`);
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
