const crypto = require("crypto");
const { prisma } = require("./prisma");
const { logger, redact } = require("./logger");

const AUDIT_REDACTED_VALUE = "[REDACTED]";
const AUDIT_SENSITIVE_KEY = /(?:password|secret|token|authorization|cookie|session|oauth|grant|signature|ciphertext|encrypted|private.?key|puuid|buffer|contents|raw.?file|upload.?data)/i;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const redactAuditString = typeof redact === "function" ? redact : (value) => value;

// Audit records are durable and are routinely exported for incident review.
// Keep this policy stricter than the general logger policy: capability values,
// provider credentials, encrypted identifiers, PUUIDs, and file contents must
// never become part of an audit row even when a caller passes a whole object.
const sanitizeAuditValue = (value, key = "") => {
  if (value === undefined) return undefined;
  if (AUDIT_SENSITIVE_KEY.test(key)) return AUDIT_REDACTED_VALUE;
  if (Buffer.isBuffer(value)) return AUDIT_REDACTED_VALUE;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((entry) => sanitizeAuditValue(entry));
  if (value && typeof value === "object") {
    return Object.entries(value).reduce((result, [nestedKey, nestedValue]) => {
      result[nestedKey] = sanitizeAuditValue(nestedValue, nestedKey);
      return result;
    }, {});
  }
  return typeof value === "string" ? redactAuditString(value) : value;
};

const sanitizeAuditData = (value) => sanitizeAuditValue(value);

// Kept in step with the AuditSource enum. An unrecognised value is stored as
// NULL rather than guessed at: an honest gap is worth more during an incident
// review than a plausible-looking wrong answer.
const AUDIT_SOURCES = new Set(["web", "admin", "mobile", "bot", "system"]);
const normalizeAuditSource = (value) =>
  AUDIT_SOURCES.has(value) ? value : null;

// Reason is free text a human wrote, so it is sanitized like any other audit
// string and capped — an audit row must stay readable and exportable.
const REASON_MAX_LENGTH = 500;
const normalizeAuditReason = (value) => {
  if (typeof value !== "string") return null;
  const trimmed = redactAuditString(value.trim());
  if (!trimmed) return null;
  return trimmed.length > REASON_MAX_LENGTH
    ? `${trimmed.slice(0, REASON_MAX_LENGTH - 1)}…`
    : trimmed;
};

const persistAudit = async (database, {
  actorUserId,
  action,
  targetType,
  targetId,
  beforeData,
  afterData,
  requestId,
  ipAddress,
  source,
  reason,
}) => database.auditLog.create({
  data: {
    id: crypto.randomUUID(),
    actorUserId: UUID_PATTERN.test(String(actorUserId || "")) ? actorUserId : null,
    action,
    targetType,
    targetId: targetId ? String(targetId) : null,
    beforeData: sanitizeAuditData(beforeData),
    afterData: sanitizeAuditData(afterData),
    requestId: requestId || null,
    ipAddress: ipAddress || null,
    source: normalizeAuditSource(source),
    reason: normalizeAuditReason(reason),
  },
});

const recordAudit = async (data) => {
  try {
    return await persistAudit(prisma, data);
  } catch (error) {
    logger.error("Audit log persistence failed", {
      action: data.action,
      targetType: data.targetType,
      targetId: data.targetId,
      error,
    });
    throw error;
  }
};

const recordAuditInTransaction = (database, data) => persistAudit(database, data);

// Derive only what the request actually proves.
//
// A service token identifies automation, and the `/api/admin` prefix identifies
// the dashboard. Nothing distinguishes the Android admin client from the web
// one — both call the same routes and neither announces itself — so `mobile` is
// never inferred here. Guessing it from a user agent would put a wrong answer
// in a durable record, which is worse than an honest `admin`.
const requestAuditSource = (req) => {
  if (req.serviceToken || req.isServiceRequest) return "bot";
  const path = req.originalUrl || req.baseUrl || req.path || "";
  return path.startsWith("/api/admin") ? "admin" : "web";
};

const requestAuditContext = (req) => ({
  actorUserId: req.user?.id || null,
  requestId: req.requestId || req.id || null,
  ipAddress: req.ip || null,
  source: requestAuditSource(req),
});

module.exports = {
  recordAudit,
  recordAuditInTransaction,
  requestAuditContext,
  requestAuditSource,
  sanitizeAuditData,
};
