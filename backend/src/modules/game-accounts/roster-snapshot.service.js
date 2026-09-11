const { recordAuditInTransaction } = require("../../lib/audit");
const { logger } = require("../../lib/logger");
const { trackedGameFor } = require("./registration-readiness.service");

// Snapshot a roster's competitive identities and lock the accounts behind them.
//
// This runs when a registration is APPROVED, which is the moment a roster is
// actually committed to a tournament. From here on the tournament record must
// show what was registered, not what the player's profile happens to say later.
//
// Runs inside the caller's transaction: a roster that is approved but not
// snapshotted would be a registration with no record of who actually played.
const snapshotAndLockRoster = async ({
  tx,
  registrationId,
  tournamentGame,
  actorUserId = null,
  requestId = null,
  ipAddress = null,
}) => {
  const trackedGame = trackedGameFor(tournamentGame);
  if (!trackedGame) {
    // A title Quest has no adapter for has nothing to snapshot. That is not a
    // failure — it is the honest state for every non-VALORANT tournament.
    return { snapshotted: 0, locked: 0, skipped: "no_adapter" };
  }

  const members = await tx.registrationMember.findMany({
    where: { registrationId, playerId: { not: null } },
    select: {
      id: true,
      playerId: true,
      snapshotAt: true,
      player: {
        select: {
          gameAccounts: {
            where: { game: trackedGame, status: { in: ["active", "locked"] } },
            orderBy: { linkedAt: "desc" },
          },
        },
      },
    },
  });

  let snapshotted = 0;
  let locked = 0;

  for (const member of members) {
    // Re-approving a registration must not rewrite a snapshot that already
    // exists. The first commitment is the one that counts; a genuine change
    // goes through the admin account-change process, not through re-approval.
    if (member.snapshotAt) continue;

    const account = member.player?.gameAccounts?.[0];
    if (!account) continue;

    await tx.registrationMember.update({
      where: { id: member.id },
      data: {
        gameAccountId: account.id,
        externalIdSnapshot: account.externalId,
        usernameSnapshot: account.username,
        tagSnapshot: account.tagline,
        verificationStatusSnapshot: account.verificationStatus,
        snapshotAt: new Date(),
      },
    });
    snapshotted += 1;

    if (account.status !== "locked") {
      await tx.gameAccount.update({
        where: { id: account.id },
        data: { status: "locked" },
      });
      locked += 1;
    }
  }

  if (snapshotted > 0) {
    await recordAuditInTransaction(tx, {
      actorUserId,
      requestId,
      ipAddress,
      action: "registration.roster_locked",
      targetType: "TeamRegistration",
      targetId: registrationId,
      beforeData: null,
      afterData: { game: trackedGame, snapshotted, locked },
    });
  }

  logger.info("Registration roster competitive identities snapshotted.", {
    registrationId,
    game: trackedGame,
    snapshotted,
    locked,
  });

  return { snapshotted, locked, skipped: null };
};

// Columns that describe what was committed to a tournament. Nothing on a
// profile-edit or roster-edit path may write these — a player renaming on Riot
// or swapping accounts must never silently alter competitive history.
const SNAPSHOT_COLUMNS = Object.freeze([
  "gameAccountId",
  "externalIdSnapshot",
  "usernameSnapshot",
  "tagSnapshot",
  "verificationStatusSnapshot",
  "snapshotAt",
]);

// Guard for any code path that updates a registration member for ordinary
// reasons. Callers pass their update payload; a snapshot column in it is a bug,
// not a request to honour.
const assertNoSnapshotWrite = (data, context = "registration member update") => {
  const offending = SNAPSHOT_COLUMNS.filter((column) =>
    Object.prototype.hasOwnProperty.call(data || {}, column),
  );
  if (offending.length > 0) {
    throw new Error(
      `${context} attempted to write competitive snapshot columns: ${offending.join(", ")}`,
    );
  }
  return data;
};

module.exports = {
  snapshotAndLockRoster,
  assertNoSnapshotWrite,
  SNAPSHOT_COLUMNS,
};
