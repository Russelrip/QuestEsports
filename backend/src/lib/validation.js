const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const normalizeEmail = (value) => String(value || "").trim().toLowerCase();
const normalizeText = (value) => String(value || "").trim();
const normalizeUsername = (value) => normalizeText(value).toLowerCase();

const isNonEmptyString = (value) => normalizeText(value).length > 0;
const isValidEmail = (value) => EMAIL_REGEX.test(normalizeEmail(value));

module.exports = {
  normalizeEmail,
  normalizeText,
  normalizeUsername,
  isNonEmptyString,
  isValidEmail,
};
