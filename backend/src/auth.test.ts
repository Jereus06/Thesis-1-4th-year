import assert from "node:assert/strict";
import test from "node:test";
import {
  AuthService,
  hashPassword,
  readSessionCookie,
  sessionCookie,
  verifyPassword,
} from "./auth.ts";
import type { PoolLike } from "./postgres-repository.ts";

test("password hashes are salted and verifiable", async () => {
  const first = await hashPassword("correct horse battery staple");
  const second = await hashPassword("correct horse battery staple");
  assert.notEqual(first, second);
  assert.equal(await verifyPassword("correct horse battery staple", first), true);
  assert.equal(await verifyPassword("wrong password", first), false);
});

test("session cookies are HTTP-only and readable by the server", () => {
  const cookie = sessionCookie("test-token", true);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  assert.match(cookie, /Secure/);
  assert.equal(readSessionCookie("another=x; stockcast_session=test-token"), "test-token");
});

test("sign in creates a hashed session and authentication resolves membership", async () => {
  const passwordHash = await hashPassword("correct horse battery staple");
  let savedHash = "";
  const pool = {
    async query(sql: string, values?: unknown[]) {
      if (sql.includes("FROM users WHERE")) {
        return {
          rows: [
            {
              id: "user-1",
              business_id: "business-1",
              email: "owner@example.test",
              display_name: "Demo Owner",
              role: "owner",
              password_hash: passwordHash,
            },
          ],
          rowCount: 1,
        };
      }
      if (sql.startsWith("INSERT INTO sessions")) {
        savedHash = String(values?.[1]);
        return { rows: [], rowCount: 1 };
      }
      if (sql.startsWith("UPDATE sessions")) {
        assert.equal(values?.[0], savedHash);
        return {
          rows: [
            {
              id: "user-1",
              business_id: "business-1",
              email: "owner@example.test",
              display_name: "Demo Owner",
              role: "owner",
            },
          ],
          rowCount: 1,
        };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  } as unknown as PoolLike;
  const auth = new AuthService(pool);
  const signedIn = await auth.signIn(
    "business-1",
    "OWNER@example.test",
    "correct horse battery staple",
  );
  assert.ok(savedHash && !savedHash.includes(signedIn.token));
  assert.equal((await auth.authenticate(signedIn.token))?.role, "owner");
});
