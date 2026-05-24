const crypto = require("crypto");
const { env } = require("../config/env");

const ENCRYPTION_ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;

const deriveKey = () => {
  const source =
    env.AUTH_ENCRYPTION_KEY || `${env.DATABASE_URL}:${env.SESSION_COOKIE_NAME}`;

  if (/^[0-9a-f]{64}$/i.test(source)) {
    return Buffer.from(source, "hex");
  }

  return crypto.createHash("sha256").update(source).digest();
};

const encryptSecret = (value) => {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, deriveKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(String(value || ""), "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`;
};

const decryptSecret = (payload) => {
  const [ivHex, authTagHex, encryptedHex] = String(payload || "").split(":");

  if (!ivHex || !authTagHex || !encryptedHex) {
    throw new Error("Invalid encrypted secret payload.");
  }

  const decipher = crypto.createDecipheriv(
    ENCRYPTION_ALGORITHM,
    deriveKey(),
    Buffer.from(ivHex, "hex")
  );
  decipher.setAuthTag(Buffer.from(authTagHex, "hex"));

  return Buffer.concat([
    decipher.update(Buffer.from(encryptedHex, "hex")),
    decipher.final(),
  ]).toString("utf8");
};

module.exports = {
  encryptSecret,
  decryptSecret,
};
