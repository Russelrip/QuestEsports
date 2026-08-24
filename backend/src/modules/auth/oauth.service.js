const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const { Prisma } = require("../../generated/prisma");
const { prisma } = require("../../lib/prisma");
const { env } = require("../../config/env");
const { HttpError } = require("../../lib/http-error");
const { logger } = require("../../lib/logger");
const {
  normalizeEmail,
  normalizeSafeRedirectPath,
  normalizeText,
  normalizeUsername,
} = require("../../lib/validation");
const {
  PUBLIC_USER_SELECT,
  getUserLoginMethodState,
  mapUserForResponse,
} = require("./auth.service");

const STATE_MAX_AGE_MS = 10 * 60 * 1000;
const OAUTH_REQUEST_TIMEOUT_MS = 10 * 1000;

const fetchOAuth = async (url, options = {}) => {
  try {
    return await fetch(url, {
      ...options,
      signal: AbortSignal.timeout(OAUTH_REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    if (error?.name === "TimeoutError" || error?.name === "AbortError") {
      throw new HttpError(504, "The identity provider took too long to respond.");
    }
    throw new HttpError(502, "The identity provider could not be reached.");
  }
};
const OAUTH_RANDOM_PASSWORD_BYTES = 24;
const OAUTH_FLOW_COOKIE_PREFIX = `${env.SESSION_COOKIE_NAME}_oauth_`;
const OAUTH_LINK_FLOW_COOKIE_PREFIX = `${env.SESSION_COOKIE_NAME}_oauth_link_`;
const OAUTH_LINK_FLOW = "link";
const OAUTH_TRANSACTION_MAX_RETRIES = 3;
const OAUTH_RETRYABLE_TRANSACTION_ERRORS = new Set([
  "P2002",
  "P2024",
  "P2028",
  "P2034",
  "P2037",
]);

const DEFAULT_OAUTH_ENDPOINTS = {
  google: {
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    profileUrl: "https://openidconnect.googleapis.com/v1/userinfo",
  },
  discord: {
    authorizeUrl: "https://discord.com/api/oauth2/authorize",
    tokenUrl: "https://discord.com/api/oauth2/token",
    profileUrl: "https://discord.com/api/users/@me",
  },
};

const OAUTH_PROVIDER_CONFIG = {
  google: {
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    callbackUrl: env.GOOGLE_CALLBACK_URL,
    authorizeUrl: env.GOOGLE_OAUTH_AUTHORIZE_URL || DEFAULT_OAUTH_ENDPOINTS.google.authorizeUrl,
    tokenUrl: env.GOOGLE_OAUTH_TOKEN_URL || DEFAULT_OAUTH_ENDPOINTS.google.tokenUrl,
    profileUrl: env.GOOGLE_OAUTH_PROFILE_URL || DEFAULT_OAUTH_ENDPOINTS.google.profileUrl,
    scope: "openid email profile",
  },
  discord: {
    clientId: env.DISCORD_CLIENT_ID,
    clientSecret: env.DISCORD_CLIENT_SECRET,
    callbackUrl: env.DISCORD_CALLBACK_URL,
    authorizeUrl: env.DISCORD_OAUTH_AUTHORIZE_URL || DEFAULT_OAUTH_ENDPOINTS.discord.authorizeUrl,
    tokenUrl: env.DISCORD_OAUTH_TOKEN_URL || DEFAULT_OAUTH_ENDPOINTS.discord.tokenUrl,
    profileUrl: env.DISCORD_OAUTH_PROFILE_URL || DEFAULT_OAUTH_ENDPOINTS.discord.profileUrl,
    scope: "identify email",
  },
};

const isMissingOAuthValue = (value) => {
  const normalized = String(value || "").trim();

  if (!normalized) {
    return true;
  }

  return /^your_(google|discord)_client_(id|secret)$/i.test(normalized);
};

const ensureAbsoluteUrl = (value, label) => {
  const normalized = String(value || "").trim();

  if (!normalized) {
    throw new HttpError(503, `${label} is not configured.`);
  }

  let parsed;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new HttpError(503, `${label} must be a valid absolute URL.`);
  }
  if (env.NODE_ENV === "production" && parsed.protocol !== "https:") {
    throw new HttpError(503, `${label} must use HTTPS in production.`);
  }
  return parsed.toString();
};

const getStateSigningKey = () => {
  const source = env.AUTH_ENCRYPTION_KEY || `${env.SESSION_COOKIE_NAME}:${env.DATABASE_URL}`;
  return crypto.createHash("sha256").update(source).digest();
};

const toBase64Url = (value) =>
  Buffer.from(value)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");

const fromBase64Url = (value) => {
  const normalized = String(value || "")
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  return Buffer.from(`${normalized}${padding}`, "base64").toString("utf8");
};

const signState = (payload) =>
  crypto
    .createHmac("sha256", getStateSigningKey())
    .update(payload)
    .digest("hex");

const parseSignedPayload = (value, invalidMessage) => {
  const [payloadPart, signature] = String(value || "").split(".");
  if (!payloadPart || !signature) {
    throw new HttpError(400, invalidMessage);
  }

  const payload = fromBase64Url(payloadPart);
  const expectedSignature = signState(payload);
  const suppliedSignature = Buffer.from(signature);
  const expectedSignatureBuffer = Buffer.from(expectedSignature);

  if (
    suppliedSignature.length !== expectedSignatureBuffer.length ||
    !crypto.timingSafeEqual(suppliedSignature, expectedSignatureBuffer)
  ) {
    throw new HttpError(400, invalidMessage);
  }

  try {
    return JSON.parse(payload);
  } catch {
    throw new HttpError(400, invalidMessage);
  }
};

const createSignedPayload = (payload) => {
  const serialized = JSON.stringify(payload);
  return `${toBase64Url(serialized)}.${signState(serialized)}`;
};

const normalizeRedirectPath = (value) => {
  return normalizeSafeRedirectPath(value) || "/profile";
};

const createOAuthState = ({
  provider,
  redirectTo,
  nonce,
  mobileCodeChallenge,
  flow,
  userId,
}) =>
  createSignedPayload({
    provider,
    redirectTo: normalizeRedirectPath(redirectTo),
    nonce,
    mobileCodeChallenge: mobileCodeChallenge || null,
    ...(flow ? { flow, userId } : {}),
    timestamp: Date.now(),
  });

const createOAuthFlowToken = ({ provider, nonce, codeVerifier, flow, userId }) =>
  createSignedPayload({
    provider,
    nonce,
    codeVerifier,
    ...(flow ? { flow, userId } : {}),
    timestamp: Date.now(),
  });

const isExpired = (timestamp) =>
  !timestamp || Date.now() - timestamp > STATE_MAX_AGE_MS;

const verifyOAuthState = ({ state, provider, flowToken }) => {
  const parsedState = parseSignedPayload(state, "Invalid OAuth state.");
  const parsedFlow = parseSignedPayload(flowToken, "Invalid OAuth state.");

  if (parsedState.provider !== provider || parsedFlow.provider !== provider) {
    throw new HttpError(400, "OAuth provider mismatch.");
  }

  if (parsedState.flow || parsedFlow.flow) {
    throw new HttpError(400, "Invalid OAuth state.");
  }

  if (isExpired(parsedState.timestamp) || isExpired(parsedFlow.timestamp)) {
    throw new HttpError(400, "OAuth state has expired.");
  }

  if (
    !parsedState.nonce ||
    !parsedFlow.nonce ||
    !parsedFlow.codeVerifier ||
    parsedState.nonce !== parsedFlow.nonce
  ) {
    throw new HttpError(400, "Invalid OAuth state.");
  }

  return {
    redirectTo: normalizeRedirectPath(parsedState.redirectTo),
    codeVerifier: parsedFlow.codeVerifier,
    mobileCodeChallenge: parsedState.mobileCodeChallenge || null,
  };
};

const verifyOAuthLinkState = ({ state, provider, flowToken, userId }) => {
  const parsedState = parseSignedPayload(state, "Invalid OAuth link state.");
  const parsedFlow = parseSignedPayload(flowToken, "Invalid OAuth link state.");
  const normalizedUserId = String(userId || "").trim();

  if (!normalizedUserId) {
    throw new HttpError(401, "Authentication is required to link an OAuth account.");
  }

  if (
    parsedState.provider !== provider ||
    parsedFlow.provider !== provider ||
    parsedState.flow !== OAUTH_LINK_FLOW ||
    parsedFlow.flow !== OAUTH_LINK_FLOW
  ) {
    throw new HttpError(400, "Invalid OAuth link state.");
  }

  if (
    parsedState.userId !== normalizedUserId ||
    parsedFlow.userId !== normalizedUserId
  ) {
    throw new HttpError(403, "This OAuth link belongs to a different account.");
  }

  if (isExpired(parsedState.timestamp) || isExpired(parsedFlow.timestamp)) {
    throw new HttpError(400, "OAuth link state has expired.");
  }

  if (
    !parsedState.nonce ||
    !parsedFlow.nonce ||
    !parsedFlow.codeVerifier ||
    parsedState.nonce !== parsedFlow.nonce
  ) {
    throw new HttpError(400, "Invalid OAuth link state.");
  }

  return {
    redirectTo: normalizeRedirectPath(parsedState.redirectTo),
    codeVerifier: parsedFlow.codeVerifier,
    nonce: parsedState.nonce,
  };
};

const getLinkCallbackUrl = (callbackUrl, provider) => {
  const parsed = new URL(callbackUrl);
  parsed.pathname = `/api/v1/auth/oauth/${provider}/link/callback`;
  parsed.search = "";
  parsed.hash = "";
  return ensureAbsoluteUrl(parsed.toString(), `${provider} link callback URL`);
};

const getProviderConfig = (provider, { flow = "login" } = {}) => {
  const config = OAUTH_PROVIDER_CONFIG[provider];
  if (!config) {
    throw new HttpError(400, "Unsupported OAuth provider.");
  }

  if (
    isMissingOAuthValue(config.clientId) ||
    isMissingOAuthValue(config.clientSecret) ||
    !config.callbackUrl
  ) {
    throw new HttpError(503, `${provider} login is not configured.`);
  }

  const callbackUrl = ensureAbsoluteUrl(
    config.callbackUrl,
    `${provider} callback URL`
  );
  const authorizeUrl = ensureAbsoluteUrl(
    config.authorizeUrl,
    `${provider} authorization URL`
  );
  const tokenUrl = ensureAbsoluteUrl(config.tokenUrl, `${provider} token URL`);
  const profileUrl = ensureAbsoluteUrl(
    config.profileUrl,
    `${provider} profile URL`
  );

  return {
    ...config,
    authorizeUrl,
    tokenUrl,
    profileUrl,
    callbackUrl:
      flow === OAUTH_LINK_FLOW
        ? getLinkCallbackUrl(callbackUrl, provider)
        : callbackUrl,
  };
};

const getOAuthFlowCookieName = (provider, flow = "login") =>
  `${flow === OAUTH_LINK_FLOW ? OAUTH_LINK_FLOW_COOKIE_PREFIX : OAUTH_FLOW_COOKIE_PREFIX}${provider}`;

const buildOAuthFlowCookie = ({ provider, flowToken, expiresAt, flow = "login" }) => {
  const segments = [
    `${getOAuthFlowCookieName(provider, flow)}=${encodeURIComponent(flowToken)}`,
    "HttpOnly",
    `Path=${flow === OAUTH_LINK_FLOW ? "/api/v1/auth" : "/api/auth"}`,
    "SameSite=Lax",
    `Expires=${new Date(expiresAt).toUTCString()}`,
  ];

  if (env.NODE_ENV === "production") {
    segments.push("Secure");
  }

  return segments.join("; ");
};

const buildExpiredOAuthFlowCookie = (provider) =>
  buildOAuthFlowCookie({
    provider,
    flowToken: "",
    expiresAt: new Date(0),
  });

const buildExpiredOAuthLinkFlowCookie = (provider) =>
  buildOAuthFlowCookie({
    provider,
    flow: OAUTH_LINK_FLOW,
    flowToken: "",
    expiresAt: new Date(0),
  });

const getOAuthFlowToken = ({
  provider,
  cookieHeader,
  flow = "login",
  link = false,
}) => {
  const resolvedFlow = link ? OAUTH_LINK_FLOW : flow;
  const cookieName = getOAuthFlowCookieName(provider, resolvedFlow);

  for (const part of String(cookieHeader || "").split(";")) {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (rawName === cookieName) {
      try {
        return decodeURIComponent(rawValue.join("=") || "");
      } catch {
        return "";
      }
    }
  }

  return "";
};

const getOAuthLinkFlowToken = ({ provider, cookieHeader }) =>
  getOAuthFlowToken({
    provider,
    cookieHeader,
    flow: OAUTH_LINK_FLOW,
  });

const createOAuthAuthorization = ({ provider, redirectTo, mobileCodeChallenge }) => {
  const config = getProviderConfig(provider);
  const nonce = crypto.randomBytes(18).toString("hex");
  const codeVerifier = toBase64Url(crypto.randomBytes(32));
  const codeChallenge = toBase64Url(
    crypto.createHash("sha256").update(codeVerifier).digest()
  );
  if (
    mobileCodeChallenge &&
    !/^[A-Za-z0-9_-]{43,128}$/.test(mobileCodeChallenge)
  ) {
    throw new HttpError(400, "Invalid mobile OAuth code challenge.");
  }
  const state = createOAuthState({ provider, redirectTo, nonce, mobileCodeChallenge });
  const flowToken = createOAuthFlowToken({ provider, nonce, codeVerifier });
  const url = new URL(config.authorizeUrl);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.callbackUrl);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", config.scope);
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");

  if (provider === "discord") {
    url.searchParams.set("prompt", "consent");
  }

  return {
    authorizationUrl: url.toString(),
    flowCookie: buildOAuthFlowCookie({
      provider,
      flowToken,
      expiresAt: new Date(Date.now() + STATE_MAX_AGE_MS),
    }),
  };
};

const createOAuthLinkAuthorization = async ({ provider, userId, redirectTo }) => {
  const normalizedUserId = String(userId || "").trim();
  if (!normalizedUserId) {
    throw new HttpError(401, "Authentication is required to link an OAuth account.");
  }

  const config = getProviderConfig(provider, { flow: OAUTH_LINK_FLOW });
  const nonce = crypto.randomBytes(18).toString("hex");
  const expiresAt = new Date(Date.now() + STATE_MAX_AGE_MS);
  const codeVerifier = toBase64Url(crypto.randomBytes(32));
  const codeChallenge = toBase64Url(
    crypto.createHash("sha256").update(codeVerifier).digest()
  );
  const state = createOAuthState({
    provider,
    redirectTo,
    nonce,
    flow: OAUTH_LINK_FLOW,
    userId: normalizedUserId,
  });
  const flowToken = createOAuthFlowToken({
    provider,
    nonce,
    codeVerifier,
    flow: OAUTH_LINK_FLOW,
    userId: normalizedUserId,
  });
  const url = new URL(config.authorizeUrl);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.callbackUrl);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", config.scope);
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");

  if (provider === "discord") {
    url.searchParams.set("prompt", "consent");
  }

  await prisma.oAuthLinkNonce.create({
    data: {
      id: crypto.randomUUID(),
      nonce,
      userId: normalizedUserId,
      provider,
      expiresAt,
    },
  });

  return {
    authorizationUrl: url.toString(),
    flowCookie: buildOAuthFlowCookie({
      provider,
      flowToken,
      expiresAt,
      flow: OAUTH_LINK_FLOW,
    }),
  };
};

const assertSupportedOAuthProvider = (provider) => {
  if (!OAUTH_PROVIDER_CONFIG[provider]) {
    throw new HttpError(400, "Unsupported OAuth provider.");
  }
};

const exchangeCodeForToken = async ({
  provider,
  code,
  codeVerifier,
  flow = "login",
}) => {
  const config = getProviderConfig(provider, { flow });
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code,
    code_verifier: codeVerifier,
    grant_type: "authorization_code",
    redirect_uri: config.callbackUrl,
  });

  const response = await fetchOAuth(config.tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  const data = await response.json();
  if (!response.ok || !data.access_token) {
    logger.error("OAuth token exchange failed.", {
      provider,
      status: response.status,
    });
    throw new HttpError(502, `Unable to complete ${provider} login.`);
  }

  return data.access_token;
};

const fetchGoogleProfile = async (accessToken) => {
  const response = await fetchOAuth(getProviderConfig("google").profileUrl, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const data = await response.json();
  if (!response.ok || !data.sub || !data.email) {
    throw new HttpError(502, "Unable to load your Google account details.");
  }

  return {
    providerUserId: String(data.sub),
    email: normalizeEmail(data.email),
    firstName: normalizeText(data.given_name) || "Google",
    lastName: normalizeText(data.family_name) || "User",
    emailVerified: Boolean(data.email_verified),
  };
};

const fetchDiscordProfile = async (accessToken) => {
  const response = await fetchOAuth(getProviderConfig("discord").profileUrl, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const data = await response.json();
  if (!response.ok || !data.id) {
    throw new HttpError(502, "Unable to load your Discord account details.");
  }

  const email = normalizeEmail(data.email);
  if (!email) {
    throw new HttpError(
      400,
      "Your Discord account must have a verified email address to sign in."
    );
  }

  // The tag exists so captains and staff can reach a player on Discord, so it
  // must be the unique handle they can search or DM. `global_name` is only a
  // display name: it is not unique, it cannot be looked up, and the player can
  // change it at any time. Legacy accounts that never migrated still carry a
  // real discriminator, where the searchable handle is `username#1234`.
  const discordTag =
    data.discriminator && data.discriminator !== "0"
      ? `${data.username}#${data.discriminator}`
      : normalizeText(data.username);

  return {
    providerUserId: String(data.id),
    email,
    firstName: normalizeText(data.global_name || data.username) || "Discord",
    lastName: "User",
    emailVerified: Boolean(data.verified),
    discordTag: discordTag || null,
  };
};

const fetchProviderProfile = async ({ provider, accessToken }) => {
  if (provider === "google") {
    return fetchGoogleProfile(accessToken);
  }

  if (provider === "discord") {
    return fetchDiscordProfile(accessToken);
  }

  throw new HttpError(400, "Unsupported OAuth provider.");
};

const generateUsernameBase = ({ firstName, lastName, email, provider }) => {
  const fromNames = normalizeUsername(`${firstName}${lastName}`.replace(/\s+/g, ""));
  if (fromNames) {
    return fromNames.slice(0, 20);
  }

  const emailBase = normalizeUsername(String(email || "").split("@")[0]);
  if (emailBase) {
    return emailBase.slice(0, 20);
  }

  return `${provider}${crypto.randomBytes(3).toString("hex")}`;
};

const ensureUniqueUsername = async (baseUsername) => {
  let candidate = baseUsername || `player${crypto.randomBytes(3).toString("hex")}`;
  let suffix = 1;

  for (;;) {
    const existing = await prisma.user.findUnique({
      where: {
        usernameNormalized: normalizeUsername(candidate),
      },
      select: { id: true },
    });

    if (!existing) {
      return {
        username: candidate,
        usernameNormalized: normalizeUsername(candidate),
      };
    }

    candidate = `${baseUsername}${suffix}`;
    suffix += 1;
  }
};

const findOrCreateOAuthUser = async ({ provider, profile }) => {
  const existingAccount = await prisma.oAuthAccount.findUnique({
    where: {
      provider_providerUserId: {
        provider,
        providerUserId: profile.providerUserId,
      },
    },
    include: {
      user: {
        select: PUBLIC_USER_SELECT,
      },
    },
  });

  if (existingAccount) {
    // Signing in through an already-linked Discord account is the other place
    // the tag can be learned. Links made before the tag was recorded — or
    // Discord names changed since — would otherwise leave the profile blank or
    // stale for as long as the connection lasts.
    if (
      provider === "discord" &&
      profile.discordTag &&
      existingAccount.user.discordTag !== profile.discordTag
    ) {
      return prisma.user.update({
        where: { id: existingAccount.userId },
        data: { discordTag: profile.discordTag },
        select: PUBLIC_USER_SELECT,
      });
    }

    return existingAccount.user;
  }

  const existingUser = await prisma.user.findUnique({
    where: {
      emailNormalized: profile.email,
    },
    select: {
      ...PUBLIC_USER_SELECT,
      id: true,
    },
  });

  if (existingUser) {
    if (!profile.emailVerified) {
      throw new HttpError(
        403,
        "This provider account cannot be used to sign in until its email address is verified."
      );
    }

    // Auto-linking at sign-in is a Discord connection like any other, so it
    // owes the profile the same verified tag — written alongside the account
    // row so the two never disagree.
    await prisma.$transaction(async (tx) => {
      await tx.oAuthAccount.create({
        data: {
          id: crypto.randomUUID(),
          userId: existingUser.id,
          provider,
          providerUserId: profile.providerUserId,
          email: profile.email,
        },
      });

      if (provider === "discord" && profile.discordTag) {
        await tx.user.update({
          where: { id: existingUser.id },
          data: { discordTag: profile.discordTag },
        });
      }
    });

    return provider === "discord" && profile.discordTag
      ? { ...existingUser, discordTag: profile.discordTag }
      : existingUser;
  }

  const { username, usernameNormalized } = await ensureUniqueUsername(
    generateUsernameBase({
      firstName: profile.firstName,
      lastName: profile.lastName,
      email: profile.email,
      provider,
    })
  );

  const passwordHash = await bcrypt.hash(
    crypto.randomBytes(OAUTH_RANDOM_PASSWORD_BYTES).toString("hex"),
    10
  );

  const user = await prisma.$transaction(async (tx) => {
    const createdUser = await tx.user.create({
      data: {
        id: crypto.randomUUID(),
        firstName: profile.firstName,
        lastName: profile.lastName,
        email: profile.email,
        emailNormalized: profile.email,
        username,
        usernameNormalized,
        passwordHash,
        role: "user",
        discordTag: profile.discordTag || null,
        emailVerified: Boolean(profile.emailVerified),
        emailVerifiedAt: profile.emailVerified ? new Date() : null,
      },
      select: PUBLIC_USER_SELECT,
    });

    await tx.oAuthAccount.create({
      data: {
        id: crypto.randomUUID(),
        userId: createdUser.id,
        provider,
        providerUserId: profile.providerUserId,
        email: profile.email,
      },
    });

    return createdUser;
  });

  return user;
};

const handleOAuthCallback = async ({ provider, code, state, flowToken }) => {
  if (!code) {
    throw new HttpError(400, "OAuth code is missing.");
  }

  const { redirectTo, codeVerifier, mobileCodeChallenge } = verifyOAuthState({
    state,
    provider,
    flowToken,
  });
  const accessToken = await exchangeCodeForToken({
    provider,
    code,
    codeVerifier,
  });
  const profile = await fetchProviderProfile({ provider, accessToken });
  const user = await findOrCreateOAuthUser({ provider, profile });

  return {
    redirectTo,
    mobileCodeChallenge,
    user: mapUserForResponse(user),
  };
};

const createOAuthConflictError = () => {
  const error = new HttpError(
    409,
    "That OAuth account is already linked to another user."
  );
  error.code = "OAUTH_ACCOUNT_CONFLICT";
  return error;
};

const createOAuthLastLoginMethodError = () => {
  const error = new HttpError(
    400,
    "You must keep a verified password or another linked OAuth provider."
  );
  error.code = "OAUTH_LAST_LOGIN_METHOD";
  return error;
};

const createOAuthProviderNotLinkedError = () => {
  const error = new HttpError(404, "That OAuth provider is not linked.");
  error.code = "OAUTH_PROVIDER_NOT_LINKED";
  return error;
};

const claimOAuthLinkNonce = async ({ nonce, userId, provider }) => {
  const consumedAt = new Date();
  let claimed;
  try {
    claimed = await prisma.oAuthLinkNonce.updateMany({
      where: {
        nonce,
        userId,
        provider,
        consumedAt: null,
        expiresAt: { gt: consumedAt },
      },
      data: { consumedAt },
    });
  } catch (error) {
    logger.error("OAuth link nonce claim failed.", { provider, userId, error });
    throw new HttpError(503, "Unable to verify the OAuth link. Please try again.");
  }

  if (claimed.count !== 1) {
    throw new HttpError(400, "This OAuth link has expired or was already used.");
  }
};

const runOAuthSerializable = async (work) => {
  for (let attempt = 1; attempt <= OAUTH_TRANSACTION_MAX_RETRIES; attempt += 1) {
    try {
      return await prisma.$transaction(work, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      if (
        !OAUTH_RETRYABLE_TRANSACTION_ERRORS.has(error?.code) ||
        attempt === OAUTH_TRANSACTION_MAX_RETRIES
      ) {
        throw error;
      }
    }
  }

  throw new Error("OAuth transaction retry limit was exhausted.");
};

const listLinkedOAuthProviders = async (userId) => {
  const normalizedUserId = String(userId || "").trim();
  if (!normalizedUserId) {
    throw new HttpError(401, "Authentication is required.");
  }

  const accounts = await prisma.oAuthAccount.findMany({
    where: { userId: normalizedUserId },
    select: { provider: true },
  });
  const linkedProviders = new Set(accounts.map((account) => account.provider));

  return Object.keys(OAUTH_PROVIDER_CONFIG).map((provider) => ({
    provider,
    linked: linkedProviders.has(provider),
  }));
};

const handleOAuthLinkCallback = async ({
  provider,
  code,
  state,
  flowToken,
  userId,
}) => {
  if (!code) {
    throw new HttpError(400, "OAuth code is missing.");
  }

  const normalizedUserId = String(userId || "").trim();

  const { redirectTo, codeVerifier, nonce } = verifyOAuthLinkState({
    state,
    provider,
    flowToken,
    userId: normalizedUserId,
  });
  await claimOAuthLinkNonce({
    nonce,
    userId: normalizedUserId,
    provider,
  });

  const accessToken = await exchangeCodeForToken({
    provider,
    code,
    codeVerifier,
    flow: OAUTH_LINK_FLOW,
  });
  const profile = await fetchProviderProfile({ provider, accessToken });
  const existingAccount = await prisma.oAuthAccount.findUnique({
    where: {
      provider_providerUserId: {
        provider,
        providerUserId: profile.providerUserId,
      },
    },
    select: { userId: true },
  });

  if (existingAccount && existingAccount.userId !== normalizedUserId) {
    throw createOAuthConflictError();
  }

  if (!existingAccount) {
    try {
      await prisma.$transaction(async (tx) => {
        await tx.oAuthAccount.create({
          data: {
            id: crypto.randomUUID(),
            userId: normalizedUserId,
            provider,
            providerUserId: profile.providerUserId,
            email: profile.email,
          },
        });

        // The Discord tag is display data, and the connection is the only place
        // it can come from honestly. Before this, linking left the profile's
        // Discord field empty and the user was expected to type it themselves —
        // which meant it could say anything at all. Same transaction as the
        // link, so the two never disagree.
        if (provider === "discord" && profile.discordTag) {
          await tx.user.update({
            where: { id: normalizedUserId },
            data: { discordTag: profile.discordTag },
          });
        }
      });
    } catch (error) {
      if (error?.code === "P2002") {
        throw createOAuthConflictError();
      }
      throw error;
    }
  } else if (provider === "discord" && profile.discordTag) {
    // The connection already belongs to this user, so there is no row to
    // create — but a link made before the tag was recorded still has an empty
    // profile field, and skipping the write here left it empty for good.
    await prisma.user.update({
      where: { id: normalizedUserId },
      data: { discordTag: profile.discordTag },
    });
  }

  return {
    redirectTo,
    providers: await listLinkedOAuthProviders(normalizedUserId),
  };
};

const unlinkOAuthProvider = async ({ userId, provider }) => {
  const normalizedUserId = String(userId || "").trim();
  if (!normalizedUserId) {
    throw new HttpError(401, "Authentication is required.");
  }
  assertSupportedOAuthProvider(provider);

  await runOAuthSerializable(async (tx) => {
    const loginMethodState = await getUserLoginMethodState({
      userId: normalizedUserId,
      tx,
    });
    if (!loginMethodState) {
      throw new HttpError(404, "User not found.");
    }

    const linkedAccount = await tx.oAuthAccount.findFirst({
      where: { userId: normalizedUserId, provider },
      select: { id: true },
    });
    if (!linkedAccount) {
      throw createOAuthProviderNotLinkedError();
    }

    const [oauthCount, providerCount] = await Promise.all([
      tx.oAuthAccount.count({ where: { userId: normalizedUserId } }),
      tx.oAuthAccount.count({ where: { userId: normalizedUserId, provider } }),
    ]);
    const remainingOAuthCount = oauthCount - providerCount;
    if (!loginMethodState.hasVerifiedPassword && remainingOAuthCount === 0) {
      throw createOAuthLastLoginMethodError();
    }

    await tx.oAuthAccount.deleteMany({
      where: { userId: normalizedUserId, provider },
    });

    // A Discord tag outlives nothing once the connection is gone: it was only
    // ever true because the link vouched for it, and keeping it would leave a
    // stale handle that looks verified but is not.
    if (provider === "discord") {
      await tx.user.update({
        where: { id: normalizedUserId },
        data: { discordTag: null },
      });
    }
  });

  return listLinkedOAuthProviders(normalizedUserId);
};

module.exports = {
  buildExpiredOAuthFlowCookie,
  buildExpiredOAuthLinkFlowCookie,
  createOAuthAuthorization,
  createOAuthLinkAuthorization,
  getOAuthFlowToken,
  getOAuthLinkFlowToken,
  handleOAuthCallback,
  handleOAuthLinkCallback,
  listLinkedOAuthProviders,
  unlinkOAuthProvider,
};
