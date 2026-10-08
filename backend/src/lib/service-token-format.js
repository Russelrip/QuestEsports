// A service token is told apart from a session token by its shape alone, so the
// origin check and the session lookup can route it without a database read.
// Session tokens are 96 hex characters; this prefix can never be one of those.
const SERVICE_TOKEN_PREFIX = "qsa_";
const SERVICE_TOKEN_PATTERN = /^qsa_[A-Za-z0-9_-]{64}$/;

const isServiceTokenFormat = (value) => SERVICE_TOKEN_PATTERN.test(String(value || ""));

module.exports = {
  SERVICE_TOKEN_PREFIX,
  SERVICE_TOKEN_PATTERN,
  isServiceTokenFormat,
};
