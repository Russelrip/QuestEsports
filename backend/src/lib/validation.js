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
  }

  if (!isNonEmptyString(lastName)) {
    fieldErrors.lastName = "Last name is required.";
  }

  if (!isValidEmail(email)) {
    fieldErrors.email = "Please enter a valid email address.";
  }

  if (!isNonEmptyString(username)) {
    fieldErrors.username = "Username is required.";
  }

  if (!isNonEmptyString(password)) {
    fieldErrors.password = "Password is required.";
  } else if (String(password).length < 8) {
    fieldErrors.password = "Password must be at least 8 characters long.";
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
  isNonEmptyString,
  isValidEmail,
  getSignupFieldErrors,
};
