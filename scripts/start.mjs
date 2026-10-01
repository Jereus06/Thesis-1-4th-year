import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

process.chdir(fileURLToPath(new URL("..", import.meta.url)));
const check = spawnSync("docker", ["info"], { stdio: "ignore" });
if (!process.argv.includes("--setup-only") && (check.error || check.status !== 0)) {
  console.error("Start Docker Desktop first (Linux containers), then run npm start again.");
  process.exit(1);
}
if (!existsSync(".env")) {
  const ownerPassword = randomBytes(18).toString("hex");
  const configuration = readFileSync(".env.example", "utf8")
    .replace(
      "POSTGRES_PASSWORD=replace_with_a_random_hex_password",
      `POSTGRES_PASSWORD=${randomBytes(24).toString("hex")}`,
    )
    .replace(
      "APP_DB_PASSWORD=replace_with_a_second_random_hex_password",
      `APP_DB_PASSWORD=${randomBytes(24).toString("hex")}`,
    )
    .replace(
      "OWNER_PASSWORD=replace_with_at_least_12_characters",
      `OWNER_PASSWORD=${ownerPassword}`,
    );
  writeFileSync(".env", configuration, { mode: 0o600, flag: "wx" });
  console.log("Created your private .env. First sign-in:");
  console.log("Business ID: 00000000-0000-4000-8000-000000000001");
  console.log("Email: owner@example.com");
  console.log(`Password: ${ownerPassword}`);
  console.log("Keep the .env file; it contains your database and owner credentials.");
}
const configuration = readFileSync(".env", "utf8");
if (process.argv.includes("--setup-only")) {
  console.log("Configuration is saved in .env. Edit it before the first hosted start.");
  process.exit(0);
}
if (/=replace_with_/.test(configuration)) {
  console.error("Replace the password placeholders in .env before starting.");
  process.exit(1);
}
console.log(
  "Starting StockCast. The first build downloads dependencies and can take several minutes.",
);
const result = spawnSync(
  "docker",
  ["compose", "up", "--build", "--detach", "--wait", "--wait-timeout", "180"],
  { stdio: "inherit" },
);
if (result.status !== 0) {
  console.error("Startup failed. Run npm run logs to see the service error.");
  process.exit(result.status ?? 1);
}
const address = configuration.match(/^APP_ADDRESS=(.+)$/m)?.[1]?.trim() ?? ":80";
const port = configuration.match(/^HTTP_PORT=(\d+)$/m)?.[1] ?? "8080";
console.log(
  `StockCast is running: ${address === ":80" ? `http://localhost:${port}` : `https://${address}`}`,
);
console.log("Sign-in credentials are in .env. Stop with npm run stop; saved records remain.");
