import { randomUUID } from "node:crypto";
import { hashPassword } from "./auth.ts";
import { loadConfig } from "./config.ts";
import { createPostgresPool } from "./postgres-pool.ts";

const businessId = process.env.OWNER_BUSINESS_ID ?? randomUUID();
const businessName = process.env.OWNER_BUSINESS_NAME?.trim();
const email = process.env.OWNER_EMAIL?.trim().toLowerCase();
const displayName = process.env.OWNER_DISPLAY_NAME?.trim();
const password = process.env.OWNER_PASSWORD;
const origin = process.env.OWNER_DATA_ORIGIN ?? "demo";
if (!businessName || !email || !displayName || !password)
  throw new Error("Set OWNER_BUSINESS_NAME, OWNER_EMAIL, OWNER_DISPLAY_NAME, and OWNER_PASSWORD");
if (origin !== "demo" && origin !== "partner")
  throw new Error("OWNER_DATA_ORIGIN must be demo or partner");

const pool = createPostgresPool(loadConfig());
const client = await pool.connect();
try {
  await client.query("BEGIN");
  await client.query(
    "INSERT INTO businesses (id,name,data_origin) VALUES ($1,$2,$3) ON CONFLICT (id) DO NOTHING",
    [businessId, businessName, origin],
  );
  await client.query(
    "INSERT INTO business_settings (business_id) VALUES ($1) ON CONFLICT DO NOTHING",
    [businessId],
  );
  const passwordHash = await hashPassword(password);
  await client.query(
    `INSERT INTO users (business_id,email,display_name,role,password_hash,password_changed_at)
     VALUES ($1,$2,$3,'owner',$4,now())
     ON CONFLICT (business_id,email) DO UPDATE SET display_name=excluded.display_name,password_hash=excluded.password_hash,password_changed_at=now(),is_active=true`,
    [businessId, email, displayName, passwordHash],
  );
  await client.query("COMMIT");
  console.log(`Owner ready for business ${businessId} (${origin}).`);
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
