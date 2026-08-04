const SAFE_REDIRECT_ORIGIN = "https://redirect.invalid";
const UNSAFE_REDIRECT_CHARACTER_PATTERN = /[\\\u0000-\u001f\u007f]/;
const ENCODED_PATH_SEPARATOR_PATTERN = /%(?:2f|5c)/i;

export function normalizeSafeRedirectPath(value: string | null | undefined): string | null {
  const normalized = String(value || "").trim();
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
}
