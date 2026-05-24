const crypto = require("crypto");

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

const normalizeBase32 = (value) =>
  String(value || "")
    .toUpperCase()
    .replace(/=+$/g, "")
    .replace(/[^A-Z2-7]/g, "");

const base32Encode = (buffer) => {
  let bits = 0;
  let value = 0;
  let output = "";

  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;

    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }

  return output;
};

const base32Decode = (value) => {
  const normalized = normalizeBase32(value);
  let bits = 0;
  let current = 0;
  const bytes = [];

  for (const char of normalized) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) {
      continue;
    }

    current = (current << 5) | index;
    bits += 5;

    if (bits >= 8) {
      bytes.push((current >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }

  return Buffer.from(bytes);
};

const generateTotpSecret = (size = 20) => base32Encode(crypto.randomBytes(size));

const generateCounter = (timestamp = Date.now(), stepSeconds = 30) =>
  Math.floor(timestamp / 1000 / stepSeconds);

const hotp = (secret, counter, digits = 6) => {
  const key = base32Decode(secret);
  const counterBuffer = Buffer.alloc(8);

  counterBuffer.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  counterBuffer.writeUInt32BE(counter & 0xffffffff, 4);

  const hmac = crypto.createHmac("sha1", key).update(counterBuffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  return String(code % 10 ** digits).padStart(digits, "0");
};

const generateTotpCode = (secret, options = {}) => {
  const { timestamp = Date.now(), stepSeconds = 30, digits = 6 } = options;
  return hotp(secret, generateCounter(timestamp, stepSeconds), digits);
};

const verifyTotpCode = (secret, code, options = {}) => {
  const {
    timestamp = Date.now(),
    stepSeconds = 30,
    digits = 6,
    window = 1,
  } = options;
  const normalizedCode = String(code || "").replace(/\s+/g, "");
  const counter = generateCounter(timestamp, stepSeconds);

  for (let offset = -window; offset <= window; offset += 1) {
    if (hotp(secret, counter + offset, digits) === normalizedCode) {
      return true;
    }
  }

  return false;
};

const buildOtpAuthUrl = ({ secret, accountName, issuer }) => {
  const url = new URL(
    `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(
      accountName
    )}`
  );

  url.searchParams.set("secret", secret);
  url.searchParams.set("issuer", issuer);
  url.searchParams.set("algorithm", "SHA1");
  url.searchParams.set("digits", "6");
  url.searchParams.set("period", "30");

  return url.toString();
};

module.exports = {
  generateTotpSecret,
  generateTotpCode,
  verifyTotpCode,
  buildOtpAuthUrl,
};
