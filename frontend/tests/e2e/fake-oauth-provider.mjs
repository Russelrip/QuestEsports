import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";

const port = Number(process.env.OAUTH_E2E_PROVIDER_PORT || 0);
const runId = process.env.OAUTH_E2E_RUN_ID || "local";
const apiOrigin = String(process.env.OAUTH_E2E_API_URL || "").replace(/\/$/, "");
const collisionProviderUserId = process.env.OAUTH_E2E_COLLISION_PROVIDER_USER_ID;
const collisionOwnerEmail = process.env.OAUTH_E2E_COLLISION_OWNER_EMAIL;

const providers = {
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || "oauth-e2e-google",
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || "oauth-e2e-google-secret",
    callback: `${apiOrigin}/api/v1/auth/oauth/google/link/callback`,
    scope: "openid email profile",
  },
  discord: {
    clientId: process.env.DISCORD_CLIENT_ID || "oauth-e2e-discord",
    clientSecret: process.env.DISCORD_CLIENT_SECRET || "oauth-e2e-discord-secret",
    callback: `${apiOrigin}/api/v1/auth/oauth/discord/link/callback`,
    scope: "identify email",
  },
};

const authorizationCodes = new Map();
const accessTokens = new Map();

const send = (response, status, payload) => {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(payload));
};

const hash = (value) => createHash("sha256").update(value).digest("hex");

const getProfile = (provider) => {
  if (provider === "discord") {
    return {
      sub: collisionProviderUserId,
      id: collisionProviderUserId,
      email: collisionOwnerEmail,
      username: "collision-owner",
      global_name: "Collision Owner",
      verified: true,
    };
  }

  const identity = hash(`${runId}|${provider}`).slice(0, 24);
  return {
    sub: `oauth-e2e-${runId}-${identity}`,
    email: `oauth-e2e-${runId}-${identity}@example.test`,
    given_name: "OAuth",
    family_name: "E2E",
    email_verified: true,
  };
};

const parseProvider = (pathname) => {
  const match = pathname.match(/^\/(google|discord)\/(authorize|token|profile)$/);
  return match ? { provider: match[1], action: match[2] } : null;
};

const handleAuthorize = (request, response, providerName, url) => {
  const provider = providers[providerName];
  const params = url.searchParams;
  const redirectUri = params.get("redirect_uri");
  const state = params.get("state");
  const codeChallenge = params.get("code_challenge");

  if (
    params.get("client_id") !== provider.clientId ||
    params.get("response_type") !== "code" ||
    redirectUri !== provider.callback ||
    !state ||
    state.length < 16 ||
    !/^[A-Za-z0-9_-]+\.[a-f0-9]{64}$/.test(state) ||
    !codeChallenge ||
    !/^[A-Za-z0-9_-]{43,128}$/.test(codeChallenge) ||
    params.get("code_challenge_method") !== "S256" ||
    params.get("scope") !== provider.scope ||
    (providerName === "discord" && params.get("prompt") !== "consent")
  ) {
    send(response, 400, { error: "invalid_authorization_request" });
    return;
  }

  const code = `${providerName}-${randomBytes(18).toString("hex")}`;
  authorizationCodes.set(code, {
    provider: providerName,
    clientId: provider.clientId,
    clientSecret: provider.clientSecret,
    redirectUri,
    codeChallenge,
    state,
    profile: getProfile(providerName),
  });

  const callback = new URL(redirectUri);
  callback.searchParams.set("code", code);
  callback.searchParams.set("state", state);
  response.writeHead(302, { location: callback.toString() });
  response.end();
};

const readBody = async (request) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
};

const handleToken = async (request, response, providerName, params) => {
  const provider = providers[providerName];
  const record = authorizationCodes.get(params.get("code"));
  const verifier = params.get("code_verifier") || "";
  const challenge = createHash("sha256").update(verifier).digest("base64url");

  if (
    !record ||
    record.provider !== providerName ||
    params.get("client_id") !== provider.clientId ||
    params.get("client_secret") !== provider.clientSecret ||
    params.get("grant_type") !== "authorization_code" ||
    params.get("redirect_uri") !== record.redirectUri ||
    challenge !== record.codeChallenge
  ) {
    send(response, 400, { error: "invalid_grant" });
    return;
  }

  authorizationCodes.delete(params.get("code"));
  const accessToken = `${providerName}-access-${randomBytes(24).toString("hex")}`;
  accessTokens.set(accessToken, record);
  send(response, 200, { access_token: accessToken, token_type: "Bearer" });
};

const handleProfile = (request, response, providerName) => {
  const authorization = String(request.headers.authorization || "");
  const accessToken = authorization.replace(/^Bearer\s+/i, "");
  const record = accessTokens.get(accessToken);
  if (!record || record.provider !== providerName) {
    send(response, 401, { error: "invalid_token" });
    return;
  }
  send(response, 200, record.profile);
};

const server = createServer(async (request, response) => {
  const url = new URL(request.url || "/", "http://127.0.0.1");
  if (request.method === "GET" && url.pathname === "/health") {
    send(response, 200, { ok: true });
    return;
  }

  const parsed = parseProvider(url.pathname);
  if (!parsed) {
    send(response, 404, { error: "not_found" });
    return;
  }

  if (parsed.action === "authorize" && request.method === "GET") {
    handleAuthorize(request, response, parsed.provider, url);
    return;
  }
  if (parsed.action === "token" && request.method === "POST") {
    await handleToken(request, response, parsed.provider, await readBody(request));
    return;
  }
  if (parsed.action === "profile" && request.method === "GET") {
    handleProfile(request, response, parsed.provider);
    return;
  }
  send(response, 405, { error: "method_not_allowed" });
});

server.listen(port, "127.0.0.1", () => {
  const address = server.address();
  console.log(`FAKE_OAUTH_URL=http://127.0.0.1:${address.port}`);
});

const shutdown = () => server.close(() => process.exit(0));
process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
