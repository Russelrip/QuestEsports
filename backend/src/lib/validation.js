const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const normalizeEmail = (value) => String(value || "").trim().toLowerCase();
const normalizeText = (value) => String(value || "").trim();
const normalizeUsername = (value) => normalizeText(value).toLowerCase();
const normalizeSlug = (value) =>
  normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const isNonEmptyString = (value) => normalizeText(value).length > 0;
const isValidEmail = (value) => EMAIL_REGEX.test(normalizeEmail(value));
const isPasswordWithinBcryptLimit = (value) =>
  Buffer.byteLength(String(value || ""), "utf8") <= 72;
const normalizeInteger = (value) => {
  const parsed = Number.parseInt(String(value || "").trim(), 10);
  return Number.isInteger(parsed) ? parsed : null;
};

const normalizeOptionalUrl = (value) => {
  const normalized = normalizeText(value);

  if (!normalized) {
    return null;
  }

  try {
    const parsed = new URL(normalized);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
};

const SAFE_REDIRECT_ORIGIN = "https://redirect.invalid";
const UNSAFE_REDIRECT_CHARACTER_PATTERN = /[\\\u0000-\u001f\u007f]/;
const ENCODED_PATH_SEPARATOR_PATTERN = /%(?:2f|5c)/i;

const normalizeSafeRedirectPath = (value) => {
  const normalized = normalizeText(value);
  if (
    !normalized ||
    !normalized.startsWith("/") ||
    normalized.startsWith("//") ||
    UNSAFE_REDIRECT_CHARACTER_PATTERN.test(normalized) ||
    ENCODED_PATH_SEPARATOR_PATTERN.test(normalized)
  ) {
    return null;
  }

  try {
    const parsed = new URL(normalized, SAFE_REDIRECT_ORIGIN);
    if (parsed.origin !== SAFE_REDIRECT_ORIGIN) return null;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return null;
  }
};

const getSignupFieldErrors = ({
  firstName,
  lastName,
  email,
  username,
  password,
  confirmPassword,
  terms,
}) => {
  const fieldErrors = {};

  if (!isNonEmptyString(firstName)) {
    fieldErrors.firstName = "First name is required.";
  } else if (normalizeText(firstName).length > 100) {
    fieldErrors.firstName = "First name must be 100 characters or fewer.";
  }

  if (!isNonEmptyString(lastName)) {
    fieldErrors.lastName = "Last name is required.";
  } else if (normalizeText(lastName).length > 100) {
    fieldErrors.lastName = "Last name must be 100 characters or fewer.";
  }

  if (!isValidEmail(email) || normalizeEmail(email).length > 254) {
    fieldErrors.email = "Please enter a valid email address.";
  }

  if (!isNonEmptyString(username)) {
    fieldErrors.username = "Username is required.";
  } else if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(normalizeText(username))) {
    fieldErrors.username = "Username must be 3-32 characters using letters, numbers, dots, dashes, or underscores.";
  }

  if (!isNonEmptyString(password)) {
    fieldErrors.password = "Password is required.";
  } else if (String(password).length < 8) {
    fieldErrors.password = "Password must be at least 8 characters long.";
  } else if (!isPasswordWithinBcryptLimit(password)) {
    fieldErrors.password = "Password must be no more than 72 UTF-8 bytes.";
  }

  if (!isNonEmptyString(confirmPassword)) {
    fieldErrors.confirmPassword = "Please confirm your password.";
  } else if (String(password) !== String(confirmPassword)) {
    fieldErrors.confirmPassword = "Confirm password must match.";
  }

  if (!terms) {
    fieldErrors.terms = "You must agree to the Terms of Service and Privacy Policy.";
  }

  return fieldErrors;
};

module.exports = {
  normalizeEmail,
  normalizeText,
  normalizeUsername,
  normalizeSlug,
  normalizeInteger,
  normalizeOptionalUrl,
  normalizeSafeRedirectPath,
  isNonEmptyString,
  isValidEmail,
  isPasswordWithinBcryptLimit,
  getSignupFieldErrors,
};
