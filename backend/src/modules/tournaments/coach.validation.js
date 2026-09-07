const { HttpError } = require("../../lib/http-error");
const { isValidEmail, normalizeEmail, normalizeText } = require("../../lib/validation");

const VALORANT_RIOT_ID_PATTERN = /^[^#\r\n]{3,16}#[A-Za-z0-9]{3,5}$/;

const parseCoachInput = (body = {}) => {
  let coach = body.coach;
  if (coach === undefined || coach === null || coach === "") return null;
  if (typeof coach !== "object") {
    try {
      coach = JSON.parse(String(coach));
    } catch {
      throw new HttpError(400, "Coach details must be valid JSON.");
    }
  }
  if (coach === null) return null;
  if (typeof coach !== "object" || Array.isArray(coach)) {
    throw new HttpError(400, "Coach details must be a single object.");
  }
  return Object.keys(coach).length > 0 ? coach : null;
};

const validateGameIdentities = ({ game, members }) => {
  const gameName = normalizeText(game) || "Game";
  const missingIdentity = members.some((member) => !normalizeText(member.riotId));
  if (missingIdentity) {
    throw new HttpError(400, `${gameName} IGN or player ID is required for every roster member.`);
  }
  if (
    gameName.toLowerCase().includes("valorant") &&
    members.some((member) => !VALORANT_RIOT_ID_PATTERN.test(normalizeText(member.riotId)))
  ) {
    throw new HttpError(
      400,
      "Every Valorant Riot ID must include the game name and # tagline, for example PlayerName#123."
    );
  }
};

const normalizeCoachSubmission = ({ tournament, body = {}, coachInput = parseCoachInput(body) }) => {
  if (!coachInput) {
    if (tournament.coachRequired) {
      throw new HttpError(400, "A complete coach is required for this tournament.");
    }
    return null;
  }

  if (!tournament.allowCoach) {
    throw new HttpError(400, "This tournament does not accept coach details.");
  }

  const coach = {
    name: normalizeText(coachInput.name),
    email: normalizeEmail(coachInput.email),
    phone: normalizeText(coachInput.phone),
    // Filled from the coach's connected Discord account during submission, not
    // from the request. A coach is on the roster to be reachable during an
    // event, and a handle somebody typed for them does not establish that.
    discord: null,
    riotId: normalizeText(coachInput.gameId || coachInput.riotId),
  };

  if (!coach.name || !isValidEmail(coach.email) || !coach.phone || !coach.riotId) {
    throw new HttpError(400, "Every coach needs a name, valid email, contact number, and Riot ID or IGN.");
  }
  if (
    coach.name.length > 100 ||
    coach.email.length > 254 ||
    coach.phone.length > 50 ||
    coach.riotId.length > 100
  ) {
    throw new HttpError(400, "One or more coach fields exceed the allowed length.");
  }

  validateGameIdentities({ game: tournament.game, members: [coach] });
  return coach;
};

module.exports = { normalizeCoachSubmission, parseCoachInput };
