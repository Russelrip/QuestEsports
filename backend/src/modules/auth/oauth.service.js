const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const { prisma } = require("../../lib/prisma");
const { env } = require("../../config/env");
const { HttpError } = require("../../lib/http-error");
const { logger } = require("../../lib/logger");
const { normalizeEmail, normalizeText, normalizeUsername } = require("../../lib/validation");
const { PUBLIC_USER_SELECT, mapUserForResponse } = require("./auth.service");

const STATE_MAX_AGE_MS = 10 * 60 * 1000;
const OAUTH_RANDOM_PASSWORD_BYTES = 24;
const OAUTH_FLOW_COOKIE_PREFIX = `${env.SESSION_COOKIE_NAME}_oauth_`;

const OAUTH_PROVIDER_CONFIG = {
  google: {
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    callbackUrl: env.GOOGLE_CALLBACK_URL,
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scope: "openid email profile",
  },
  discord: {
    clientId: env.DISCORD_CLIENT_ID,
    clientSecret: env.DISCORD_CLIENT_SECRET,
    callbackUrl: env.DISCORD_CALLBACK_URL,
    authorizeUrl: "https://discord.com/api/oauth2/authorize",
    tokenUrl: "https://discord.com/api/oauth2/token",
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

  try {
    return new URL(normalized).toString();
  } catch {
    throw new HttpError(503, `${label} must be a valid absolute URL.`);
  }
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
  const redirect = normalizeText(value);
  if (!redirect) {
    return "/profile";
  }

  if (redirect.startsWith("/") && !redirect.startsWith("//")) {
    return redirect;
  }

  return "/profile";
};

const createOAuthState = ({ provider, redirectTo, nonce }) =>
  createSignedPayload({
    provider,
    redirectTo: normalizeRedirectPath(redirectTo),
    nonce,
    timestamp: Date.now(),
  });

const createOAuthFlowToken = ({ provider, nonce, codeVerifier }) =>
  createSignedPayload({
    provider,
    nonce,
    codeVerifier,
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
  };
};

const getProviderConfig = (provider) => {
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

  return {
    ...config,
    callbackUrl: ensureAbsoluteUrl(
      config.callbackUrl,
      `${provider} callback URL`
    ),
  };
};

const getOAuthFlowCookieName = (provider) =>
  `${OAUTH_FLOW_COOKIE_PREFIX}${provider}`;

const buildOAuthFlowCookie = ({ provider, flowToken, expiresAt }) => {
  const segments = [
    `${getOAuthFlowCookieName(provider)}=${encodeURIComponent(flowToken)}`,
    "HttpOnly",
    "Path=/api/auth",
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

const getOAuthFlowToken = ({ provider, cookieHeader }) => {
  const cookieName = getOAuthFlowCookieName(provider);

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

const createOAuthAuthorization = ({ provider, redirectTo }) => {
  const config = getProviderConfig(provider);
  const nonce = crypto.randomBytes(18).toString("hex");
  const codeVerifier = toBase64Url(crypto.randomBytes(32));
  const codeChallenge = toBase64Url(
    crypto.createHash("sha256").update(codeVerifier).digest()
  );
  const state = createOAuthState({ provider, redirectTo, nonce });
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

const exchangeCodeForToken = async ({ provider, code, codeVerifier }) => {
  const config = getProviderConfig(provider);
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code,
    code_verifier: codeVerifier,
    grant_type: "authorization_code",
    redirect_uri: config.callbackUrl,
  });

  const response = await fetch(config.tokenUrl, {
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
      data,
    });
    throw new HttpError(502, `Unable to complete ${provider} login.`);
  }

  return data.access_token;
};

const fetchGoogleProfile = async (accessToken) => {
  const response = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
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
  const response = await fetch("https://discord.com/api/users/@me", {
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

  const discordTag =
    data.discriminator && data.discriminator !== "0"
      ? `${data.username}#${data.discriminator}`
      : normalizeText(data.global_name || data.username);

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

    await prisma.oAuthAccount.create({
      data: {
        id: crypto.randomUUID(),
        userId: existingUser.id,
        provider,
        providerUserId: profile.providerUserId,
        email: profile.email,
      },
    });

    return existingUser;
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

  const { redirectTo, codeVerifier } = verifyOAuthState({
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
    user: mapUserForResponse(user),
  };
};

module.exports = {
  buildExpiredOAuthFlowCookie,
  createOAuthAuthorization,
  getOAuthFlowToken,
  handleOAuthCallback,
};
