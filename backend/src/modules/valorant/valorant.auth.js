const crypto = require("crypto");
const { env } = require("../../config/env");

const TOKEN_TTL_SECONDS = 300;
const ALLOWED_CLOCK_SKEW_SECONDS = 30;
const b64url = (value) =>
  Buffer.from(JSON.stringify(value)).toString("base64url");

const signServiceToken = ({
  actorUserId,
  operationId,
  now = Date.now(),
  ttlSeconds = TOKEN_TTL_SECONDS,
  kid = env.VALORANT_SERVICE_KEY_ID,
  secret = env.VALORANT_SERVICE_SECRET,
  issuer = env.VALORANT_SERVICE_ISSUER,
  audience = env.VALORANT_SERVICE_AUDIENCE,
}) => {
  const iat = Math.floor(now / 1000);
  const header = b64url({ alg: "HS256", typ: "JWT", kid });
  const payload = b64url({
    iss: issuer,
    aud: audience,
    sub: actorUserId,
    operation_id: operationId,
    iat,
    nbf: iat - ALLOWED_CLOCK_SKEW_SECONDS,
    exp: iat + ttlSeconds,
  });
  const signature = crypto
    .createHmac("sha256", secret)
    .update(`${header}.${payload}`)
    .digest("base64url");
  return `${header}.${payload}.${signature}`;
};

const buildServiceAuthHeaders = ({ actorUserId, operationId, externalKey = null }) => {
  const headers = {
    Authorization: `Bearer ${signServiceToken({ actorUserId, operationId })}`,
    "X-Quest-Operation-Id": operationId,
  };
  if (externalKey) {
    headers["Idempotency-Key"] = externalKey;
  }
  return headers;
};

module.exports = {
  signServiceToken,
  buildServiceAuthHeaders,
  TOKEN_TTL_SECONDS,
};
