import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

const keys = [
  "PUBLIC_APP_URL",
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_USERNAME",
  "SMTP_PASSWORD",
  "SMTP_FROM",
  "SMTP_STARTTLS",
];
function compose(overrides = {}) {
  const environment = {
    ...process.env,
    POSTGRES_PASSWORD: "synthetic-postgres-password",
    APP_DB_PASSWORD: "synthetic-app-password",
    OWNER_PASSWORD: "synthetic-owner-password",
    CORS_ORIGIN: "",
    ...Object.fromEntries(keys.map((key) => [key, ""])),
    ...overrides,
  };
  const result = spawnSync(
    "docker",
    [
      "compose",
      "--env-file",
      ".env.example",
      "--file",
      "compose.yaml",
      "config",
      "--format",
      "json",
    ],
    { env: environment, encoding: "utf8" },
  );
  // Never print rendered configuration, which can include private credentials.
  assert.equal(result.status, 0, "Docker Compose configuration validation failed");
  return JSON.parse(result.stdout).services;
}

test("Docker passes explicitly configured email settings only to the API", () => {
  const configured = {
    PUBLIC_APP_URL: "https://synthetic.stockcast.example",
    SMTP_HOST: "smtp.synthetic.example",
    SMTP_PORT: "2525",
    SMTP_USERNAME: "synthetic-user",
    SMTP_PASSWORD: "synthetic-test-password",
    SMTP_FROM: "stockcast@synthetic.example",
    SMTP_STARTTLS: "false",
  };
  const services = compose(configured);
  for (const key of keys) {
    assert.equal(String(services.api.environment[key]), configured[key]);
    assert.equal(Object.hasOwn(services.worker.environment, key), false);
    assert.equal(Object.hasOwn(services.initialize.environment, key), false);
  }
});

test("empty email settings use API defaults and the configured public origin", () => {
  const services = compose({ CORS_ORIGIN: "https://hosted.synthetic.example" });
  assert.equal(services.api.environment.PUBLIC_APP_URL, "https://hosted.synthetic.example");
  assert.equal(String(services.api.environment.SMTP_PORT), "587");
  assert.equal(String(services.api.environment.SMTP_STARTTLS), "true");
  for (const key of ["SMTP_HOST", "SMTP_USERNAME", "SMTP_PASSWORD", "SMTP_FROM"]) {
    assert.equal(services.api.environment[key], "");
  }
});

test("an unset public URL and CORS origin use the local Docker website", () => {
  assert.equal(compose().api.environment.PUBLIC_APP_URL, "http://localhost:8080");
});
