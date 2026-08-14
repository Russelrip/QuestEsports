const { prisma } = require("./prisma");

const DAY_MS = 24 * 60 * 60 * 1000;
const cutoff = (days, now) => new Date(now.getTime() - days * DAY_MS);

const buildFilters = (now = new Date()) => ({
  expiredSessions: { expiresAt: { lt: now } },
  spentVerificationTokens: { OR: [{ usedAt: { not: null } }, { expiresAt: { lt: now } }] },
  spentPasswordResetTokens: { OR: [{ usedAt: { not: null } }, { expiresAt: { lt: now } }] },
  spentEmailChangeTokens: { OR: [{ usedAt: { not: null } }, { expiresAt: { lt: now } }] },
  spentMobileOAuthGrants: { OR: [{ usedAt: { not: null } }, { expiresAt: { lt: now } }] },
  succeededJobs: { status: "succeeded", completedAt: { lt: cutoff(30, now) } },
  failedJobs: { status: "failed", failedAt: { lt: cutoff(90, now) } },
  staleRateLimits: { resetAt: { lt: cutoff(1, now) } },
  staleVetoGrants: { OR: [{ revokedAt: { not: null } }, { expiresAt: { lt: now } }] },
  staleVetoActions: { invalidatedAt: { lt: cutoff(90, now) } },
  oldRoomMessages: {
    createdAt: { lt: cutoff(180, now) },
    room: {
      match: { completedAt: { lt: cutoff(180, now) } },
      support: { none: { status: "open" } },
    },
  },
  oldResolvedSupport: { status: "resolved", resolvedAt: { lt: cutoff(365, now) } },
  oldNotifications: { createdAt: { lt: cutoff(90, now) } },
  oldReadRecipients: { readAt: { lt: cutoff(60, now) } },
  revokedPushSubscriptions: { revokedAt: { lt: cutoff(30, now) } },
  expiredRegistrationInvites: { inviteStatus: "pending", inviteExpiresAt: { lt: now }, inviteTokenHash: { not: null } },
  expiredSavedTeamInvites: { inviteStatus: "pending", inviteExpiresAt: { lt: now }, inviteTokenHash: { not: null } },
});

const previewDataHygiene = async ({ database = prisma, now = new Date() } = {}) => {
  const filters = buildFilters(now);
  const counts = await Promise.all([
    database.session.count({ where: filters.expiredSessions }),
    database.verificationToken.count({ where: filters.spentVerificationTokens }),
    database.passwordResetToken.count({ where: filters.spentPasswordResetTokens }),
    database.emailChangeToken.count({ where: filters.spentEmailChangeTokens }),
    database.mobileOAuthGrant.count({ where: filters.spentMobileOAuthGrants }),
    database.backgroundJob.count({ where: filters.succeededJobs }),
    database.backgroundJob.count({ where: filters.failedJobs }),
    database.rateLimitBucket.count({ where: filters.staleRateLimits }),
    database.vetoAccessGrant.count({ where: filters.staleVetoGrants }),
    database.vetoRoomAction.count({ where: filters.staleVetoActions }),
    database.matchRoomMessage.count({ where: filters.oldRoomMessages }),
    database.matchSupportRequest.count({ where: filters.oldResolvedSupport }),
    database.notification.count({ where: filters.oldNotifications }),
    database.notificationRecipient.count({ where: filters.oldReadRecipients }),
    database.webPushSubscription.count({ where: filters.revokedPushSubscriptions }),
    database.registrationMember.count({ where: filters.expiredRegistrationInvites }),
    database.savedTeamMember.count({ where: filters.expiredSavedTeamInvites }),
  ]);
  const keys = [
    "expiredSessions", "spentVerificationTokens", "spentPasswordResetTokens", "spentEmailChangeTokens",
    "spentMobileOAuthGrants", "succeededJobs", "failedJobs", "staleRateLimits", "staleVetoGrants",
    "staleVetoActions", "oldRoomMessages", "oldResolvedSupport", "oldNotifications", "oldReadRecipients",
    "revokedPushSubscriptions", "expiredRegistrationInvites", "expiredSavedTeamInvites",
  ];
  return Object.fromEntries(keys.map((key, index) => [key, counts[index]]));
};

const deleteInBatches = async (model, where, batchSize) => {
  let deleted = 0;
  while (true) {
    const rows = await model.findMany({ where, select: { id: true }, take: batchSize });
    if (!rows.length) break;
    const result = await model.deleteMany({ where: { id: { in: rows.map((row) => row.id) } } });
    deleted += result.count;
    if (rows.length < batchSize) break;
  }
  return deleted;
};

const applyDataHygiene = async ({ database = prisma, now = new Date(), batchSize = 500 } = {}) => {
  const filters = buildFilters(now);
  const deleted = {};
  deleted.expiredSessions = await deleteInBatches(database.session, filters.expiredSessions, batchSize);
  deleted.spentVerificationTokens = await deleteInBatches(database.verificationToken, filters.spentVerificationTokens, batchSize);
  deleted.spentPasswordResetTokens = await deleteInBatches(database.passwordResetToken, filters.spentPasswordResetTokens, batchSize);
  deleted.spentEmailChangeTokens = await deleteInBatches(database.emailChangeToken, filters.spentEmailChangeTokens, batchSize);
  deleted.spentMobileOAuthGrants = await deleteInBatches(database.mobileOAuthGrant, filters.spentMobileOAuthGrants, batchSize);
  deleted.succeededJobs = await deleteInBatches(database.backgroundJob, filters.succeededJobs, batchSize);
  deleted.failedJobs = await deleteInBatches(database.backgroundJob, filters.failedJobs, batchSize);
  deleted.staleRateLimits = await deleteInBatches(database.rateLimitBucket, filters.staleRateLimits, batchSize);
  deleted.staleVetoGrants = await deleteInBatches(database.vetoAccessGrant, filters.staleVetoGrants, batchSize);
  deleted.staleVetoActions = await deleteInBatches(database.vetoRoomAction, filters.staleVetoActions, batchSize);
  deleted.oldRoomMessages = await deleteInBatches(database.matchRoomMessage, filters.oldRoomMessages, batchSize);
  deleted.oldResolvedSupport = await deleteInBatches(database.matchSupportRequest, filters.oldResolvedSupport, batchSize);
  deleted.oldReadRecipients = await deleteInBatches(database.notificationRecipient, filters.oldReadRecipients, batchSize);
  deleted.oldNotifications = await deleteInBatches(database.notification, filters.oldNotifications, batchSize);
  deleted.revokedPushSubscriptions = await deleteInBatches(database.webPushSubscription, filters.revokedPushSubscriptions, batchSize);
  deleted.expiredRegistrationInvites = (await database.registrationMember.updateMany({
    where: filters.expiredRegistrationInvites,
    data: { inviteTokenHash: null, inviteSentAt: null, inviteExpiresAt: null },
  })).count;
  deleted.expiredSavedTeamInvites = (await database.savedTeamMember.updateMany({
    where: filters.expiredSavedTeamInvites,
    data: { inviteTokenHash: null, inviteSentAt: null, inviteExpiresAt: null },
  })).count;
  return deleted;
};

module.exports = { buildFilters, previewDataHygiene, applyDataHygiene };
