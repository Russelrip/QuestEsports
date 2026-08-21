const crypto = require("crypto");
const { prisma } = require("./prisma");
const { logger, redact } = require("./logger");

const sanitizeAuditData = (value) => {
  if (value === undefined) return undefined;
  return redact(value);
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
}) => database.auditLog.create({
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

const requestAuditContext = (req) => ({
  actorUserId: req.user?.id || null,
  requestId: req.requestId || req.id || null,
  ipAddress: req.ip || null,
});

module.exports = {
  recordAudit,
  recordAuditInTransaction,
  requestAuditContext,
};
