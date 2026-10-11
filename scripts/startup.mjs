import { createHash, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { parseEnv } from "node:util";

export function privateConfigPath(environment, context, project, platform = process.platform) {
  const directory =
    environment.STOCKCAST_CONFIG_DIR ||
    (platform === "win32"
      ? join(environment.LOCALAPPDATA || join(homedir(), "AppData", "Local"), "StockCast")
      : join(environment.XDG_CONFIG_HOME || join(homedir(), ".config"), "stockcast"));
  const key = createHash("sha256").update(`${context}\n${project}`).digest("hex").slice(0, 20);
  return join(directory, `${key}.env`);
}

function savePrivateCopy(path, configuration) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  writeFileSync(temporary, configuration, { mode: 0o600, flag: "wx" });
  renameSync(temporary, path);
  chmodSync(path, 0o600);
}

function makeConfiguration(template) {
  return template
    .replace("replace_with_a_random_hex_password", randomBytes(24).toString("hex"))
    .replace("replace_with_a_second_random_hex_password", randomBytes(24).toString("hex"))
    .replace("replace_with_at_least_12_characters", randomBytes(18).toString("hex"));
}

function isLocalDevelopment(api, endpoint) {
  try {
    return (
      api.APP_ENV === "development" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(new URL(api.CORS_ORIGIN).hostname) &&
      /^(unix|npipe):\/\//.test(endpoint)
    );
  } catch {
    return false;
  }
}

function configuredHostedContainer(containers) {
  return containers.some((container) => {
    const env = Object.fromEntries(
      (container.Config?.Env || []).map((item) => {
        const split = item.indexOf("=");
        return [item.slice(0, split), item.slice(split + 1)];
      }),
    );
    return (
      env.APP_ENV === "production" || (env.CORS_ORIGIN && !isLocalDevelopment(env, "unix:///local"))
    );
  });
}

export function startStockCast({
  projectDir,
  setupOnly = false,
  environment = process.env,
  run = spawnSync,
  log = console.log,
  error = console.error,
}) {
  const docker = (args, options = {}) =>
    run("docker", args, {
      cwd: projectDir,
      env: environment,
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
      timeout: 15_000,
      ...options,
    });
  const ok = (result) => !result.error && result.status === 0;
  const failure = (message) => {
    error(message);
    return 1;
  };
  try {
    if (!setupOnly && !ok(docker(["info"])))
      return failure("Start Docker Desktop first (Linux containers), then run npm start again.");
    const contextResult = docker(["context", "show"]);
    const context =
      environment.DOCKER_CONTEXT ||
      environment.DOCKER_HOST ||
      (ok(contextResult) ? contextResult.stdout.trim() : "default");
    const localPath = join(projectDir, ".env");
    const local = existsSync(localPath) ? readFileSync(localPath, "utf8") : null;
    const project =
      environment.COMPOSE_PROJECT_NAME ||
      (local && parseEnv(local).COMPOSE_PROJECT_NAME) ||
      "stockcast";
    const cachePath = privateConfigPath(environment, context, project);
    let configuration = local;
    if (configuration === null) {
      if (existsSync(cachePath)) {
        configuration = readFileSync(cachePath, "utf8");
        log("Restored your existing private configuration for this Docker installation.");
      } else {
        configuration = makeConfiguration(readFileSync(join(projectDir, ".env.example"), "utf8"));
        log("Created your private .env. Initial owner details are inside that file.");
      }
      writeFileSync(localPath, configuration, { mode: 0o600, flag: "wx" });
    }
    if (/=replace_with_/.test(configuration))
      return failure("Replace the password placeholders in .env before starting.");
    if (setupOnly) {
      savePrivateCopy(cachePath, configuration);
      log("Configuration is saved in .env. Edit it before the first hosted start.");
      return 0;
    }
    // Capture rendered Compose configuration privately; never print its credentials.
    const rendered = docker(["compose", "config", "--format", "json"]);
    if (!ok(rendered))
      return failure(
        "Docker Compose could not read the configuration. Check your .env and Compose installation.",
      );
    const compose = JSON.parse(rendered.stdout);
    const api = compose.services.api.environment;
    const endpointResult = docker([
      "context",
      "inspect",
      "--format",
      "{{json .Endpoints.docker.Host}}",
    ]);
    const selectedEndpoint = ok(endpointResult) ? JSON.parse(endpointResult.stdout) : "";
    const endpoint = environment.DOCKER_CONTEXT
      ? selectedEndpoint
      : environment.DOCKER_HOST || selectedEndpoint;
    const localDevelopment =
      isLocalDevelopment(api, endpoint) &&
      /^:\d+$/.test(compose.services.web?.environment?.APP_ADDRESS || "");
    // Inspect BEFORE recreating containers, so a new ZIP cannot disguise a hosted installation.
    const ids = docker([
      "ps",
      "-a",
      "--filter",
      `label=com.docker.compose.project=${compose.name}`,
      "--filter",
      "label=com.docker.compose.service=api",
      "--format",
      "{{.ID}}",
    ]);
    if (!ok(ids))
      return failure(
        "Could not inspect the existing Docker installation. Its records were left unchanged.",
      );
    let hosted = false;
    if (ids.stdout.trim()) {
      const inspected = docker(["inspect", ...ids.stdout.trim().split(/\s+/)]);
      if (!ok(inspected))
        return failure("Could not inspect existing settings. Keep the original .env and retry.");
      hosted = configuredHostedContainer(JSON.parse(inspected.stdout));
    }
    if (hosted && localDevelopment)
      return failure(
        "This Docker project contains a hosted installation. Restore its original private .env before starting this ZIP.",
      );
    const database = docker(
      ["compose", "up", "--detach", "--wait", "--wait-timeout", "180", "database"],
      { stdio: "inherit", timeout: 0 },
    );
    if (!ok(database))
      return failure(
        "Database startup failed. Run docker compose logs --no-color --tail 100 database.",
      );
    const script = readFileSync(join(projectDir, "deploy", "check-database.sh"), "utf8").replaceAll(
      "\r\n",
      "\n",
    );
    const checkArgs = ["compose", "exec", "-T", "database", "sh", "-s", "--"];
    let checked = docker(checkArgs, { input: script, timeout: 30_000 });
    if (!ok(checked)) {
      if (checked.status !== 10 || hosted || !localDevelopment)
        return failure(
          "Database login failed. Restore the matching private .env. Hosted and remote database passwords are never changed automatically.",
        );
      log(
        "Recovering local database access for this configuration; saved records and account passwords remain unchanged.",
      );
      checked = docker([...checkArgs, "--repair-local"], { input: script, timeout: 30_000 });
      if (!ok(checked))
        return failure(
          "Local database access could not be recovered. Keep its volume and restore the original .env; no records were deleted.",
        );
    }
    log("Starting StockCast. The first build downloads dependencies and can take several minutes.");
    const started = docker(
      ["compose", "up", "--build", "--detach", "--wait", "--wait-timeout", "180"],
      { stdio: "inherit", timeout: 0 },
    );
    if (!ok(started))
      return failure(
        "Startup failed. Run docker compose logs --no-color --tail 100 initialize api worker web.",
      );
    savePrivateCopy(cachePath, configuration);
    const values = parseEnv(configuration);
    const address = environment.APP_ADDRESS || values.APP_ADDRESS || ":80";
    const port = environment.HTTP_PORT || values.HTTP_PORT || "8080";
    log(
      `StockCast is running: ${address === ":80" ? `http://localhost:${port}` : `https://${address}`}`,
    );
    log(
      "Keep .env private. Existing accounts retain their current sign-in passwords. Stop with npm run stop; saved records remain.",
    );
    return 0;
  } catch {
    // Do not echo exceptions/configuration: they can contain private URLs or passwords.
    return failure(
      "Startup could not finish. Check access to .env and your private configuration folder, then run npm start again.",
    );
  }
}
