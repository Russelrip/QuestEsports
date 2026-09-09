const crypto = require("crypto");
const { prisma } = require("../../lib/prisma");
const { HttpError } = require("../../lib/http-error");
const { logger } = require("../../lib/logger");
const { recordAuditInTransaction } = require("../../lib/audit");
const {
  resolveValorantAccount,
  fingerprint,
  publicView,
  VALORANT,
} = require("./game-account.service");
const { repointRegistration } = require("../valorant-leaderboard/service");

const MAX_REASON_LENGTH = 1000;

// The distinction this whole module exists for.
//
// A Riot RENAME leaves the stable identifier untouched. Nothing about the
// player's competitive identity has changed, so the display fields refresh and
// no human is involved. Making admins approve renames would bury them in
// paperwork and train them to rubber-stamp.
//
// A REPLACEMENT means the underlying account is genuinely different. That is a
// competitive-integrity event and needs review, especially once the account has
// tournament history.
const classifyChange = ({ currentExternalId, requestedExternalId }) =>
  currentExternalId === requestedExternalId ? "rename" : "replacement";

// Refresh the cached display snapshot for an account whose stable identifier
// has not moved. Safe to run unattended.
const refreshDisplayIdentity = async ({ account, resolved, actorUserId, audit = {} }) => {
  const changed =
    account.username !== resolved.username ||
    account.tagline !== resolved.tagline ||
    account.region !== resolved.region;

  if (!changed) {
    return { refreshed: false, account: publicView(account) };
  }

  const updated = await prisma.$transaction(async (tx) => {
    const next = await tx.gameAccount.update({
      where: { id: account.id },
      data: {
        username: resolved.username,
        tagline: resolved.tagline,
        region: resolved.region,
        lastSyncedAt: new Date(),
      },
    });

    await recordAuditInTransaction(tx, {
      ...audit,
      actorUserId,
      action: "game_account.display_refreshed",
      targetType: "GameAccount",
      targetId: account.id,
      beforeData: { displayIdentity: `${account.username}#${account.tagline}` },
      afterData: { displayIdentity: `${resolved.username}#${resolved.tagline}` },
    });

    return next;
  });

  logger.info("Game account display identity refreshed after a rename.", {
    gameAccountId: account.id,
    externalIdFingerprint: fingerprint(account.externalId),
  });

  return { refreshed: true, account: publicView(updated) };
};

// A player asks to swap the actual account behind their competitive identity.
const requestAccountChange = async ({ userId, riotId, name, tag, reason, audit = {} }) => {
  const trimmedReason = String(reason || "").trim();
  if (!trimmedReason) {
    // An unexplained swap is not reviewable, so it is refused at the edge as
    // well as by the database CHECK.
    throw new HttpError(400, "Tell us why this account needs to change.");
  }
  if (trimmedReason.length > MAX_REASON_LENGTH) {
    throw new HttpError(400, "That reason is too long.");
  }

  const player = await prisma.player.findUnique({
    where: { userId },
    select: {
      id: true,
      gameAccounts: {
        where: { game: VALORANT, status: { in: ["active", "locked", "change_requested"] } },
        orderBy: { linkedAt: "desc" },
      },
    },
  });

  const current = player?.gameAccounts?.[0] ?? null;
  if (!player || !current) {
    throw new HttpError(409, "You do not have a VALORANT account linked to change.");
  }

  const resolved = await resolveValorantAccount({ riotId, name, tag, userId });

  if (classifyChange({
    currentExternalId: current.externalId,
    requestedExternalId: resolved.externalId,
  }) === "rename") {
    // Same account, new display name. Refresh and tell the player plainly that
    // nothing needed approving.
    const result = await refreshDisplayIdentity({
      account: current,
      resolved,
      actorUserId: userId,
      audit,
    });
    return { kind: "rename", ...result };
  }

  if (resolved.linkedElsewhere) {
    throw new HttpError(
      409,
      "That VALORANT account is already linked to another Quest account. If it is yours, contact support.",
    );
  }

  const open = await prisma.gameAccountChangeRequest.findFirst({
    where: { playerId: player.id, game: VALORANT, status: "pending" },
    select: { id: true },
  });
  if (open) {
    throw new HttpError(409, "You already have an account change awaiting review.");
  }

  const request = await prisma.$transaction(async (tx) => {
    const created = await tx.gameAccountChangeRequest.create({
      data: {
        id: crypto.randomUUID(),
        playerId: player.id,
        currentAccountId: current.id,
        game: VALORANT,
        requestedExternalId: resolved.externalId,
        requestedUsername: resolved.username,
        requestedTagline: resolved.tagline,
        requestedRegion: resolved.region,
        reason: trimmedReason,
        requestedByUserId: userId,
      },
    });

    // The account is marked as having a change pending, but it is NOT swapped
    // and any tournament lock stays exactly where it is.
    if (current.status === "active") {
      await tx.gameAccount.update({
        where: { id: current.id },
        data: { status: "change_requested" },
      });
    }

    await recordAuditInTransaction(tx, {
      ...audit,
      actorUserId: userId,
      action: "game_account.change_requested",
      targetType: "GameAccountChangeRequest",
      targetId: created.id,
      beforeData: {
        gameAccountId: current.id,
        externalIdFingerprint: fingerprint(current.externalId),
        displayIdentity: `${current.username}#${current.tagline}`,
      },
      afterData: {
        externalIdFingerprint: fingerprint(resolved.externalId),
        displayIdentity: `${resolved.username}#${resolved.tagline}`,
        reason: trimmedReason,
      },
    });

    return created;
  });

  return { kind: "replacement", requestId: request.id, status: request.status };
};

const requestView = (request) => ({
  id: request.id,
  status: request.status,
  game: request.game,
  reason: request.reason,
  requestedIdentity: `${request.requestedUsername}#${request.requestedTagline}`,
  requestedRegion: request.requestedRegion,
  currentIdentity: request.currentAccount
    ? `${request.currentAccount.username}#${request.currentAccount.tagline}`
    : null,
  player: request.player
    ? { publicId: request.player.publicId, displayName: request.player.displayName }
    : null,
  requestedAt: request.createdAt,
  reviewedAt: request.reviewedAt,
  adminNote: request.adminNote,
});

const listChangeRequests = async ({ status = "pending" } = {}) => {
  const requests = await prisma.gameAccountChangeRequest.findMany({
    where: status === "all" ? {} : { status },
    orderBy: { createdAt: "asc" },
    include: {
      currentAccount: { select: { username: true, tagline: true } },
      player: { select: { publicId: true, displayName: true } },
    },
  });
  return requests.map(requestView);
};

// An admin decision. Approving replaces the account; the old row is retained as
// `replaced` so tournament history that references it stays intact, and every
// existing registration snapshot is untouched by design.
const reviewChangeRequest = async ({ requestId, approve, adminUserId, adminNote, audit = {} }) => {
  const note = String(adminNote || "").trim();
  if (!approve && !note) {
    // A rejection the player cannot understand is not a decision.
    throw new HttpError(400, "Give a reason when rejecting an account change.");
  }

  const result = await prisma.$transaction(async (tx) => {
    const request = await tx.gameAccountChangeRequest.findUnique({
      where: { id: requestId },
      // The player's Quest user is what the leaderboard move is made for: the
      // upstream is addressed by the Discord identity linked to that account,
      // never by anything the request carries.
      include: { currentAccount: true, player: { select: { userId: true } } },
    });
    if (!request) throw new HttpError(404, "Account change request not found.");
    if (request.status !== "pending") {
      throw new HttpError(409, "That request has already been reviewed.");
    }

    let replacement = null;

    if (approve) {
      // Retire rather than delete: registration snapshots and tournament
      // history point at this row.
      if (request.currentAccountId) {
        await tx.gameAccount.update({
          where: { id: request.currentAccountId },
          data: { status: "replaced" },
        });
      }

      replacement = await tx.gameAccount.create({
        data: {
          id: crypto.randomUUID(),
          playerId: request.playerId,
          game: request.game,
          externalId: request.requestedExternalId,
          username: request.requestedUsername,
          tagline: request.requestedTagline,
          region: request.requestedRegion,
          // An admin looked at evidence and decided. That is the one path to
          // this state.
          verificationStatus: "admin_verified",
          status: "active",
          verifiedAt: new Date(),
          lastSyncedAt: new Date(),
        },
      });
    } else if (request.currentAccountId && request.currentAccount?.status === "change_requested") {
      // Rejection returns the account to service exactly as it was.
      await tx.gameAccount.update({
        where: { id: request.currentAccountId },
        data: { status: "active" },
      });
    }

    const updated = await tx.gameAccountChangeRequest.update({
      where: { id: requestId },
      data: {
        status: approve ? "approved" : "rejected",
        reviewedByUserId: adminUserId,
        reviewedAt: new Date(),
        adminNote: note || null,
      },
    });

    await recordAuditInTransaction(tx, {
      ...audit,
      actorUserId: adminUserId,
      action: approve ? "game_account.change_approved" : "game_account.change_rejected",
      targetType: "GameAccountChangeRequest",
      targetId: requestId,
      beforeData: {
        gameAccountId: request.currentAccountId,
        externalIdFingerprint: request.currentAccount
          ? fingerprint(request.currentAccount.externalId)
          : null,
      },
      afterData: {
        gameAccountId: replacement?.id ?? null,
        externalIdFingerprint: fingerprint(request.requestedExternalId),
        adminNote: note || null,
      },
    });

    return {
      status: updated.status,
      gameAccountId: replacement?.id ?? null,
      playerUserId: request.player?.userId ?? null,
      approvedExternalId: approve ? request.requestedExternalId : null,
    };
  });

  // The leaderboard follows the decision that was just recorded.
  //
  // Outside the transaction on purpose: it is a call to another service, and
  // holding a database transaction open across one turns a slow dependency into
  // a database problem. It also must not be able to undo the approval — an
  // admin's decision is the durable thing here, and a leaderboard that cannot
  // be reached is a retry, not a reversal.
  if (result.approvedExternalId && result.playerUserId) {
    try {
      await repointRegistration({
        userId: result.playerUserId,
        puuid: result.approvedExternalId,
      });
    } catch (error) {
      // Includes the ordinary case of a player who was never on the
      // leaderboard: there is no registration to move, and nothing is wrong.
      logger.warn("Leaderboard registration not moved after an approved change.", {
        requestId,
        code: error?.code || error?.body?.code || null,
        status: error?.statusCode || error?.status || null,
      });
    }
  }

  return { status: result.status, gameAccountId: result.gameAccountId };
};

module.exports = {
  classifyChange,
  refreshDisplayIdentity,
  requestAccountChange,
  listChangeRequests,
  reviewChangeRequest,
  requestView,
  MAX_REASON_LENGTH,
};
