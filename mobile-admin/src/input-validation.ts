export function requiredTrimmed(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
}

export function positiveNumber(value: string, label: string): string {
  const normalized = requiredTrimmed(value, label);
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${label} must be greater than zero.`);
  return normalized;
}

export function isSessionInvalidResponse(path: string, status: number, data: unknown): boolean {
  if (status === 401) return true;
  if (status !== 403) return false;
  if (path === "/api/mobile/auth/me") return true;

  if (!data || typeof data !== "object") return false;
  const record = data as Record<string, unknown>;
  // Unversioned routes put the code in `details`, /api/v1 routes also in `error`.
  const nested = (key: string) => {
    const value = record[key];
    return value && typeof value === "object" ? (value as Record<string, unknown>).code : undefined;
  };
  const code = String(record.code || record.errorCode || record.reason || nested("details") || nested("error") || "").toLowerCase();
  return ["session_invalid", "session_revoked", "token_invalid", "token_expired", "admin_access_required"].includes(code);
}
