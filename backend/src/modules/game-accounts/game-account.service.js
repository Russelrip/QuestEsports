const { prisma } = require("../../lib/prisma");
const { HttpError } = require("../../lib/http-error");
const { logger } = require("../../lib/logger");
const cache = require("../../lib/cache");
const { normalizeRiotId } = require("../valorant/valorant.validation");
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
      return new HttpError(400, "Invalid Riot ID — expected Name#Tag.");
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

// Whether this PUUID can still be claimed, and by whom. Deliberately returns a
// boolean and the caller's own linkage only: telling one signed-in user which
// other account holds a PUUID would turn this into a lookup directory.
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
    return { available: true, linkedToYou: false, linkedElsewhere: false };
  }

  const linkedToYou = Boolean(userId) && existing.player?.userId === userId;
  return {
    available: false,
    linkedToYou,
    linkedElsewhere: !linkedToYou,
    status: linkedToYou ? existing.status : undefined,
    verificationStatus: linkedToYou ? existing.verificationStatus : undefined,
  };
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
  normalizeExternalId,
  describeExistingLink,
  translateUpstreamError,
  splitRiotId,
  RESOLVE_CACHE_TTL_SECONDS,
  UNAVAILABLE_MESSAGE,
  NOT_FOUND_MESSAGE,
  VALORANT,
};
