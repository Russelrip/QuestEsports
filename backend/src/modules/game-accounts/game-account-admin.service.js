const { prisma } = require("../../lib/prisma");
const { HttpError } = require("../../lib/http-error");
const { logger } = require("../../lib/logger");
const { recordAuditInTransaction } = require("../../lib/audit");
const { fingerprint, normalizeExternalId, VALORANT } = require("./game-account.service");
const { removeAdminRegistration } = require("../valorant-leaderboard/service");

// Staff-only release of a game account from the player currently holding it.
//
// The player-facing module is built so that no player can ever learn who holds
// an account: a conflict says "already linked to another Quest account, contact
// support" and stops. That instruction only means something if support can
// actually act, and until now it could not — the change-request flow moves a
// player OFF an account they hold and has no way to take one off somebody else.
// Every real case (a sold or handed-over account, a mis-linked one, a shared
// account being split) ended at a hand-written UPDATE against production.
//
// This is the admin side of that same sentence, and the one place where the
// holder of an account is disclosed — to staff who already hold the
// `game_accounts` area, and never to a player.
//
// It DELETES the row rather than retiring it to `revoked`.
//
// That is not the usual preference in this module and it is deliberate.
// `(game, external_id)` is globally unique — the abuse boundary that makes one
// Quest player per real game account true in the database rather than in
// application checks — so a `revoked` row goes on holding the identifier and
// the account stays just as unclaimable as before. Releasing it means giving up
// the claim, and the schema was built for exactly that: `registration_members`
// carries its own `external_id_snapshot` / `username_snapshot` / `tag_snapshot`
// and its foreign key is ON DELETE SET NULL, so what a team actually registered
// with survives the row. The audit entry below carries the rest — who held it,
// with what identity, at what verification level, and why staff released it —
// which is where an abuse pattern is read from afterwards.

const MAX_REASON_LENGTH = 500;
const MIN_REASON_LENGTH = 10;
const MAX_RESULTS = 20;

const PLAYER_PUBLIC_ID_PATTERN = /^QPID-\d{1,12}$/i;

// Staff see the holder; the identifier itself still never leaves the server.
// A fingerprint is enough to line a row up against an audit entry, which is the
// only reason an admin needs it.
const adminView = (account) => ({
  id: account.id,
  game: account.game,
  riotId:
    account.username && account.tagline ? `${account.username}#${account.tagline}` : null,
  region: account.region,
  status: account.status,
  verificationStatus: account.verificationStatus,
  linkedAt: account.linkedAt,
  externalIdFingerprint: fingerprint(account.externalId),
  player: {
    publicId: account.player?.publicId ?? null,
    displayName: account.player?.displayName ?? null,
    // An account on a player row with no Quest user behind it is the
    // "unclaimed record" the player-facing module warns about: nobody can sign
    // in and move it, so staff are the only route.
    hasQuestAccount: Boolean(account.player?.userId),
    username: account.player?.user?.username ?? null,
    discord: account.player?.discordIdentity
      ? {
        username: account.player.discordIdentity.username,
        globalName: account.player.discordIdentity.globalName,
      }
      : null,
  },
  // The blast radius, shown before the decision rather than after it: how many
  // approved rosters point at this row, and whether it is committed to one
  // right now.
  registrationSnapshots: account._count?.registrationSnapshots ?? 0,
  locked: account.status === "locked",
});

const splitRiotIdQuery = (value) => {
  const separator = value.lastIndexOf("#");
  if (separator <= 0 || separator === value.length - 1) return null;
  return { name: value.slice(0, separator), tag: value.slice(separator + 1) };
};

// Find the account an admin has been asked about.
//
// Support arrives with whatever the player gave them, which is a Riot ID far
// more often than anything Quest issued, so all three forms are accepted:
// `Name#Tag`, a player's public id, or a display name. Never a PUUID — staff
// are not handed a lookup that turns the identifier into a directory either.
const searchLinkedAccounts = async ({ query, game = VALORANT }) => {
  const trimmed = String(query || "").trim();
  if (trimmed.length < 2) {
    throw new HttpError(400, "Search by Riot ID (Name#Tag), player ID, or display name.");
  }

  const riotId = splitRiotIdQuery(trimmed);
  const where = riotId
    ? {
      game,
      username: { equals: riotId.name, mode: "insensitive" },
      tagline: { equals: riotId.tag, mode: "insensitive" },
    }
    : PLAYER_PUBLIC_ID_PATTERN.test(trimmed)
      ? { game, player: { publicId: { equals: trimmed, mode: "insensitive" } } }
      : {
        game,
        OR: [
          { username: { contains: trimmed, mode: "insensitive" } },
          { player: { displayName: { contains: trimmed, mode: "insensitive" } } },
          { player: { user: { username: { contains: trimmed, mode: "insensitive" } } } },
          { player: { discordIdentity: { username: { contains: trimmed, mode: "insensitive" } } } },
        ],
      };

  const accounts = await prisma.gameAccount.findMany({
    where,
    take: MAX_RESULTS,
    orderBy: { linkedAt: "desc" },
    include: {
      player: {
        select: {
          publicId: true,
          displayName: true,
          userId: true,
          user: { select: { username: true } },
          discordIdentity: { select: { username: true, globalName: true } },
        },
      },
      _count: { select: { registrationSnapshots: true } },
    },
  });

  return accounts.map(adminView);
};

// The note the player whose pending request this unlink invalidates will read.
// A request pointing at a row that no longer exists cannot be reviewed, and
// leaving it open would sit in the queue forever.
const supersededNote = (reason) =>
  `This request was closed because staff unlinked the account it was made from. ${reason}`;

// Release a game account from the player holding it.
//
// `expectedRiotId` is the same guard `linkValorantAccount` applies to a player:
// the caller states the identity they were looking at, and a row that has since
// been renamed or replaced refuses rather than being unlinked on a stale view.
const unlinkGameAccount = async ({
  accountId,
  reason,
  expectedRiotId = null,
  allowLocked = false,
  releaseLeaderboard = false,
  adminUserId,
  audit = {},
}) => {
  const trimmedReason = String(reason || "").trim();
  if (trimmedReason.length < MIN_REASON_LENGTH) {
    // Unlinking hands a competitive identity to whoever claims it next. A
    // record that cannot say why is not a record.
    throw new HttpError(400, "Say why this account is being unlinked.");
  }
  if (trimmedReason.length > MAX_REASON_LENGTH) {
    throw new HttpError(400, "That reason is too long.");
  }

  const account = await prisma.gameAccount.findUnique({
    where: { id: String(accountId || "") },
    include: {
      player: {
        select: {
          id: true,
          publicId: true,
          displayName: true,
          userId: true,
          user: { select: { username: true } },
          discordIdentity: { select: { username: true, globalName: true } },
        },
      },
      _count: { select: { registrationSnapshots: true } },
    },
  });

  if (!account) throw new HttpError(404, "That game account was not found.");

  const riotId =
    account.username && account.tagline ? `${account.username}#${account.tagline}` : null;

  if (expectedRiotId && String(expectedRiotId).trim().toLowerCase() !== String(riotId || "").toLowerCase()) {
    throw new HttpError(
      409,
      `That account now reads ${riotId ?? "a different identity"}. Search again and confirm before unlinking.`,
    );
  }

  if (account.status === "locked" && !allowLocked) {
    // `locked` means a roster was approved with this account on it and the
    // tournament may still be running. Unlinking is still allowed — a stolen or
    // sold account mid-tournament is exactly when staff need it — but never by
    // accident.
    throw new HttpError(
      409,
      "That account is locked to an approved tournament roster. Confirm you intend to unlink it anyway.",
    );
  }

  const externalId = normalizeExternalId(account.externalId);
  const view = adminView(account);

  const result = await prisma.$transaction(async (tx) => {
    // A pending change request made FROM this account can no longer be
    // reviewed once the row is gone, so it is closed with an explanation the
    // player sees on their profile rather than left dangling.
    const { count: requestsClosed } = await tx.gameAccountChangeRequest.updateMany({
      where: { currentAccountId: account.id, status: "pending" },
      data: {
        status: "rejected",
        reviewedByUserId: adminUserId,
        reviewedAt: new Date(),
        adminNote: supersededNote(trimmedReason),
      },
    });

    await tx.gameAccount.delete({ where: { id: account.id } });

    // The cached "Sri Lanka #N" on the player's profile was this account's
    // standing. Once they no longer hold an account for the game, it names a
    // place that is not theirs, so it goes with the row. It is a cache and the
    // next sync rebuilds it for whatever they do hold.
    const remaining = await tx.gameAccount.count({
      where: { playerId: account.playerId, game: account.game },
    });
    const rankingsCleared = remaining === 0
      ? (await tx.playerRanking.deleteMany({
        where: { playerId: account.playerId, game: account.game },
      })).count
      : 0;

    await recordAuditInTransaction(tx, {
      ...audit,
      actorUserId: adminUserId,
      action: "game_account.unlinked",
      targetType: "GameAccount",
      targetId: account.id,
      reason: trimmedReason,
      // Everything needed to reconstruct who held what, since the row itself
      // is gone. The identifier is redacted from audit rows by policy; the
      // fingerprint is what ties this entry to the account.
      beforeData: {
        game: account.game,
        externalIdFingerprint: fingerprint(externalId),
        displayIdentity: riotId,
        verificationStatus: account.verificationStatus,
        status: account.status,
        linkedAt: account.linkedAt,
        playerId: account.playerId,
        playerPublicId: account.player?.publicId ?? null,
        playerDisplayName: account.player?.displayName ?? null,
        playerUserId: account.player?.userId ?? null,
        discordUsername: account.player?.discordIdentity?.username ?? null,
        registrationSnapshots: account._count?.registrationSnapshots ?? 0,
      },
      afterData: {
        released: true,
        changeRequestsClosed: requestsClosed,
        rankingsCleared,
      },
    });

    return { requestsClosed, rankingsCleared };
  });

  logger.info("Game account unlinked by staff.", {
    gameAccountId: account.id,
    game: account.game,
    externalIdFingerprint: fingerprint(externalId),
  });

  // The upstream leaderboard is a separate system holding its own PUUID ->
  // Discord pairing, and releasing the Quest side does not touch it. Left
  // alone, the seller's Discord stays on the board under this account and the
  // next person to connect it is told they registered when the board still
  // names someone else — `registerOnLeaderboard` reads that as "already".
  //
  // Opt-in, because it is the `valorant_leaderboard` area's action and the
  // caller may not hold it; the route decides. Best effort, outside the
  // transaction, and it can never undo an unlink that has already committed.
  let leaderboard = null;
  if (releaseLeaderboard) {
    try {
      const removal = await removeAdminRegistration({ puuid: externalId, actorUserId: adminUserId });
      leaderboard = { state: "removed", removalId: removal?.removalId ?? null };
    } catch (error) {
      const code = error?.code || error?.body?.code || null;
      logger.warn("Leaderboard registration not removed after a staff unlink.", {
        gameAccountId: account.id,
        code,
        status: error?.statusCode || error?.status || null,
      });
      leaderboard = { state: "failed", reason: code };
    }
  }

  return {
    released: {
      riotId,
      externalIdFingerprint: view.externalIdFingerprint,
      previousHolder: view.player,
      registrationSnapshots: view.registrationSnapshots,
      wasLocked: view.locked,
    },
    changeRequestsClosed: result.requestsClosed,
    rankingsCleared: result.rankingsCleared,
    leaderboard,
  };
};

module.exports = {
  searchLinkedAccounts,
  unlinkGameAccount,
  adminView,
  splitRiotIdQuery,
  MAX_REASON_LENGTH,
  MIN_REASON_LENGTH,
  MAX_RESULTS,
};
