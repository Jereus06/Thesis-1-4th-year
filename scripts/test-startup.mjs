import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseEnv } from "node:util";
import test from "node:test";
import { privateConfigPath, startStockCast } from "./startup.mjs";

const template = readFileSync(new URL("../.env.example", import.meta.url), "utf8");
const configuration = template
  .replace("replace_with_a_random_hex_password", "a".repeat(48))
  .replace("replace_with_a_second_random_hex_password", "b".repeat(48))
  .replace("replace_with_at_least_12_characters", "synthetic-owner-password");

function installation(t, overrides = {}) {
  const root = mkdtempSync(join(tmpdir(), "StockCast ZIP with spaces "));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const projectDir = join(root, "First download");
  mkdirSync(join(projectDir, "deploy"), { recursive: true });
  writeFileSync(join(projectDir, ".env.example"), template);
  writeFileSync(
    join(projectDir, "deploy", "check-database.sh"),
    readFileSync(new URL("../deploy/check-database.sh", import.meta.url), "utf8"),
  );
  const environment = { STOCKCAST_CONFIG_DIR: join(root, "Private config"), ...overrides };
  const messages = [];
  const calls = [];
  const state = {
    password: null,
    containers: [],
    context: "desktop-linux",
    endpoint: "unix:///docker.sock",
    dockerDown: false,
    composeInvalid: false,
    startFails: false,
    checkStatus: null,
    repairFails: false,
    stopFails: false,
  };
  const success = (stdout = "") => ({ status: 0, stdout, stderr: "" });
  const run = (_command, args, options) => {
    calls.push({ args, options });
    const envPath = join(options.cwd, ".env");
    const values = existsSync(envPath)
      ? { ...parseEnv(readFileSync(envPath, "utf8")), ...environment }
      : {};
    if (args[0] === "info") return { ...success(), status: state.dockerDown ? 1 : 0 };
    if (args[0] === "context" && args[1] === "show") return success(state.context);
    if (args[0] === "context") return success(JSON.stringify(state.endpoint));
    if (args[0] === "ps") return success(state.containers.length ? "synthetic-container" : "");
    if (args[0] === "inspect") return success(JSON.stringify(state.containers));
    if (args[1] === "stop") return { ...success(), status: state.stopFails ? 1 : 0 };
    if (args[1] === "config") {
      if (state.composeInvalid)
        return { status: 1, stderr: "synthetic-private-secret", stdout: "" };
      return success(
        JSON.stringify({
          name: values.COMPOSE_PROJECT_NAME || "stockcast",
          services: { api: { environment: values }, web: { environment: values } },
        }),
      );
    }
    if (args[1] === "exec") {
      if (args.includes("--repair-local")) {
        if (state.repairFails) return { status: 1, stdout: "", stderr: values.APP_DB_PASSWORD };
        state.password = values.APP_DB_PASSWORD;
        return success();
      }
      return {
        ...success(),
        status: state.checkStatus ?? (state.password === values.APP_DB_PASSWORD ? 0 : 10),
      };
    }
    if (args.at(-1) === "database") {
      state.password ??= values.APP_DB_PASSWORD;
      return success();
    }
    if (args[1] === "up") return { ...success(), status: state.startFails ? 1 : 0 };
    throw new Error(`Unexpected Docker operation ${args.join(" ")}`);
  };
  const start = (settings = {}) =>
    startStockCast({
      projectDir,
      environment,
      run,
      log: (s) => messages.push(s),
      error: (s) => messages.push(s),
      ...settings,
    });
  return {
    root,
    projectDir,
    environment,
    state,
    calls,
    messages,
    start,
    cache: privateConfigPath(environment, "desktop-linux", "stockcast"),
  };
}

const repairCalls = (fixture) =>
  fixture.calls.filter(({ args }) => args.includes("--repair-local"));
const fullStarts = (fixture) => fixture.calls.filter(({ args }) => args.includes("--build"));

test("first installation generates private passwords and checks database login before initialization", (t) => {
  const f = installation(t);
  assert.equal(f.start(), 0);
  const local = readFileSync(join(f.projectDir, ".env"), "utf8");
  assert.equal(readFileSync(f.cache, "utf8"), local);
  assert.match(parseEnv(local).APP_DB_PASSWORD, /^[a-f0-9]{48}$/);
  assert.equal(repairCalls(f).length, 0);
  const checkIndex = f.calls.findIndex(({ args }) => args[1] === "exec");
  assert.ok(checkIndex < f.calls.findIndex(({ args }) => args.includes("--build")));
  if (process.platform !== "win32") assert.equal(statSync(f.cache).mode & 0o777, 0o600);
  assert.ok(f.messages.every((line) => !line.includes(parseEnv(local).OWNER_PASSWORD)));
});

test("a newly extracted ZIP reuses all private settings from the successful installation", (t) => {
  const f = installation(t);
  const original = configuration.replace(
    "SMTP_PASSWORD=",
    "SMTP_PASSWORD=synthetic-private-mail-password",
  );
  writeFileSync(join(f.projectDir, ".env"), original);
  assert.equal(f.start(), 0);
  const second = join(f.root, "Second extracted ZIP");
  mkdirSync(join(second, "deploy"), { recursive: true });
  writeFileSync(join(second, ".env.example"), template);
  writeFileSync(
    join(second, "deploy", "check-database.sh"),
    readFileSync(join(f.projectDir, "deploy", "check-database.sh")),
  );
  assert.equal(f.start({ projectDir: second }), 0);
  assert.equal(readFileSync(join(second, ".env"), "utf8"), original);
  assert.equal(repairCalls(f).length, 0);
  assert.match(f.messages.join("\n"), /Restored your existing private configuration/);
  assert.doesNotMatch(
    f.messages.join("\n"),
    /synthetic-private-mail-password|synthetic-owner-password/,
  );
});

test("local settings take precedence over the cache and successful changes update it", (t) => {
  const f = installation(t);
  writeFileSync(join(f.projectDir, ".env"), configuration);
  assert.equal(f.start(), 0);
  const edited = configuration.replace("HTTP_PORT=8080", "HTTP_PORT=8090");
  writeFileSync(join(f.projectDir, ".env"), edited);
  assert.equal(f.start(), 0);
  assert.equal(readFileSync(f.cache, "utf8"), edited);
  assert.match(f.messages.join("\n"), /http:\/\/localhost:8090/);
});

test("an old local volume with missing private settings receives a bounded credential repair", (t) => {
  const f = installation(t);
  f.state.password = "old-private-password";
  assert.equal(f.start(), 0);
  assert.equal(repairCalls(f).length, 1);
  assert.equal(
    f.state.password,
    parseEnv(readFileSync(join(f.projectDir, ".env"), "utf8")).APP_DB_PASSWORD,
  );
  assert.match(f.messages.join("\n"), /saved records and account passwords remain unchanged/);
  assert.ok(f.calls.every(({ args }) => !args.includes("down") && !args.includes("volume")));
});

test("a previously generated incorrect local .env is repaired without replacing that file", (t) => {
  const f = installation(t);
  f.state.password = "original-private-password";
  writeFileSync(join(f.projectDir, ".env"), configuration);
  assert.equal(f.start(), 0);
  assert.equal(repairCalls(f).length, 1);
  assert.equal(readFileSync(join(f.projectDir, ".env"), "utf8"), configuration);
});

for (const [name, change] of [
  [
    "production",
    (f) =>
      writeFileSync(
        join(f.projectDir, ".env"),
        configuration.replace("APP_ENV=development", "APP_ENV=production"),
      ),
  ],
  [
    "public domain",
    (f) =>
      writeFileSync(
        join(f.projectDir, ".env"),
        configuration.replace("http://localhost:8080", "https://stockcast.example"),
      ),
  ],
  [
    "public web address",
    (f) =>
      writeFileSync(
        join(f.projectDir, ".env"),
        configuration.replace("APP_ADDRESS=:80", "APP_ADDRESS=stockcast.example"),
      ),
  ],
  [
    "remote context",
    (f) => {
      f.state.endpoint = "ssh://synthetic-server";
    },
  ],
  [
    "remote context overriding a local DOCKER_HOST",
    (f) => {
      f.environment.DOCKER_CONTEXT = "remote";
      f.environment.DOCKER_HOST = "unix:///docker.sock";
      f.state.endpoint = "ssh://synthetic-server";
    },
  ],
  [
    "remote DOCKER_HOST",
    (f) => {
      f.environment.DOCKER_HOST = "tcp://synthetic-server:2376";
    },
  ],
])
  test(`${name} never repairs a database password automatically`, (t) => {
    const f = installation(t);
    f.state.password = "existing-password";
    change(f);
    assert.equal(f.start(), 1);
    assert.equal(repairCalls(f).length, 0);
    assert.equal(fullStarts(f).length, 0);
    assert.equal(f.state.password, "existing-password");
    assert.equal(existsSync(f.cache), false);
  });

test("a new default ZIP cannot replace the configuration of existing hosted containers", (t) => {
  const f = installation(t);
  f.state.containers = [
    { Config: { Env: ["APP_ENV=production", "CORS_ORIGIN=https://hosted.example"] } },
  ];
  assert.equal(f.start(), 1);
  assert.equal(f.calls.filter(({ args }) => args[1] === "up").length, 0);
  assert.match(f.messages.join("\n"), /Restore its original private .env/);
});

test("healthy production credentials start normally without any repair", (t) => {
  const f = installation(t);
  writeFileSync(
    join(f.projectDir, ".env"),
    configuration.replace("APP_ENV=development", "APP_ENV=production"),
  );
  f.state.containers = [{ Config: { Env: ["APP_ENV=production"] } }];
  f.state.password = parseEnv(configuration).APP_DB_PASSWORD;
  assert.equal(f.start(), 0);
  assert.equal(repairCalls(f).length, 0);
});

test("Docker not running creates no private configuration or database changes", (t) => {
  const f = installation(t);
  f.state.dockerDown = true;
  assert.equal(f.start(), 1);
  assert.equal(existsSync(join(f.projectDir, ".env")), false);
  assert.match(f.messages.join("\n"), /Start Docker Desktop first/);
});

test("setup-only works without a running Docker engine and saves a reusable configuration", (t) => {
  const f = installation(t);
  f.state.dockerDown = true;
  assert.equal(f.start({ setupOnly: true }), 0);
  assert.equal(
    f.calls.some(({ args }) => args[1] === "up"),
    false,
  );
  assert.equal(readFileSync(f.cache, "utf8"), readFileSync(join(f.projectDir, ".env"), "utf8"));
});

test("placeholders and invalid Compose configurations stop before database startup", (t) => {
  const f = installation(t);
  writeFileSync(join(f.projectDir, ".env"), template);
  assert.equal(f.start(), 1);
  assert.equal(
    f.calls.some(({ args }) => args[1] === "up"),
    false,
  );
  writeFileSync(join(f.projectDir, ".env"), configuration);
  f.state.composeInvalid = true;
  assert.equal(f.start(), 1);
  assert.doesNotMatch(f.messages.join("\n"), /synthetic-private-secret/);
});

test("unexpected database check errors do not trigger credential changes", (t) => {
  const f = installation(t);
  f.state.checkStatus = 2;
  assert.equal(f.start(), 1);
  assert.equal(repairCalls(f).length, 0);
});

test("failed repair does not start application services or publish a private cache", (t) => {
  const f = installation(t);
  f.state.password = "existing-password";
  f.state.repairFails = true;
  assert.equal(f.start(), 1);
  assert.equal(fullStarts(f).length, 0);
  assert.equal(existsSync(f.cache), false);
  assert.doesNotMatch(
    f.messages.join("\n"),
    new RegExp(parseEnv(readFileSync(join(f.projectDir, ".env"), "utf8")).APP_DB_PASSWORD),
  );
});

test("a failed application startup cannot overwrite a previously working private copy", (t) => {
  const f = installation(t);
  writeFileSync(join(f.projectDir, ".env"), configuration);
  assert.equal(f.start(), 0);
  writeFileSync(
    join(f.projectDir, ".env"),
    configuration.replace("HTTP_PORT=8080", "HTTP_PORT=8090"),
  );
  f.state.startFails = true;
  assert.equal(f.start(), 1);
  assert.equal(readFileSync(f.cache, "utf8"), configuration);
});

test("private copies are separated by Docker context and Compose project", () => {
  const env = { STOCKCAST_CONFIG_DIR: "/synthetic/private" };
  assert.notEqual(
    privateConfigPath(env, "default", "stockcast"),
    privateConfigPath(env, "remote", "stockcast"),
  );
  assert.notEqual(
    privateConfigPath(env, "default", "stockcast"),
    privateConfigPath(env, "default", "other"),
  );
  assert.match(
    privateConfigPath({ LOCALAPPDATA: "/synthetic/user" }, "default", "stockcast", "win32"),
    /StockCast/,
  );
});

test("Docker Desktop named pipes support local recovery", (t) => {
  const f = installation(t);
  f.state.endpoint = "npipe:////./pipe/dockerDesktopLinuxEngine";
  f.state.password = "original-private-password";
  assert.equal(f.start(), 0);
  assert.equal(repairCalls(f).length, 1);
});

test("existing application processes stop before a ZIP changes the database container", (t) => {
  const f = installation(t);
  assert.equal(f.start(), 0);
  const stopped = f.calls.findIndex(({ args }) => args[1] === "stop");
  const database = f.calls.findIndex(({ args }) => args.at(-1) === "database" && args[1] === "up");
  assert.ok(stopped >= 0 && stopped < database);
  assert.deepEqual(f.calls[stopped].args.slice(2), ["api", "worker", "web"]);
});

test("failed service shutdown leaves the database untouched", (t) => {
  const f = installation(t);
  f.state.stopFails = true;
  assert.equal(f.start(), 1);
  assert.equal(
    f.calls.some(({ args }) => args[1] === "up"),
    false,
  );
  assert.equal(repairCalls(f).length, 0);
});
