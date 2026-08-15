const crypto = require("crypto");
const { HttpError } = require("../../lib/http-error");

const RIOT_ID_PATTERN = /^([^#\s]{1,32})#([^#\s]{1,16})$/;
const SUPPORTED_FORMATS = new Set(["bo1", "bo3", "bo5"]);

const normalizeRiotId = ({ name, tag }) => {
  const cleanedName = String(name || "").trim();
  const cleanedTag = String(tag || "").trim();
  if (!RIOT_ID_PATTERN.test(`${cleanedName}#${cleanedTag}`)) {
    throw new HttpError(400, "Invalid Riot ID — expected Name#Tag.");
  }
  return { name: cleanedName, tag: cleanedTag };
};

const parseRiotId = (value) => {
  const normalized = String(value || "").trim();
  const match = RIOT_ID_PATTERN.exec(normalized);
  if (!match) {
    throw new HttpError(400, "Invalid Riot ID — expected Name#Tag.");
  }
  return { name: match[1], tag: match[2] };
};

const generateExternalKey = () => crypto.randomUUID();

// Manual-result series are idempotent on a deterministic external key: the same
// payload must converge on the same FastAPI series (create-or-get by
// `external_quest_series_id`), so a retry after FastAPI committed the ELO but
// before the Quest projection was written can never re-apply it. The sha256 hex
// digest (64 chars) fits FastAPI's `external_quest_series_id` max_length=64.
const deriveManualSeriesExternalKey = ({
  teamAUuid,
  teamBUuid,
  format,
  playedAt,
  ratingMode,
  winnerUuid,
  teamAMapsWon,
  teamBMapsWon,
}) => {
  const canonical = JSON.stringify([
    teamAUuid,
    teamBUuid,
    format,
    new Date(playedAt).toISOString(),
    ratingMode,
    winnerUuid,
    teamAMapsWon,
    teamBMapsWon,
  ]);
  return crypto.createHash("sha256").update(canonical).digest("hex");
};

const assertSupportedFormat = (format) => {
  if (!SUPPORTED_FORMATS.has(format)) {
    throw new HttpError(400, "Unsupported VALORANT series format.");
  }
};

module.exports = {
  parseRiotId,
  normalizeRiotId,
  generateExternalKey,
  deriveManualSeriesExternalKey,
  assertSupportedFormat,
  SUPPORTED_FORMATS,
};
