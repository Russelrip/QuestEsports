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

const assertSupportedFormat = (format) => {
  if (!SUPPORTED_FORMATS.has(format)) {
    throw new HttpError(400, "Unsupported VALORANT series format.");
  }
};

module.exports = {
  parseRiotId,
  normalizeRiotId,
  generateExternalKey,
  assertSupportedFormat,
  SUPPORTED_FORMATS,
};
