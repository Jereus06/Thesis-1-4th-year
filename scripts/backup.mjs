import { mkdirSync, openSync, closeSync, unlinkSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

process.chdir(fileURLToPath(new URL("..", import.meta.url)));
mkdirSync("backups", { recursive: true });
const path = `backups/stockcast-${new Date().toISOString().replaceAll(":", "-")}.dump`;
const file = openSync(path, "wx", 0o600);
const result = spawnSync(
  "docker",
  ["compose", "exec", "-T", "database", "pg_dump", "-U", "stockcast", "-d", "stockcast", "-Fc"],
  { stdio: ["ignore", file, "inherit"] },
);
closeSync(file);
if (result.error || result.status !== 0) {
  unlinkSync(path);
  console.error("Backup failed. Confirm the database is running.");
  process.exit(1);
}
console.log(`Database backup saved: ${path}`);
