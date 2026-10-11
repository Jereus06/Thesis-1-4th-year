import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

// CI only: exercise the real Compose application and PostgreSQL from ZIP-like folders.
const projectDir = fileURLToPath(new URL("..", import.meta.url));
const temporary = mkdtempSync(join(tmpdir(), "StockCast extracted ZIP "));
const original = readFileSync(join(projectDir, ".env"), "utf8");
const ignored = new Set([
  ".git",
  ".env",
  "node_modules",
  ".venv",
  "dist",
  "backups",
  "data",
  "benchmarks",
  "__pycache__",
  ".pytest_cache",
]);
function command(program, args, cwd = projectDir) {
  const result = spawnSync(program, args, { cwd, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
  // Never print captured startup/configuration output: this runner uses disposable secrets.
  assert.equal(result.status, 0, `${program} ${args.slice(0, 3).join(" ")} failed`);
  return result.stdout.trim();
}
function sql(source) {
  return command("docker", [
    "compose",
    "exec",
    "-T",
    "database",
    "psql",
    "-X",
    "-U",
    "stockcast_admin",
    "-d",
    "stockcast",
    "-Atqc",
    source,
  ]);
}
const evidence = () =>
  sql(`SELECT json_build_object(
  'products', (SELECT count(*) FROM products),
  'sales', (SELECT count(*) FROM sales),
  'movements', (SELECT count(*) FROM inventory_movements),
  'users', (SELECT json_agg(json_build_array(id,password_hash) ORDER BY id) FROM users),
  'sentinel', (SELECT count(*) FROM products WHERE sku='SMOKE-PERSIST'))::text`);
const before = evidence();
assert.equal(JSON.parse(before).sentinel, 1, "Run the normal application smoke check first");
let failure;
try {
  for (const name of ["First new ZIP", "Another ZIP with spaces"]) {
    const copied = join(temporary, name);
    cpSync(projectDir, copied, {
      recursive: true,
      filter: (path) =>
        path === projectDir ||
        (!ignored.has(basename(path)) && !basename(path).startsWith(".env.")),
    });
    // cpSync deliberately excludes private configuration and includes its public template.
    writeFileSync(join(copied, ".env.example"), readFileSync(join(projectDir, ".env.example")));
    command(process.execPath, ["scripts/start.mjs"], copied);
    assert.equal(
      readFileSync(join(copied, ".env"), "utf8"),
      original,
      "A fresh ZIP must reuse the installation configuration",
    );
    if (name.startsWith("Another")) {
      const broken = original
        .replace(/^APP_DB_PASSWORD=.*$/m, `APP_DB_PASSWORD=${"c".repeat(48)}`)
        .replace(/^POSTGRES_PASSWORD=.*$/m, `POSTGRES_PASSWORD=${"d".repeat(48)}`)
        .replace(/^OWNER_EMAIL=.*$/m, "OWNER_EMAIL=new-zip-owner@example.com");
      writeFileSync(join(copied, ".env"), broken);
      command(process.execPath, ["scripts/start.mjs"], copied);
      assert.equal(
        readFileSync(join(copied, ".env"), "utf8"),
        broken,
        "Local recovery must not replace the selected configuration",
      );
    }
    assert.equal(
      evidence(),
      before,
      "Products, sales, stock audits and user password hashes must survive ZIP startup/recovery",
    );
  }
} catch (error) {
  failure = error;
} finally {
  // Restore original container mounts/credentials BEFORE deleting temporary source folders.
  command(process.execPath, ["scripts/start.mjs"]);
  assert.ok(evidence() === before);
  rmSync(temporary, { recursive: true, force: true });
}
if (failure) throw failure;
const values = parseEnv(original);
assert.ok(values.APP_DB_PASSWORD);
console.log(
  "Real PostgreSQL ZIP startup, credential recovery, stock/sales persistence and unchanged account password hashes passed.",
);
