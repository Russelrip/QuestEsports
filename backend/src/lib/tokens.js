const crypto = require("crypto");

const hashToken = (token) =>
  crypto.createHash("sha256").update(String(token || "")).digest("hex");

const generateRawToken = (size = 32) => crypto.randomBytes(size).toString("hex");

const generateExpiryDate = ({ hours = 0, minutes = 0 }) =>
  new Date(Date.now() + ((hours * 60 + minutes) * 60 * 1000));

const createTokenPair = (expiryOptions) => {
  const rawToken = generateRawToken();

  return {
    rawToken,
    tokenHash: hashToken(rawToken),
    expiresAt: generateExpiryDate(expiryOptions),
  };
};

module.exports = {
  hashToken,
  generateRawToken,
  generateExpiryDate,
  createTokenPair,
};
