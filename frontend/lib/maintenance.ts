export const DEFAULT_MAINTENANCE_MESSAGE =
  "We’re carrying out scheduled maintenance. Please try again shortly.";
const DEFAULT_MAINTENANCE_RETRY_AFTER_SECONDS = 900;

type Environment = Record<string, string | undefined>;

export type SiteMaintenanceConfig = {
  enabled: boolean;
  message: string;
  retryAfterSeconds: number;
};

export function parseMaintenanceBoolean(value: string | undefined): boolean {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) return false;
  if (["true", "1", "yes", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "off"].includes(normalized)) return false;
  throw new Error(
    `Invalid SITE_MAINTENANCE_MODE value "${value}". Expected true or false.`
  );
}

export function parseMaintenanceMessage(value: string | undefined): string {
  const normalized = String(value ?? "").trim().replace(/\s+/g, " ");
  const message = normalized || DEFAULT_MAINTENANCE_MESSAGE;
  if (message.length > 240) {
    throw new Error("SITE_MAINTENANCE_MESSAGE must be 240 characters or fewer.");
  }
  return message;
}

export function parseMaintenanceRetryAfter(value: string | undefined): number {
  const normalized = String(value ?? "").trim();
  if (!normalized) return DEFAULT_MAINTENANCE_RETRY_AFTER_SECONDS;
  if (!/^\d+$/.test(normalized)) {
    throw new Error(
      "SITE_MAINTENANCE_RETRY_AFTER_SECONDS must be an integer from 1 to 86400."
    );
  }
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 86_400) {
    throw new Error(
      "SITE_MAINTENANCE_RETRY_AFTER_SECONDS must be an integer from 1 to 86400."
    );
  }
  return parsed;
}

export function readSiteMaintenanceConfig(
  environment: Environment = process.env
): SiteMaintenanceConfig {
  return {
    enabled: parseMaintenanceBoolean(environment.SITE_MAINTENANCE_MODE),
    message: parseMaintenanceMessage(environment.SITE_MAINTENANCE_MESSAGE),
    retryAfterSeconds: parseMaintenanceRetryAfter(
      environment.SITE_MAINTENANCE_RETRY_AFTER_SECONDS
    ),
  };
}
