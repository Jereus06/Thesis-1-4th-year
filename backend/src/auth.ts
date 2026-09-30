import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { PoolLike } from "./postgres-repository.ts";

const scrypt = promisify(scryptCallback);
const sessionLifetimeMs = 12 * 60 * 60 * 1000;

export type Principal = {
  userId: string;
  businessId: string;
  email: string;
  displayName: string;
  role: "owner" | "staff";
};

export class AuthenticationError extends Error {}

export async function hashPassword(password: string) {
  if (password.length < 12) throw new Error("Password must contain at least 12 characters");
  const salt = randomBytes(16);
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt:${salt.toString("hex")}:${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string) {
  const [algorithm, saltHex, hashHex] = stored.split(":");
  if (algorithm !== "scrypt" || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = (await scrypt(password, Buffer.from(saltHex, "hex"), expected.length)) as Buffer;
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export class AuthService {
  private readonly pool: PoolLike;

  constructor(pool: PoolLike) {
    this.pool = pool;
  }

  async signIn(businessId: string, email: string, password: string) {
    const result = await this.pool.query(
      `SELECT id,business_id,email,display_name,role,password_hash
       FROM users WHERE business_id=$1 AND email=$2 AND is_active`,
      [businessId, email.trim().toLowerCase()],
    );
    const row = result.rows[0];
    if (!row?.password_hash || !(await verifyPassword(password, String(row.password_hash)))) {
      throw new AuthenticationError("Invalid business, email, or password");
    }
    const token = randomBytes(32).toString("base64url");
    await this.pool.query(
      `INSERT INTO sessions (user_id,token_hash,expires_at)
       VALUES ($1,$2,$3)`,
      [row.id, tokenHash(token), new Date(Date.now() + sessionLifetimeMs)],
    );
    return {
      token,
      principal: mapPrincipal(row),
      expiresAt: new Date(Date.now() + sessionLifetimeMs),
    };
  }

  async authenticate(token: string | null): Promise<Principal | null> {
    if (!token) return null;
    const result = await this.pool.query(
      `UPDATE sessions s SET last_seen_at=now()
       FROM users u
       WHERE s.token_hash=$1 AND s.expires_at>now() AND u.id=s.user_id AND u.is_active
       RETURNING u.id,u.business_id,u.email,u.display_name,u.role`,
      [tokenHash(token)],
    );
    return result.rows[0] ? mapPrincipal(result.rows[0]) : null;
  }

  async signOut(token: string | null) {
    if (token)
      await this.pool.query("DELETE FROM sessions WHERE token_hash=$1", [tokenHash(token)]);
  }
}

export function sessionCookie(token: string, secure: boolean) {
  return `stockcast_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${sessionLifetimeMs / 1000}${secure ? "; Secure" : ""}`;
}

export function clearSessionCookie(secure: boolean) {
  return `stockcast_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure ? "; Secure" : ""}`;
}

export function readSessionCookie(header: string | null) {
  const entry = header
    ?.split(";")
    .map((item) => item.trim())
    .find((item) => item.startsWith("stockcast_session="));
  return entry ? entry.slice("stockcast_session=".length) : null;
}

function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
function mapPrincipal(row: Record<string, unknown>): Principal {
  return {
    userId: String(row.id),
    businessId: String(row.business_id),
    email: String(row.email),
    displayName: String(row.display_name),
    role: row.role as "owner" | "staff",
  };
}
