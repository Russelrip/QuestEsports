const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const normalizeEmail = (value) => String(value || "").trim().toLowerCase();
const normalizeText = (value) => String(value || "").trim();
const normalizeUsername = (value) => normalizeText(value).toLowerCase();

const isNonEmptyString = (value) => normalizeText(value).length > 0;
const isValidEmail = (value) => EMAIL_REGEX.test(normalizeEmail(value));

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
  isNonEmptyString,
  isValidEmail,
  getSignupFieldErrors,
};
