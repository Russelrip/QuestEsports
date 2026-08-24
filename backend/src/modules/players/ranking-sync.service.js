const crypto = require("crypto");
const { prisma } = require("../../lib/prisma");
const { logger } = require("../../lib/logger");
const leaderboard = require("../valorant-leaderboard/service");

// Refreshes the cached ranking projection from the external leaderboard.
//
// One pass, not one call per player. The upstream is rate limited and paging
// the whole board once is cheaper than N lookups the moment Quest has more than
// a handful of players — and it is the only way to know a player's POSITION,
// which is a property of the board rather than of the player.
//
// Every failure mode here degrades to "keep the previous cache". A ranking is
// decoration on a profile; it must never be the reason a profile 500s, and a
// half-finished sync must never blank ranks that were correct a minute ago.

const PAGE_SIZE = 200;
const MAX_PAGES = 25; // 5,000 entries — the same ceiling the search snapshot uses.

// Pages the board into an ordered list. Position is the 1-based index across
// pages, so it is only meaningful if the pages were walked in order and none
// was skipped — hence `complete`, which callers must respect before writing
// positions.
const loadBoard = async () => {
  const entries = [];
  let page = 1;
  let totalPages = 1;

  while (page <= totalPages && page <= MAX_PAGES) {
    const result = await leaderboard.listLeaderboard({ page, perPage: PAGE_SIZE });
    totalPages = result.totalPages ?? 1;
    entries.push(...(result.entries ?? []));
    page += 1;
  }

  return { entries, complete: totalPages <= MAX_PAGES };
};

const toInt = (value) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
};

// The upstream returns peak rank as a nested object whose exact shape belongs
// to that service. Read defensively and store the readable parts rather than
// mirroring a structure Quest does not own.
const readPeak = (entry) => {
  const peak = entry?.peakRank;
  if (!peak || typeof peak !== "object") {
    return { peakTier: typeof peak === "string" ? peak : null, peakSeason: entry?.peakSeason ?? null };
  }
  return {
    peakTier: peak.tier ?? peak.patched_tier ?? peak.currenttierpatched ?? null,
    peakSeason: peak.season ?? entry?.peakSeason ?? null,
  };
};

const syncValorantRankings = async ({ now = new Date() } = {}) => {
  // Only accounts that can actually be matched: active, and this title.
  const accounts = await prisma.gameAccount.findMany({
    where: { game: "valorant", status: "active" },
    select: { playerId: true, externalId: true },
  });

  if (accounts.length === 0) {
    return { scanned: 0, matched: 0, updated: 0, skipped: "no_accounts" };
  }

  let board;
  try {
    board = await loadBoard();
  } catch (error) {
    // Upstream unavailable. The existing cache stays exactly as it was, which
    // is the entire reason the cache exists.
    logger.warn("Ranking sync skipped: leaderboard unavailable", { error });
    return { scanned: accounts.length, matched: 0, updated: 0, skipped: "leaderboard_unavailable" };
  }

  const byPuuid = new Map();
  board.entries.forEach((entry, index) => {
    if (entry?.puuid) {
      byPuuid.set(entry.puuid, { entry, position: index + 1 });
    }
  });

  let matched = 0;
  let updated = 0;

  for (const account of accounts) {
    const hit = byPuuid.get(account.externalId);
    if (!hit) continue;
    matched += 1;

    const { entry, position } = hit;
    const { peakTier, peakSeason } = readPeak(entry);
    const data = {
      // A position is only trustworthy if the whole board was walked. On a
      // truncated read the rank is stored as null rather than as a number that
      // would be quietly wrong.
      position: board.complete ? position : null,
      elo: toInt(entry.elo),
      tier: entry.currentTier ?? null,
      rankInTier: toInt(entry.rankInTier),
      peakTier,
      peakSeason,
      lastPlayedAt: entry.lastPlayed ? new Date(entry.lastPlayed) : null,
      syncedAt: now,
    };

    try {
      await prisma.playerRanking.upsert({
        where: { playerId_game: { playerId: account.playerId, game: "valorant" } },
        create: { id: crypto.randomUUID(), playerId: account.playerId, game: "valorant", ...data },
        update: data,
      });
      updated += 1;
    } catch (error) {
      // One bad row must not abandon the rest of the sync.
      logger.warn("Ranking sync failed for one player", { playerId: account.playerId, error });
    }
  }

  return {
    scanned: accounts.length,
    matched,
    updated,
    boardSize: board.entries.length,
    truncated: !board.complete,
  };
};

module.exports = {
  PAGE_SIZE,
  MAX_PAGES,
  loadBoard,
  syncValorantRankings,
};
