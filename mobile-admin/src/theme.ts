export const colors = {
  background: "#07060b",
  surface: "#11101a",
  surfaceRaised: "#191726",
  border: "#2b2739",
  text: "#f7f4ff",
  muted: "#aaa2ba",
  accent: "#8b5cf6",
  accentStrong: "#6d28d9",
  success: "#22c55e",
  warning: "#f59e0b",
  danger: "#ef4444",
  info: "#38bdf8",
  white: "#ffffff",
} as const;

export const spacing = {
  xs: 6,
  sm: 10,
  md: 16,
  lg: 24,
  xl: 32,
} as const;

export const radius = {
  sm: 8,
  md: 14,
  lg: 22,
  pill: 999,
} as const;

export const statusColors: Record<string, string> = {
  approved: colors.success,
  accepted: colors.success,
  paid: colors.success,
  fulfilled: colors.success,
  completed: colors.success,
  published: colors.success,
  verified: colors.success,
  pending: colors.warning,
  pending_payment: colors.warning,
  processing: colors.info,
  reviewed: colors.info,
  review_required: colors.warning,
  registration_open: colors.success,
  rejected: colors.danger,
  failed: colors.danger,
  cancelled: colors.danger,
  charged_back: colors.danger,
  expired: colors.muted,
  refunded: colors.info,
  draft: colors.muted,
  unpublished: colors.muted,
};

export const humanize = (value?: string | null) =>
  value
    ? value
        .replace(/_/g, " ")
        .replace(/\b\w/g, (character) => character.toUpperCase())
    : "—";

export const formatDate = (value?: string | null) => {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return new Intl.DateTimeFormat("en-LK", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Colombo",
  }).format(parsed);
};

export const formatMoney = (amount?: number | string | null, currency = "LKR") => {
  const numericAmount = Number(amount || 0);
  return new Intl.NumberFormat("en-LK", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(numericAmount) ? numericAmount : 0);
};
