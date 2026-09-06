const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const { loadModuleWithMocks } = require("../helpers/load-module-with-mocks");

const VALORANT_ROOT = process.env.VALORANT_PLATFORM_REPO;
const AUTH_PATH = path.join(__dirname, "../../src/modules/valorant/valorant.auth.js");
const ENV_PATH = path.join(__dirname, "../../src/config/env.js");
const SHARED_SECRET = "e2e-shared-secret";
const serviceEnv = {
  VALORANT_SERVICE_SECRET: SHARED_SECRET,
  VALORANT_SERVICE_KEY_ID: "e2e",
  VALORANT_SERVICE_ISSUER: "quest-esports",
  VALORANT_SERVICE_AUDIENCE: "valorant-platform",
};

const pythonVerifier = String.raw`
import json
import sys
from types import SimpleNamespace

from app.api.routes.health import _service_token_compatibility

headers = json.load(sys.stdin)
settings = SimpleNamespace(
    app_env="production",
    quest_service_shared_secrets="e2e=e2e-shared-secret",
    quest_service_issuer="quest-esports",
    quest_service_audience="valorant-platform",
    service_token_max_skew_seconds=30,
)
accepted = _service_token_compatibility(settings, headers.get("Authorization"))
print("ready" if accepted else "not_ready")
`;

function findPython() {
  const candidates = [
    process.env.PYTHON_BIN,
    VALORANT_ROOT ? path.join(VALORANT_ROOT, ".venv", "bin", "python") : null,
    "python3",
    "python",
  ].filter(Boolean);
  return candidates.find((candidate) =>
    spawnSync(candidate, ["-c", "import sys; sys.exit(0)"], { stdio: "ignore" }).status === 0,
  );
}

const python = findPython();
const skipReason = !VALORANT_ROOT
  ? "missing VALORANT_PLATFORM_REPO"
  : !python
    ? "Python is unavailable"
    : false;

function buildHeaders(overrides = {}) {
  const { module: auth, restore } = loadModuleWithMocks(AUTH_PATH, {
    [ENV_PATH]: { env: { ...serviceEnv, ...overrides } },
  });
  try {
    return auth.buildServiceAuthHeaders({
      actorUserId: "quest-health-contract",
      operationId: "health-contract-operation",
    });
  } finally {
    restore();
  }
}

function verifyAtHealthBoundary(headers) {
  const result = spawnSync(python, ["-c", pythonVerifier], {
    cwd: VALORANT_ROOT,
    env: { ...process.env, PYTHONPATH: VALORANT_ROOT },
    input: JSON.stringify(headers),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

test(
  "Quest buildServiceAuthHeaders crosses the VALORANT health verification boundary",
  { skip: skipReason },
  () => {
    assert.equal(verifyAtHealthBoundary(buildHeaders()), "ready");

    for (const [label, overrides] of [
      ["secret", { VALORANT_SERVICE_SECRET: "wrong-secret" }],
      ["key id", { VALORANT_SERVICE_KEY_ID: "wrong-kid" }],
      ["issuer", { VALORANT_SERVICE_ISSUER: "wrong-issuer" }],
      ["audience", { VALORANT_SERVICE_AUDIENCE: "wrong-audience" }],
    ]) {
      assert.equal(
        verifyAtHealthBoundary(buildHeaders(overrides)),
        "not_ready",
        `${label} mismatch must be rejected by the health boundary`,
      );
    }
  },
);
