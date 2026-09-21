const FALLBACK_PATH = "/profile";
const URL_BASE = "https://questesports.invalid";
const ALLOWED_PAYHERE_HOSTS = new Set(["sandbox.payhere.lk", "www.payhere.lk"]);
const UNSAFE_PATH_CHARACTER_PATTERN = /[\\\u0000-\u001f\u007f]/;

const getSameOrigin = () => {
  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin;
  }

  return URL_BASE;
};

const normalizePath = (value: string): string | null => {
  const normalized = value.trim();
  if (
    !normalized ||
    !normalized.startsWith("/") ||
    normalized.startsWith("//") ||
    UNSAFE_PATH_CHARACTER_PATTERN.test(normalized)
  ) {
    return null;
  }

  try {
    const parsed = new URL(normalized, getSameOrigin());
    if (
      !["http:", "https:"].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password ||
      parsed.origin !== getSameOrigin()
    ) {
      return null;
    }

    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return null;
  }
};

export function normalizeSameOriginPath(
  value: string | null | undefined,
  fallback: string
): string {
  const safeFallback = normalizePath(fallback) ?? FALLBACK_PATH;
  if (typeof value !== "string") return safeFallback;

  return normalizePath(value) ?? safeFallback;
}

export function isAllowedPayHereActionUrl(value: string): boolean {
  if (typeof value !== "string" || !value.trim()) return false;

  try {
    const parsed = new URL(value.trim());
    return (
      parsed.protocol === "https:" &&
      ALLOWED_PAYHERE_HOSTS.has(parsed.hostname) &&
      !parsed.port &&
      !parsed.username &&
      !parsed.password
    );
  } catch {
    return false;
  }
}
