const crypto = require("crypto");
const { HttpError } = require("../../lib/http-error");

// Riot game names may contain spaces — "QT Russel#Senu" is a perfectly ordinary
// Riot ID — so only `#` and control characters are excluded. Leading and
// trailing whitespace is trimmed before this is applied, so a name is never
// left with edge spaces.
//
// Taglines are alphanumeric and never contain whitespace, which is also what
// keeps the separator unambiguous.
const RIOT_NAME_PATTERN = /^[^#\r\n\t]{1,32}$/;
const RIOT_TAG_PATTERN = /^[^#\s]{1,16}$/;
const SUPPORTED_FORMATS = new Set(["bo1", "bo3", "bo5"]);

const isValidRiotId = ({ name, tag }) =>
  RIOT_NAME_PATTERN.test(name) &&
  // A name of only whitespace satisfies the pattern but is not a name.
  name.trim().length > 0 &&
  RIOT_TAG_PATTERN.test(tag);

const normalizeRiotId = ({ name, tag }) => {
  const cleanedName = String(name || "").trim();
  const cleanedTag = String(tag || "").trim();
  if (!isValidRiotId({ name: cleanedName, tag: cleanedTag })) {
    throw new HttpError(400, "Invalid Riot ID — expected Name#Tag.");
  }
  return { name: cleanedName, tag: cleanedTag };
};

const parseRiotId = (value) => {
  const normalized = String(value || "").trim();
  // Split on the LAST separator: a tag never contains `#`, so anything before
  // the final one belongs to the name.
  const separator = normalized.lastIndexOf("#");
  if (separator <= 0) {
    throw new HttpError(400, "Invalid Riot ID — expected Name#Tag.");
  }
  return normalizeRiotId({
    name: normalized.slice(0, separator),
    tag: normalized.slice(separator + 1),
  });
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
  isValidRiotId,
  generateExternalKey,
  deriveManualSeriesExternalKey,
  assertSupportedFormat,
  SUPPORTED_FORMATS,
};
