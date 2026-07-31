const crypto = require("crypto");
const { prisma } = require("./prisma");
const { logger, redact } = require("./logger");

const sanitizeAuditData = (value) => {
  if (value === undefined) return undefined;
  return redact(value);
};

const recordAudit = async ({
  actorUserId,
  action,
  targetType,
  targetId,
  beforeData,
  afterData,
  requestId,
  ipAddress,
}) => {
  try {
    return await prisma.auditLog.create({
      data: {
        id: crypto.randomUUID(),
        actorUserId: actorUserId || null,
        action,
        targetType,
        targetId: targetId ? String(targetId) : null,
        beforeData: sanitizeAuditData(beforeData),
        afterData: sanitizeAuditData(afterData),
        requestId: requestId || null,
        ipAddress: ipAddress || null,
      },
    });
  } catch (error) {
    logger.error("Audit log persistence failed", {
      action,
      targetType,
      targetId,
      error,
    });
    throw error;
  }
};

const requestAuditContext = (req) => ({
  actorUserId: req.user?.id || null,
  requestId: req.requestId || req.id || null,
  ipAddress: req.ip || null,
});

module.exports = {
  recordAudit,
  requestAuditContext,
};
