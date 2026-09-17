const crypto = require("crypto");
const { prisma } = require("../../lib/prisma");
const { HttpError } = require("../../lib/http-error");
const { logger } = require("../../lib/logger");
const cache = require("../../lib/cache");
const { normalizeRiotId } = require("../valorant/valorant.validation");
const { recordAuditInTransaction } = require("../../lib/audit");
const {
  checkDiscord,
  submitRegistration: submitLeaderboardRegistration,
} = require("../valorant-leaderboard/service");
const {
  resolveRiotAccount,
  fetchPlayerPreview,
  FastApiError,
} = require("./game-account.client");

const VALORANT = "valorant";
// Riot display names change rarely and a player retypes their ID a handful of
// times while a debounced field settles. Five minutes collapses that burst
// without letting a rename go stale for long.
const RESOLVE_CACHE_TTL_SECONDS = 300;

// Upstream codes that genuinely mean "this Riot ID does not exist". Everything
// else — provider rate limits, provider outages, transport failures — means
// Quest could not check, which is a different answer and must never be
// reported as not-found.
const NOT_FOUND_CODES = new Set(["PLAYER_NOT_FOUND", "PLAYER_REGION_UNKNOWN"]);
const INVALID_INPUT_CODES = new Set(["INVALID_RIOT_ID", "INVALID_REQUEST"]);

const UNAVAILABLE_MESSAGE =
  "We couldn't verify this account right now. Please try again shortly.";
const NOT_FOUND_MESSAGE = "That Riot ID could not be found. Check the name and tag.";

// The external identifier is the identity key, so it is normalized before it is
// compared or stored. The database CHECK enforces the same shape, so an
// un-normalized write cannot slip through another code path.
const normalizeExternalId = (value) => String(value || "").trim().toLowerCase();

const cacheKeyFor = ({ name, tag }) =>
  `game-account:valorant:resolve:${name.toLowerCase()}#${tag.toLowerCase()}`;

// Upstream failures are translated once, here, so no caller has to decide what
// a Henrik error means and no upstream detail reaches the browser.
const translateUpstreamError = (error) => {
  if (error instanceof FastApiError) {
    if (NOT_FOUND_CODES.has(error.code)) {
      return new HttpError(404, NOT_FOUND_MESSAGE);
    }
    if (INVALID_INPUT_CODES.has(error.code)) {
      // Distinct from the local validation message on purpose: an identical
      // string for "we rejected the shape" and "the provider rejected it"
      // makes the two indistinguishable in a log, and sends anyone debugging
      // to the wrong layer.
      logger.warn("VALORANT provider rejected the Riot ID.", {
        code: error.code,
        status: error.status,
        requestId: error.requestId,
      });
      return new HttpError(400, "That Riot ID was not accepted. Check the name and tag.");
    }
    // A provider outage, a provider rate limit, or a service-auth problem are
    // all "we could not check", never "the account does not exist".
    logger.warn("VALORANT account resolution failed upstream.", {
      code: error.code,
      status: error.status,
      requestId: error.requestId,
    });
    return new HttpError(503, UNAVAILABLE_MESSAGE);
  }

  logger.warn("VALORANT account resolution could not reach the platform.", {
    code: error?.code || null,
    status: error?.status || null,
  });
  return new HttpError(503, UNAVAILABLE_MESSAGE);
};

// Whether this PUUID can still be claimed, and by whom. Deliberately returns
// booleans and the caller's own linkage only: telling one signed-in user which
// other account holds a PUUID would turn this into a lookup directory.
//
// "Elsewhere" has two very different meanings and the player is owed the
// difference. Another signed-in Quest user holding it is a dispute; a player row
// with no Quest user behind it (left behind when an admin deletes a user) is a
// record waiting to be reclaimed, and telling that person "another account has
// it" sends them hunting for an account that does not exist. Neither is ever
// handed over automatically — resolution cannot prove ownership — but the
// explanation differs.
const describeExistingLink = async ({ externalId, userId }) => {
  const existing = await prisma.gameAccount.findUnique({
    where: { game_externalId: { game: VALORANT, externalId } },
    select: {
      id: true,
      status: true,
      verificationStatus: true,
      player: { select: { userId: true } },
    },
  });

  if (!existing) {
    return { available: true, linkedToYou: false, linkedElsewhere: false, unclaimedRecord: false };
  }

  const linkedToYou = Boolean(userId) && existing.player?.userId === userId;
  return {
    available: false,
    linkedToYou,
    linkedElsewhere: !linkedToYou,
    unclaimedRecord: !linkedToYou && !existing.player?.userId,
    status: linkedToYou ? existing.status : undefined,
    verificationStatus: linkedToYou ? existing.verificationStatus : undefined,
  };
};

// The statuses in which an account is the player's CURRENT one. `replaced` and
// `revoked` rows stay in the table so tournament history keeps pointing at
// them, but they are the past, and a player must never be told "already
// connected" about an account that no longer shows on their profile.
const CURRENT_STATUSES = new Set(["active", "locked", "change_requested"]);

const LINKED_ELSEWHERE_MESSAGE =
  "That VALORANT account is already linked to another Quest account. If it is yours, contact support.";
const UNCLAIMED_RECORD_MESSAGE =
  "That VALORANT account belongs to an older Quest player record that is not connected to any account. " +
  "Contact support so an admin can move it, and its tournament history, to you.";
const PREVIOUS_ACCOUNT_MESSAGE =
  "You used that VALORANT account before. Use Change account to move back to it — an admin approves the move.";

// One place decides what "you cannot link this" says, so the link, the import
// and a change request can never explain the same conflict differently.
const conflictFor = (link) => {
  if (link.linkedToYou && link.status && !CURRENT_STATUSES.has(link.status)) {
    return new HttpError(409, PREVIOUS_ACCOUNT_MESSAGE);
  }
  if (link.linkedElsewhere) {
    return new HttpError(409, link.unclaimedRecord ? UNCLAIMED_RECORD_MESSAGE : LINKED_ELSEWHERE_MESSAGE);
  }
  return null;
};

// Resolve a Riot ID to the upstream's stable identifier plus a current display
// snapshot. Resolution proves the account EXISTS; it says nothing about who
// owns it, and callers must not present it as more than that.
const resolveValorantAccount = async ({ riotId, name, tag, userId }) => {
  const identity = riotId
    ? normalizeRiotId(splitRiotId(riotId))
    : normalizeRiotId({ name, tag });

  const key = cacheKeyFor(identity);
  let account = await cache.get(key);

  if (!account) {
    try {
      account = await resolveRiotAccount({ ...identity, actorUserId: userId });
    } catch (error) {
      throw translateUpstreamError(error);
    }

    if (!account.externalId) {
      // A success envelope with no stable identifier is unusable: storing the
      // display name as identity is exactly the failure this model exists to
      // prevent.
      logger.warn("VALORANT resolve returned no stable identifier.");
      throw new HttpError(503, UNAVAILABLE_MESSAGE);
    }

    account.externalId = normalizeExternalId(account.externalId);
    // Only successful resolutions are cached. Caching a failure would make a
    // transient provider outage look like a missing account for five minutes.
    await cache.set(key, account, RESOLVE_CACHE_TTL_SECONDS);
  }

  const link = await describeExistingLink({ externalId: account.externalId, userId });
  const preview = await fetchPlayerPreview({
    externalId: account.externalId,
    actorUserId: userId,
  });

  return {
    game: VALORANT,
    externalId: account.externalId,
    username: account.username,
    tagline: account.tagline,
    region: account.region,
    // Say plainly what was established. The upstream has no Riot Sign-On, so
    // resolution can never be presented as proof of ownership.
    verification: "resolved",
    preview,
    ...link,
  };
};


// A stable identifier is not secret, but it is a durable cross-service handle
// and the audit policy already redacts anything keyed `puuid`. Audit rows carry
// a short fingerprint plus the account row id, which is enough for an admin to
// follow a change without the identifier itself living in exported audit data.
const fingerprint = (externalId) =>
  crypto.createHash("sha256").update(externalId).digest("hex").slice(0, 12);

const publicView = (account) => ({
  id: account.id,
  game: account.game,
  username: account.username,
  tagline: account.tagline,
  region: account.region,
  verificationStatus: account.verificationStatus,
  status: account.status,
  linkedAt: account.linkedAt,
  verifiedAt: account.verifiedAt,
  lastSyncedAt: account.lastSyncedAt,
});

// A resolution carries the stable identifier so the server can compare and
// store it. Anything headed for the browser goes through this first.
const withoutExternalId = (value) => {
  const view = { ...value };
  delete view.externalId;
  return view;
};

// Every Quest user owns at most one player row, created on first use. A player
// may also exist unclaimed (legacy rosters, LAN guests), which is why the
// relation is nullable rather than a column on `users`.
const ensurePlayerForUser = async (database, { userId, displayName }) => {
  const existing = await database.player.findUnique({ where: { userId } });
  if (existing) return existing;
  return database.player.create({
    data: { id: crypto.randomUUID(), userId, displayName },
  });
};

// The Discord snowflake the leaderboard knows this user by, or null.
const linkedDiscordId = async (userId) => {
  const discord = await prisma.oAuthAccount.findFirst({
    where: { userId, provider: "discord" },
    select: { providerUserId: true },
  });
  return discord?.providerUserId || null;
};

// Discord corroboration is the strongest signal available without Riot Sign-On:
// the upstream leaderboard already pairs a stable Discord ID to a PUUID under a
// partial-unique index. If the signed-in user's linked Discord account is the
// one paired to this PUUID upstream, two independent systems agree — which is
// meaningfully more than the user asserting it. It is still not ownership.
const corroborateWithDiscord = async ({ userId, externalId }) => {
  const discordId = await linkedDiscordId(userId);
  if (!discordId) return false;

  try {
    const result = await checkDiscord(discordId);
    const upstreamPuuid = normalizeExternalId(result?.user?.puuid || result?.puuid || "");
    return Boolean(upstreamPuuid) && upstreamPuuid === externalId;
  } catch (error) {
    // Corroboration is an upgrade, never a gate: if the upstream cannot answer,
    // the link still succeeds at the weaker, honest state.
    logger.warn("Discord corroboration unavailable; linking without it.", {
      code: error?.code || null,
      status: error?.status || null,
    });
    return false;
  }
};

// Put a newly connected account on the VALORANT leaderboard too.
//
// Connecting an account and registering for the leaderboard were two journeys
// asking for the same two things — a connected Discord and a Riot identity —
// and a player who did one was quietly absent from the other. This makes the
// connection the single place it is asked for.
//
// Best effort, always. The account link is the thing the player asked for and
// it has already succeeded by the time this runs; a leaderboard that is down,
// slow, or refusing must not undo it. What each outcome means:
//
//   registered  — now on the leaderboard
//   already     — was on it, pointing at this same account
//   diverged    — was on it, pointing at a DIFFERENT account, and the upstream
//                 offers no way to re-point it. Reported rather than swallowed,
//                 because a stale entry is worse than an absent one: it looks
//                 current and is wrong.
//   unavailable — could not be reached; nothing was changed
const registerOnLeaderboard = async ({ userId, externalId }) => {
  const discordId = await linkedDiscordId(userId);
  if (!discordId) return { state: "unavailable", reason: "NO_DISCORD" };

  try {
    await submitLeaderboardRegistration({ userId, puuid: externalId });
    return { state: "registered" };
  } catch (error) {
    const code = error?.code || error?.body?.code || null;

    if (code === "PUUID_ALREADY_REGISTERED") {
      // This exact account is already on the leaderboard. Nothing to do, and
      // nothing wrong.
      return { state: "already" };
    }

    if (code === "DISCORD_ALREADY_REGISTERED") {
      // Their Discord holds an older registration. Whether it points at the
      // account they just connected decides whether this is fine or stale.
      try {
        const existing = await checkDiscord(discordId);
        const registered = normalizeExternalId(existing?.user?.puuid || "");
        if (registered && registered === externalId) return { state: "already" };
        return {
          state: "diverged",
          registeredName: existing?.user?.name || null,
          registeredTag: existing?.user?.tag || null,
        };
      } catch {
        return { state: "unavailable", reason: "LOOKUP_FAILED" };
      }
    }

    logger.warn("Leaderboard registration after account link did not complete.", {
      code,
      status: error?.status || null,
    });
    return { state: "unavailable", reason: code || "FAILED" };
  }
};

// Adopt the VALORANT account this user already registered on the leaderboard.
//
// Both journeys prove the same thing to the same degree, and they ask for it
// twice. The leaderboard requires a connected Discord and a PUUID the player
// fetched from their own Riot account page; linking a game account requires a
// connected Discord and a Riot ID. Someone who has done the first has already
// told Quest who they are, and making them do the second by hand — from a
// display name they now have to remember — is a step that teaches them nothing
// and loses some of them.
//
// It deliberately goes through `linkValorantAccount` rather than writing a row
// directly. The Riot ID is re-resolved server-side and must come back as the
// PUUID the leaderboard registered — a name alone can have moved to somebody
// else — the already-linked-elsewhere conflict is the same 409, and
// corroboration then lands the account at `discord_corroborated` on its own,
// because the PUUID it compares against is the one this Discord id is
// registered with.
const importValorantAccountFromLeaderboard = async ({ userId, displayName, audit }) => {
  const discordId = await linkedDiscordId(userId);
  if (!discordId) {
    throw new HttpError(
      400,
      "Connect your Discord account first. Quest finds your leaderboard registration by it.",
    );
  }

  let registration;
  try {
    registration = await checkDiscord(discordId);
  } catch (error) {
    logger.warn("Leaderboard lookup unavailable during account import.", {
      code: error?.code || null,
      status: error?.status || null,
    });
    throw new HttpError(503, UNAVAILABLE_MESSAGE);
  }

  const player = registration?.user || null;
  const name = player?.name || null;
  const tag = player?.tag || null;
  if (!registration?.exists || !name || !tag) {
    throw new HttpError(
      404,
      "No VALORANT leaderboard registration is linked to your Discord account. Connect your account with your Riot ID instead.",
    );
  }

  return linkValorantAccount({
    riotId: `${name}#${tag}`,
    userId,
    displayName,
    audit,
    // The leaderboard stores a Riot name as it was on the day of registration.
    // Riot names are reusable, so after a rename that old name can resolve to a
    // stranger's account — and linking by name alone would connect it at
    // `user_confirmed` without the player ever seeing it. The identifier the
    // leaderboard holds is what they actually registered, so the resolved
    // account has to be that one.
    expectedExternalId: normalizeExternalId(player?.puuid || ""),
    mismatchMessage:
      `Your leaderboard registration is under ${name}#${tag}, but that Riot ID now belongs to a different account. ` +
      "Enter your current Riot ID instead.",
  });
};

// Link a resolved VALORANT account to the signed-in user.
//
// The client sends only the Riot ID: the PUUID is re-resolved server-side so a
// crafted request cannot bind an identifier the user never saw confirmed.
const linkValorantAccount = async ({
  riotId,
  name,
  tag,
  userId,
  displayName,
  audit,
  expectedExternalId = null,
  mismatchMessage = null,
}) => {
  const resolved = await resolveValorantAccount({ riotId, name, tag, userId });

  if (expectedExternalId && resolved.externalId !== expectedExternalId) {
    throw new HttpError(409, mismatchMessage || NOT_FOUND_MESSAGE);
  }

  // The (game, external_id) unique index is the real boundary; this is the
  // friendly path to the same answer. Deliberately says nothing about who
  // holds it.
  const conflict = conflictFor(resolved);
  if (conflict) throw conflict;

  if (resolved.linkedToYou) {
    return { alreadyLinked: true, account: withoutExternalId(resolved) };
  }

  const corroborated = await corroborateWithDiscord({
    userId,
    externalId: resolved.externalId,
  });
  const verificationStatus = corroborated ? "discord_corroborated" : "user_confirmed";

  try {
    const linked = await prisma.$transaction(async (tx) => {
      const player = await ensurePlayerForUser(tx, { userId, displayName });
      const account = await tx.gameAccount.create({
        data: {
          id: crypto.randomUUID(),
          playerId: player.id,
          game: VALORANT,
          externalId: resolved.externalId,
          username: resolved.username,
          tagline: resolved.tagline,
          region: resolved.region,
          verificationStatus,
          status: "active",
          verifiedAt: new Date(),
          lastSyncedAt: new Date(),
        },
      });

      await recordAuditInTransaction(tx, {
        ...audit,
        action: "game_account.linked",
        targetType: "GameAccount",
        targetId: account.id,
        beforeData: null,
        afterData: {
          game: VALORANT,
          externalIdFingerprint: fingerprint(resolved.externalId),
          displayIdentity: `${resolved.username}#${resolved.tagline}`,
          verificationStatus,
          playerId: player.id,
        },
      });

      return { alreadyLinked: false, account: publicView(account) };
    });

    // The leaderboard follows the connection rather than being asked for
    // separately. Deliberately outside the transaction: it is a call to another
    // service, and holding a database transaction open across one is how a slow
    // dependency becomes a database problem. Its outcome rides along on the
    // response so the panel can say what happened, and it can never fail the
    // link that already committed.
    const leaderboard = await registerOnLeaderboard({
      userId,
      externalId: resolved.externalId,
    });

    return { ...linked, leaderboard };
  } catch (error) {
    // Two requests racing for the same PUUID: the database decides, and the
    // loser gets the same answer as the pre-check rather than a 500.
    if (error?.code === "P2002") {
      logger.warn("Game account link rejected as a duplicate.", {
        game: VALORANT,
        externalIdFingerprint: fingerprint(resolved.externalId),
      });
      throw new HttpError(409, LINKED_ELSEWHERE_MESSAGE);
    }
    throw error;
  }
};

// A reviewed request stays on the profile this long, so a player who asked for
// a change can see the answer — including an admin's reason for a refusal —
// without it sitting there forever.
const DECISION_VISIBLE_MS = 14 * 24 * 60 * 60 * 1000;

const changeRequestView = (request) => ({
  id: request.id,
  status: request.status,
  requestedIdentity: `${request.requestedUsername}#${request.requestedTagline}`,
  reason: request.reason,
  adminNote: request.adminNote,
  requestedAt: request.createdAt,
  reviewedAt: request.reviewedAt,
});

// The one change request the profile should mention: an open one, or a decision
// recent enough that the player may not have seen it. A withdrawn request is the
// player's own doing and needs no reminder.
const visibleChangeRequest = (request, now = Date.now()) => {
  if (!request) return null;
  if (request.status === "pending") return changeRequestView(request);
  if (request.status === "withdrawn" || !request.reviewedAt) return null;
  return now - new Date(request.reviewedAt).getTime() <= DECISION_VISIBLE_MS
    ? changeRequestView(request)
    : null;
};

// The signed-in user's linked accounts, for the profile panel and for roster
// readiness. Returns display data and state only — never the stable identifier.
const listGameAccountsForUser = async ({ userId }) => {
  const player = await prisma.player.findUnique({
    where: { userId },
    select: {
      publicId: true,
      gameAccounts: {
        where: { status: { not: "replaced" } },
        orderBy: { linkedAt: "desc" },
      },
      changeRequests: {
        where: { game: VALORANT },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });

  return {
    playerPublicId: player?.publicId ?? null,
    accounts: (player?.gameAccounts ?? []).map(publicView),
    changeRequest: visibleChangeRequest(player?.changeRequests?.[0] ?? null),
  };
};

// What the leaderboard holds for this user's Discord, for a player who has not
// connected an account yet. It lets the profile name the account ("Name#TAG")
// instead of offering a blind "import" the player has to take on trust.
//
// Never returns the stable identifier, and never answers for a Discord the
// caller does not hold: the lookup key is the caller's own linked snowflake.
const findLeaderboardRegistration = async ({ userId }) => {
  const discordId = await linkedDiscordId(userId);
  if (!discordId) return { discordConnected: false, unavailable: false, registration: null };

  let result;
  try {
    result = await checkDiscord(discordId);
  } catch (error) {
    logger.warn("Leaderboard lookup unavailable for the profile.", {
      code: error?.code || null,
      status: error?.status || null,
    });
    return { discordConnected: true, unavailable: true, registration: null };
  }

  const registered = result?.user || null;
  const externalId = normalizeExternalId(registered?.puuid || "");
  if (!result?.exists || !registered?.name || !registered?.tag || !externalId) {
    return { discordConnected: true, unavailable: false, registration: null };
  }

  const link = await describeExistingLink({ externalId, userId });
  return {
    discordConnected: true,
    unavailable: false,
    registration: {
      riotId: `${registered.name}#${registered.tag}`,
      linkedToYou: link.linkedToYou,
      linkedElsewhere: link.linkedElsewhere,
      unclaimedRecord: link.unclaimedRecord,
    },
  };
};

// Whether a looked-up account is the one this user's Discord is registered with
// on the leaderboard. Compared by stable identifier, so a Riot rename is still a
// match and a reused name is not.
//
// Advisory only. `null` means there is nothing to compare with — no Discord, no
// registration, or a leaderboard that did not answer — and must never be shown
// as a mismatch.
const compareWithLeaderboard = async ({ userId, externalId }) => {
  const discordId = await linkedDiscordId(userId);
  if (!discordId || !externalId) return null;
  try {
    const result = await checkDiscord(discordId);
    const registered = normalizeExternalId(result?.user?.puuid || "");
    if (!result?.exists || !registered) return null;
    return {
      matches: registered === normalizeExternalId(externalId),
      riotId: result.user.name && result.user.tag ? `${result.user.name}#${result.user.tag}` : null,
    };
  } catch {
    return null;
  }
};

const splitRiotId = (value) => {
  const raw = String(value || "").trim();
  const separator = raw.lastIndexOf("#");
  if (separator <= 0) {
    throw new HttpError(400, "Invalid Riot ID — expected Name#Tag.");
  }
  return { name: raw.slice(0, separator), tag: raw.slice(separator + 1) };
};

module.exports = {
  resolveValorantAccount,
  linkValorantAccount,
  registerOnLeaderboard,
  importValorantAccountFromLeaderboard,
  listGameAccountsForUser,
  visibleChangeRequest,
  findLeaderboardRegistration,
  compareWithLeaderboard,
  conflictFor,
  corroborateWithDiscord,
  ensurePlayerForUser,
  fingerprint,
  publicView,
  withoutExternalId,
  normalizeExternalId,
  describeExistingLink,
  translateUpstreamError,
  splitRiotId,
  CURRENT_STATUSES,
  RESOLVE_CACHE_TTL_SECONDS,
  UNAVAILABLE_MESSAGE,
  NOT_FOUND_MESSAGE,
  LINKED_ELSEWHERE_MESSAGE,
  UNCLAIMED_RECORD_MESSAGE,
  PREVIOUS_ACCOUNT_MESSAGE,
  VALORANT,
};
