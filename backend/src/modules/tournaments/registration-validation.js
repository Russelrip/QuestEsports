const { prisma } = require("../../lib/prisma");
const { HttpError } = require("../../lib/http-error");
const { isValidEmail, normalizeEmail, normalizeText } = require("../../lib/validation");
const { normalizeCoachSubmission, parseCoachInput } = require("./coach.validation");
const { getLinkedDiscordForUsers, requireLinkedDiscord } = require("../auth/discord-link.service");
const { assertNoLocalCoachPlayerRoleConflict } = require("./role-conflict.service");
const {
  normalizeBoolean,
  VALORANT_RIOT_ID_PATTERN,
  parseJson,
  buildPersistedRegistrationMembers,
} = require("./registration-shared");

const validateConfiguredFields = ({ definitions, entryData, members }) => {
  const validateValue = (field, value) => {
    const normalized = value === undefined || value === null ? "" : String(value).trim();
    if (field.required && !normalized) throw new HttpError(400, `${field.label} is required.`);
    if (normalized.length > 500) throw new HttpError(400, `${field.label} is too long.`);
    if (normalized && field.type === "number" && !Number.isFinite(Number(normalized))) {
      throw new HttpError(400, `${field.label} must be a number.`);
    }
    if (normalized && field.type === "select" && !field.options.includes(normalized)) {
      throw new HttpError(400, `${field.label} has an invalid selection.`);
    }
    if (normalized && field.type === "checkbox" && !["true", "false", "1", "0", "on", "off"].includes(normalized.toLowerCase())) {
      throw new HttpError(400, `${field.label} must be checked or unchecked.`);
    }
    if (normalized && field.type === "checkbox" && field.required && !["true", "1", "on"].includes(normalized.toLowerCase())) {
      throw new HttpError(400, `${field.label} must be accepted.`);
    }
    if (normalized && field.type === "url") {
      let parsed;
      try { parsed = new URL(normalized); } catch { parsed = null; }
      if (!parsed || !["http:", "https:"].includes(parsed.protocol)) {
        throw new HttpError(400, `${field.label} must be a valid HTTP or HTTPS URL.`);
      }
    }
    if (field.type === "checkbox") return ["true", "1", "on"].includes(normalized.toLowerCase());
    return normalized;
  };

  const normalizedEntry = {};
  for (const field of definitions.filter((field) => field.scope === "entry")) {
    normalizedEntry[field.key] = validateValue(field, entryData[field.key]);
  }
  const normalizedMembers = members.map((member) => {
    const data = {};
    for (const field of definitions.filter((field) => field.scope === "member")) {
      data[field.key] = validateValue(field, member.additionalData?.[field.key]);
    }
    return { ...member, additionalData: data };
  });
  return { entryData: normalizedEntry, members: normalizedMembers };
};

const isGameIdentityField = (field, game) => {
  const fieldText = `${field?.key || ""} ${field?.label || ""}`.toLowerCase();
  const gameWords = normalizeText(game)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 3);
  return /(?:riot|ign|in[ -]?game|player[ -]?id|game[ -]?id|uid)/i.test(fieldText) ||
    (/\bid\b/i.test(fieldText.replace(/[_-]/g, " ")) && gameWords.some((word) => fieldText.includes(word)));
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

const assertCoachInputAllowed = ({ tournament, body }) => {
  const coachInput = parseCoachInput(body);
  if (coachInput && !tournament.allowCoach) {
    throw new HttpError(400, "This tournament does not accept coach details.");
  }
  return coachInput;
};

// Roster Discord handles are never typed in. The captain's comes from their own
// linked account; everyone else's is resolved from the Quest account that owns
// their roster email.
//
// A roster member with no Quest account, or one whose account has no link, ends
// up with no handle at all, and that is correct rather than a failure: a captain
// registering a LAN entrant cannot connect Discord on their behalf. The
// tournament's `discordRequired` flag stays the single place that decides
// whether a missing link blocks registration, which is what keeps this resolver
// from quietly becoming a second, competing gate.
const attachConnectedDiscordIdentities = async ({ user, submission }) => {
  const captain = await requireLinkedDiscord(
    user.id,
    "Connect your Discord account before registering for a tournament."
  );
  // The snowflake is the fallback because it always exists and always resolves
  // to the right person; a blank cached username would leave an organiser with
  // nothing to search for.
  const captainHandle = captain.discordUsername || captain.discordId;

  const rosterEmails = [
    ...submission.members.map((member) => member.email),
    submission.coach?.email,
  ]
    .filter(Boolean)
    .map((email) => normalizeEmail(email));

  const accounts = rosterEmails.length > 0
    ? await prisma.user.findMany({
      where: { emailNormalized: { in: [...new Set(rosterEmails)] } },
      select: { id: true, emailNormalized: true },
    })
    : [];
  const linkedByUserId = await getLinkedDiscordForUsers(
    accounts.map((account) => account.id)
  );
  const handleByEmail = new Map(
    accounts
      .map((account) => {
        const identity = linkedByUserId.get(account.id);
        return [
          account.emailNormalized,
          identity ? identity.discordUsername || identity.discordId : null,
        ];
      })
      .filter(([, handle]) => Boolean(handle))
  );
  const handleFor = (email) => handleByEmail.get(normalizeEmail(email)) || null;

  return {
    ...submission,
    discord: captainHandle,
    members: submission.members.map((member) => (member.role === "CAPTAIN"
      ? { ...member, discord: captainHandle }
      : { ...member, discord: handleFor(member.email) })),
    coach: submission.coach
      ? { ...submission.coach, discord: handleFor(submission.coach.email) }
      : submission.coach,
  };
};

const normalizeRegistrationSubmission = ({ tournament, body, user }) => {
  const fullName = normalizeText(body.fullName || body.captainName) ||
    [user.firstName, user.lastName].filter(Boolean).join(" ").trim();
  const displayName = tournament.entryType === "solo"
    ? fullName
    : normalizeText(body.teamName);
  const phone = normalizeText(body.phone || body.captainPhone || user.phone);
  // Deliberately not read from the body. Roster Discord handles come from
  // connected accounts and are filled in by attachConnectedDiscordIdentities.
  const discord = null;
  const contactEmail = normalizeEmail(body.contactEmail || user.email);
  const country = normalizeText(body.country) || "Sri Lanka";
  const teamTag = tournament.entryType === "solo"
    ? null
    : normalizeText(body.teamTag) || displayName?.slice(0, 12).toUpperCase();
  const rulebookAccepted = normalizeBoolean(body.rulebookAccepted ?? body.rulebook);
  const falsityWarningAccepted = normalizeBoolean(body.falsityWarningAccepted ?? body.falsityWarning);
  const additionalData = parseJson(body.additionalData, {}, "Additional registration data");
  const captainAdditionalData = parseJson(
    body.captainAdditionalData,
    {},
    "Captain registration data"
  );
  const coach = normalizeCoachSubmission({ tournament, body });
  let requestedMembers = parseJson(body.members, [], "Roster members");
  if (!Array.isArray(requestedMembers)) throw new HttpError(400, "Roster members must be a list.");

  if (!displayName || !fullName || !phone || !isValidEmail(contactEmail) || !rulebookAccepted || !falsityWarningAccepted) {
    throw new HttpError(400, "Complete the required registration details and agreements.");
  }
  if (
    displayName.length > 100 ||
    fullName.length > 100 ||
    phone.length > 50 ||
    contactEmail.length > 254 ||
    (teamTag && teamTag.length > 12) ||
    country.length > 100
  ) {
    throw new HttpError(400, "One or more registration fields exceed the allowed length.");
  }

  if (tournament.entryType === "solo") requestedMembers = [];
  const captainGameId = normalizeText(body.gameId || body.captainRiotId) || null;
  const registrationFields = Array.isArray(tournament.registrationFields)
    ? tournament.registrationFields
    : [];
  for (const field of registrationFields.filter(
    (field) => field.scope === "entry" && isGameIdentityField(field, tournament.game)
  )) {
    additionalData[field.key] = captainGameId;
  }
  for (const field of registrationFields.filter(
    (field) => field.scope === "member" && isGameIdentityField(field, tournament.game)
  )) {
    captainAdditionalData[field.key] = captainGameId;
  }
  const normalizedMembers = requestedMembers.map((member, index) => ({
    role: normalizeText(member.role).toUpperCase() === "SUBSTITUTE" ? "SUBSTITUTE" : "PLAYER",
    order: index + 1,
    name: normalizeText(member.name),
    email: normalizeEmail(member.email),
    // Resolved from the member's connected account at submission time.
    discord: null,
    riotId: normalizeText(member.gameId || member.riotId) || null,
    additionalData: {
      ...(member.additionalData || {}),
      ...Object.fromEntries(
        registrationFields
          .filter((field) => field.scope === "member" && isGameIdentityField(field, tournament.game))
          .map((field) => [field.key, normalizeText(member.gameId || member.riotId) || null])
      ),
    },
  }));
  if (normalizedMembers.some((member) => !member.name || !isValidEmail(member.email))) {
    throw new HttpError(400, "Every roster member needs a name and valid email.");
  }
  if (normalizedMembers.some((member) =>
    member.name.length > 100 ||
    member.email.length > 254 ||
    (member.riotId && member.riotId.length > 100)
  )) {
    throw new HttpError(400, "One or more roster fields exceed the allowed length.");
  }
  const playerCount = 1 + normalizedMembers.filter((member) => member.role === "PLAYER").length;
  const substituteCount = normalizedMembers.filter((member) => member.role === "SUBSTITUTE").length;
  if (playerCount < tournament.minRosterSize || playerCount > tournament.maxRosterSize || substituteCount > tournament.maxSubstitutes) {
    const requiredPlayers = tournament.minRosterSize === tournament.maxRosterSize
      ? `exactly ${tournament.minRosterSize}`
      : `${tournament.minRosterSize}-${tournament.maxRosterSize}`;
    throw new HttpError(
      400,
      `This event requires ${requiredPlayers} active players, including the captain, and allows up to ${tournament.maxSubstitutes} substitutes. Your roster has ${playerCount} active players and ${substituteCount} substitutes.`
    );
  }

  const configured = validateConfiguredFields({
    definitions: registrationFields,
    entryData: additionalData,
    members: [
      {
        role: "CAPTAIN",
        order: 0,
        name: fullName,
        email: normalizeEmail(user.email),
        discord,
        riotId: captainGameId,
        additionalData: captainAdditionalData,
      },
      ...normalizedMembers,
    ],
  });
  const [configuredCaptain, ...configuredRosterMembers] = configured.members;
  const primaryGameId = captainGameId;
  const registrationMembers = [
    { ...configuredCaptain, riotId: primaryGameId },
    ...configuredRosterMembers,
  ];
  assertNoLocalCoachPlayerRoleConflict(
    buildPersistedRegistrationMembers({ members: registrationMembers, coach })
  );
  const emails = [normalizeEmail(user.email), ...normalizedMembers.map((member) => member.email)];
  if (new Set(emails).size !== emails.length) throw new HttpError(400, "Roster emails must be unique.");
  validateGameIdentities({ game: tournament.game, members: registrationMembers });

  return {
    fullName,
    displayName,
    phone,
    discord,
    contactEmail,
    country,
    teamTag,
    rulebookAccepted,
    falsityWarningAccepted,
    configuredEntryData: configured.entryData,
    primaryGameId,
    members: registrationMembers,
    coach,
  };
};

// A team registration must end up with a logo, which is not the same as
// requiring an upload.
//
// The saved team a registration links to may already have one — reusing a team
// is the common path, and `syncSavedTeamFromRegistration` adopts that logo onto
// the registration afterwards. Demanding a fresh file there would make captains
// re-upload something Quest already holds, and the ones who no longer have the
// file would be stuck.
//
// The registration is not linked to the saved team yet at this point, so this
// resolves it the same way the sync does: by captain and team name.
//
// A retry is exempt outright, not merely when it already has a logo. A retry is
// a captain coming back to pay for a registration Quest already accepted, and
// applying a new rule at that moment strands them at the checkout for something
// that was not asked of them when they entered. The rule belongs at the door.
const assertTeamLogoAvailable = async ({ tournament, user, teamName, uploaded, isRetry }) => {
  if (tournament.entryType !== "team") return;
  if (uploaded || isRetry) return;

  const savedTeam = typeof prisma.savedTeam?.findUnique === "function"
    ? await prisma.savedTeam.findUnique({
        where: { captainUserId_name: { captainUserId: user.id, name: teamName } },
        select: { logoName: true },
      })
    : null;
  if (savedTeam?.logoName) return;

  throw new HttpError(
    400,
    "A team logo is required. Upload one, or reuse a saved team that already has a logo."
  );
};

module.exports = {
  validateConfiguredFields,
  validateGameIdentities,
  assertCoachInputAllowed,
  attachConnectedDiscordIdentities,
  normalizeRegistrationSubmission,
  assertTeamLogoAvailable,
};
