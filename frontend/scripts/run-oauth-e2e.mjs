import { createServer } from "node:net";
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const frontendDirectory = resolve(fileURLToPath(new URL("..", import.meta.url)));
const backendDirectory = resolve(frontendDirectory, "../backend");
const fixtureScript = resolve(backendDirectory, "scripts/oauth-e2e-fixtures.js");
const databaseUrl = String(process.env.OAUTH_E2E_DATABASE_URL || "").trim();
const directUrl = String(process.env.OAUTH_E2E_DIRECT_URL || "").trim() || databaseUrl;
const sessionCookieName =
  String(process.env.OAUTH_E2E_SESSION_COOKIE_NAME || "").trim() || "quest_test_session";

if (!databaseUrl) {
  console.error(
    "OAuth E2E cannot start. Missing OAUTH_E2E_DATABASE_URL for the dedicated disposable database. " +
      "Generic DATABASE_URL/DIRECT_URL values are not accepted.",
  );
  process.exitCode = 1;
  process.exit();
}

const platformEnvironmentNames = [
  "PATH",
  "SystemRoot",
  "WINDIR",
  "ComSpec",
  "COMSPEC",
  "PATHEXT",
  "TEMP",
  "TMP",
  "TMPDIR",
  "HOME",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
  "ProgramFiles",
  "ProgramFiles(x86)",
  "PROCESSOR_ARCHITECTURE",
  "NUMBER_OF_PROCESSORS",
  "OS",
  "LANG",
  "LC_ALL",
];
const platformEnvironment = Object.fromEntries(
  platformEnvironmentNames
    .filter((name) => process.env[name] !== undefined)
    .map((name) => [name, process.env[name]]),
);
const childEnvironment = (explicit) => ({ ...platformEnvironment, ...explicit });

const getFreePort = () => new Promise((resolvePort, reject) => {
  const server = createServer();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : null;
    server.close((error) => error ? reject(error) : resolvePort(port));
  });
});

const runId = `${Date.now().toString(36)}-${randomBytes(5).toString("hex")}`;
const manifestDirectory = mkdtempSync(join(tmpdir(), "quest-oauth-e2e-"));
const manifestPath = join(manifestDirectory, "manifest.json");
const [apiPort, frontendPort] = await Promise.all([getFreePort(), getFreePort()]);
const apiUrl = `http://localhost:${apiPort}`;
const frontendUrl = `http://localhost:${frontendPort}`;

const children = new Set();
const childStates = new WeakMap();
let cleanupPromise = null;
let requestedExitCode = null;
let terminationRequested = false;
let fixturePrepared = false;

const spawnChild = (command, args, options = {}) => {
  const detached = process.platform !== "win32";
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env,
    detached,
    // npm/npx are Windows command scripts. Keep shell execution limited to
    // those scripts; all other children retain direct argument passing.
    shell: process.platform === "win32" && /\.(?:cmd|bat)$/i.test(command),
    stdio: options.stdio || ["ignore", "pipe", "pipe"],
  });
  const state = {
    detached,
    wrapperExited: false,
    groupConfirmedGone: false,
  };
  childStates.set(child, state);
  children.add(child);
  child.once("exit", () => {
    state.wrapperExited = true;
  });
  child.once("error", () => {
    if (!child.pid) state.wrapperExited = true;
  });
  if (terminationRequested) void stopChild(child).catch(() => undefined);
  return child;
};

const isProcessAlive = (pid, group = false) => {
  if (!pid || pid === process.pid) {
    if (pid === process.pid) throw new Error("Refusing to signal the OAuth E2E runner process group.");
    return false;
  }
  try {
    process.kill(group ? -pid : pid, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    if (error?.code === "EPERM") return true;
    throw error;
  }
};

const stopChild = async (child) => {
  const state = childStates.get(child);
  if (!state || state.groupConfirmedGone) return;
  const pid = child.pid;

  const waitForTermination = (timeoutMs) => new Promise((resolvePromise, rejectPromise) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearInterval(interval);
      clearTimeout(timeout);
      resolvePromise(result);
    };
    const check = () => {
      try {
        const directAlive = process.platform !== "win32"
          ? isProcessAlive(pid)
          : !state.wrapperExited;
        const wrapperAlive = !state.wrapperExited || directAlive;
        const groupAlive = process.platform !== "win32" && state.detached
          ? isProcessAlive(pid, true)
          : false;
        if (!wrapperAlive && !groupAlive) finish(true);
      } catch (error) {
        if (settled) return;
        settled = true;
        clearInterval(interval);
        clearTimeout(timeout);
        rejectPromise(error);
      }
    };
    const interval = setInterval(check, 50);
    const timeout = setTimeout(() => {
      finish(false);
    }, timeoutMs);
    check();
  });

  if (process.platform === "win32") {
    if (pid) {
      spawnSync("taskkill", ["/pid", String(pid), "/t", "/f"], { stdio: "ignore" });
    }
  } else {
    if (!state.detached || !pid || pid === process.pid) {
      throw new Error("Cannot safely terminate a non-detached OAuth E2E child process.");
    }
    try {
      process.kill(-pid, "SIGTERM");
    } catch (error) {
      if (error?.code !== "ESRCH") throw error;
    }
  }
  const exitedAfterTerm = await waitForTermination(5000);
  if (!exitedAfterTerm) {
    if (process.platform !== "win32") {
      try {
        process.kill(-pid, "SIGKILL");
      } catch (error) {
        if (error?.code !== "ESRCH") throw error;
      }
    }
    const exitedAfterKill = await waitForTermination(1000);
    if (!exitedAfterKill) {
      throw new Error("A child process or descendant group remained alive after termination escalation.");
    }
  }

  state.groupConfirmedGone = true;
  children.delete(child);
};

const cleanupChildren = () => {
  if (!cleanupPromise) {
    cleanupPromise = (async () => {
      while (children.size > 0) {
        const activeChildren = [...children];
        await Promise.all(activeChildren.map(stopChild));
      }
    })();
  }
  return cleanupPromise;
};

const handleSignal = (signal) => {
  terminationRequested = true;
  requestedExitCode = signal === "SIGINT" ? 130 : 143;
  void cleanupChildren().catch(() => undefined);
};
process.once("SIGINT", () => handleSignal("SIGINT"));
process.once("SIGTERM", () => handleSignal("SIGTERM"));

const runFixtureCommand = (argumentsList, phase) => {
  const result = spawnSync(process.execPath, [fixtureScript, ...argumentsList], {
    cwd: backendDirectory,
    env: childEnvironment({
      NODE_ENV: "test",
      OAUTH_E2E_DATABASE_URL: databaseUrl,
      OAUTH_E2E_DIRECT_URL: directUrl,
      OAUTH_E2E_RUN_ID: runId,
      SESSION_COOKIE_NAME: sessionCookieName,
      QUEST_DISABLE_DOTENV: "true",
    }),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.error || result.status !== 0) {
    throw new Error(`OAuth E2E fixture ${phase} failed for the dedicated database.`);
  }
  return result;
};

const isManifestString = (value) => typeof value === "string" && value.trim().length > 0;
const manifestUserKeys = ["link", "collisionTarget", "collisionOwner", "safeUnlink", "lastMethod"];

const isValidManifest = (manifest) => {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) return false;
  if (!isManifestString(manifest.runId) || !isManifestString(manifest.sessionCookieName)) return false;
  if (!manifest.users || typeof manifest.users !== "object" || Array.isArray(manifest.users)) return false;
  if (!isManifestString(manifest.collisionProviderUserId) || !isManifestString(manifest.lastMethodCookie)) return false;
  return manifestUserKeys.every((key) => {
    const user = manifest.users[key];
    return user && typeof user === "object" &&
      isManifestString(user.id) && isManifestString(user.email) && isManifestString(user.password);
  });
};

const prepareFixtures = () => {
  runFixtureCommand(["prepare", "--manifest", manifestPath], "prepare");
  // A successful prepare owns generated rows even if this manifest read fails.
  fixturePrepared = true;
  let output;
  try {
    output = readFileSync(manifestPath, "utf8").trim();
  } catch {
    throw new Error("OAuth E2E fixture prepare did not produce a readable manifest for the dedicated database.");
  }
  let manifest;
  try {
    manifest = JSON.parse(output);
  } catch {
    throw new Error("OAuth E2E fixture prepare returned invalid JSON for the dedicated database.");
  }
  if (!isValidManifest(manifest)) {
    throw new Error("OAuth E2E fixture prepare returned an invalid manifest for the dedicated database.");
  }
  return manifest;
};

const cleanupFixtures = () => {
  const result = runFixtureCommand(["cleanup", "--manifest", manifestPath], "cleanup");
  if (result.error || result.status !== 0) {
    throw new Error("OAuth E2E fixture cleanup failed for the dedicated database.");
  }
};

const waitForUrl = async (url, child, label) => {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (child.exitCode !== null || child.signalCode) {
      throw new Error(`${label} exited before readiness.`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The process is still starting.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
  }
  throw new Error(`${label} did not become ready.`);
};

const waitForOutput = (child, pattern, label) => new Promise((resolvePromise, rejectPromise) => {
  let output = "";
  let settled = false;
  const onData = (chunk) => {
    output += chunk.toString();
    if (pattern.test(output)) {
      settled = true;
      child.stdout?.off("data", onData);
      child.stderr?.off("data", onData);
      child.off("exit", onExit);
      resolvePromise(output);
    }
  };
  const onExit = (code, signal) => {
    if (settled) return;
    settled = true;
    child.stdout?.off("data", onData);
    child.stderr?.off("data", onData);
    const result = signal ? `signal ${signal}` : `code ${code}`;
    rejectPromise(new Error(`${label} exited before readiness (${result}).`));
  };
  child.stdout?.on("data", onData);
  child.stderr?.on("data", onData);
  child.once("exit", onExit);
  if (child.exitCode !== null || child.signalCode) onExit(child.exitCode, child.signalCode);
});

const createOAuthTestEnvironment = (manifest) => ({
  OAUTH_E2E_LINK_EMAIL: manifest.users.link.email,
  OAUTH_E2E_LINK_PASSWORD: manifest.users.link.password,
  OAUTH_E2E_COLLISION_EMAIL: manifest.users.collisionTarget.email,
  OAUTH_E2E_COLLISION_PASSWORD: manifest.users.collisionTarget.password,
  OAUTH_E2E_COLLISION_OWNER_EMAIL: manifest.users.collisionOwner.email,
  OAUTH_E2E_COLLISION_OWNER_PASSWORD: manifest.users.collisionOwner.password,
  OAUTH_E2E_COLLISION_PROVIDER_USER_ID: manifest.collisionProviderUserId,
  OAUTH_E2E_LAST_METHOD_COOKIE: manifest.lastMethodCookie,
  OAUTH_E2E_SAFE_UNLINK_EMAIL: manifest.users.safeUnlink.email,
  OAUTH_E2E_SAFE_UNLINK_PASSWORD: manifest.users.safeUnlink.password,
  OAUTH_E2E_SESSION_COOKIE_NAME: manifest.sessionCookieName,
  OAUTH_E2E_RUN_ID: manifest.runId,
});

const runPlaywright = (oauthTestEnvironment) => new Promise((resolvePromise, rejectPromise) => {
  const command = process.platform === "win32" ? "npx.cmd" : "npx";
  const child = spawnChild(command, [
    "playwright",
    "test",
    "--config=playwright.oauth.config.ts",
    ...process.argv.slice(2),
  ], {
    cwd: frontendDirectory,
    env: childEnvironment({
      ...oauthTestEnvironment,
      OAUTH_E2E_API_URL: apiUrl,
      OAUTH_E2E_FRONTEND_URL: frontendUrl,
      CI: "true",
    }),
    stdio: "inherit",
  });
  child.once("error", rejectPromise);
  child.once("exit", (code, signal) => {
    if (signal) rejectPromise(new Error(`Playwright exited with ${signal}.`));
    else resolvePromise(code || 0);
  });
});

let exitCode = 1;
let firstFailure = null;
let manifest = null;

try {
  manifest = prepareFixtures();
  fixturePrepared = true;
  if (terminationRequested) throw new Error("OAuth E2E was interrupted before service startup.");

  const oauthTestEnvironment = createOAuthTestEnvironment(manifest);
  const provider = spawnChild(process.execPath, [resolve(frontendDirectory, "tests/e2e/fake-oauth-provider.mjs")], {
    cwd: frontendDirectory,
    env: childEnvironment({
      OAUTH_E2E_RUN_ID: manifest.runId,
      OAUTH_E2E_API_URL: apiUrl,
      OAUTH_E2E_PROVIDER_PORT: "0",
      OAUTH_E2E_COLLISION_PROVIDER_USER_ID: manifest.collisionProviderUserId,
      OAUTH_E2E_COLLISION_OWNER_EMAIL: manifest.users.collisionOwner.email,
      GOOGLE_CLIENT_ID: "oauth-e2e-google",
      GOOGLE_CLIENT_SECRET: "oauth-e2e-google-secret",
      DISCORD_CLIENT_ID: "oauth-e2e-discord",
      DISCORD_CLIENT_SECRET: "oauth-e2e-discord-secret",
    }),
  });
  const providerOutput = await waitForOutput(
    provider,
    /FAKE_OAUTH_URL=http:\/\/127\.0\.0\.1:\d+/,
    "fake OAuth provider",
  );
  const providerMatch = providerOutput.match(/FAKE_OAUTH_URL=(http:\/\/127\.0\.0\.1:\d+)/);
  if (!providerMatch) throw new Error("Fake OAuth provider did not publish its listening URL.");
  const providerUrl = providerMatch[1];
  await waitForUrl(`${providerUrl}/health`, provider, "fake OAuth provider");

  const backend = spawnChild(process.execPath, ["src/server.js"], {
    cwd: backendDirectory,
    stdio: "ignore",
    env: childEnvironment({
      NODE_ENV: "test",
      // The backend runtime accepts its established names. These values are
      // derived only from the dedicated OAUTH_E2E database inputs above; no
      // generic parent environment values are forwarded.
      DATABASE_URL: databaseUrl,
      DIRECT_URL: directUrl,
      PORT: String(apiPort),
      API_PUBLIC_URL: apiUrl,
      APP_URL: frontendUrl,
      CORS_ORIGIN: frontendUrl,
      REQUIRE_API_ORIGIN: "false",
      JOB_WORKER_ENABLED: "false",
      COMMERCE_MAINTENANCE_ENABLED: "false",
      DATA_HYGIENE_MAINTENANCE_ENABLED: "false",
      CHALLONGE_ENABLED: "false",
      SITE_MAINTENANCE_MODE: "false",
      CACHE_DRIVER: "memory",
      QUEST_DISABLE_DOTENV: "true",
      SESSION_COOKIE_NAME: manifest.sessionCookieName,
      GOOGLE_CLIENT_ID: "oauth-e2e-google",
      GOOGLE_CLIENT_SECRET: "oauth-e2e-google-secret",
      GOOGLE_CALLBACK_URL: `${apiUrl}/api/auth/google/callback`,
      GOOGLE_OAUTH_AUTHORIZE_URL: `${providerUrl}/google/authorize`,
      GOOGLE_OAUTH_TOKEN_URL: `${providerUrl}/google/token`,
      GOOGLE_OAUTH_PROFILE_URL: `${providerUrl}/google/profile`,
      DISCORD_CLIENT_ID: "oauth-e2e-discord",
      DISCORD_CLIENT_SECRET: "oauth-e2e-discord-secret",
      DISCORD_CALLBACK_URL: `${apiUrl}/api/auth/discord/callback`,
      DISCORD_OAUTH_AUTHORIZE_URL: `${providerUrl}/discord/authorize`,
      DISCORD_OAUTH_TOKEN_URL: `${providerUrl}/discord/token`,
      DISCORD_OAUTH_PROFILE_URL: `${providerUrl}/discord/profile`,
    }),
  });
  await waitForUrl(`${apiUrl}/api/health/live`, backend, "backend");

  const frontend = spawnChild(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "dev", "--", "-p", String(frontendPort)], {
    cwd: frontendDirectory,
    stdio: "ignore",
    env: childEnvironment({
      NODE_ENV: "development",
      NEXT_PUBLIC_API_URL: apiUrl,
      NEXT_PUBLIC_SITE_URL: frontendUrl,
      OAUTH_E2E_API_URL: apiUrl,
      OAUTH_E2E_FRONTEND_URL: frontendUrl,
      OAUTH_E2E_RUN_ID: manifest.runId,
      ALLOW_INSECURE_LOOPBACK_URLS: "true",
    }),
  });
  await waitForUrl(`${frontendUrl}/privacy-policy`, frontend, "frontend");

  const playwrightExitCode = await runPlaywright(oauthTestEnvironment);
  exitCode = playwrightExitCode;
  if (playwrightExitCode !== 0) {
    firstFailure = new Error(`Playwright exited with code ${playwrightExitCode}.`);
  }
} catch (error) {
  firstFailure = error instanceof Error ? error : new Error(String(error));
  console.error(firstFailure.message);
  exitCode = requestedExitCode ?? 1;
} finally {
  // Service and Playwright children must be gone before database cleanup.
  let childCleanupFailed = false;
  try {
    await cleanupChildren();
  } catch (error) {
    childCleanupFailed = true;
    console.error(error instanceof Error ? error.message : "OAuth E2E child cleanup failed.");
    if (!firstFailure) {
      firstFailure = error instanceof Error ? error : new Error(String(error));
      exitCode = 1;
    }
  }

  if (!childCleanupFailed && fixturePrepared) {
    try {
      cleanupFixtures();
    } catch (error) {
      console.error(error instanceof Error ? error.message : "OAuth E2E fixture cleanup failed.");
      if (!firstFailure) exitCode = 1;
    }
  }

  try {
    rmSync(manifestDirectory, { recursive: true, force: true, maxRetries: 2 });
  } catch {
    console.error("OAuth E2E could not remove the temporary fixture directory.");
    if (!firstFailure) exitCode = 1;
  }
}

process.exitCode = requestedExitCode ?? exitCode;
