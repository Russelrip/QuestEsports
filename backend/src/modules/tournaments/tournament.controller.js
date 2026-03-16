const crypto = require("crypto");
const { db } = require("../../config/database");
const { asyncHandler } = require("../../lib/async-handler");
const { HttpError } = require("../../lib/http-error");
const {
  normalizeEmail,
  normalizeText,
  isValidEmail,
} = require("../../lib/validation");

const normalizeBooleanFlag = (value) => value === true || value === "true";

const requiredPlayerIndexes = [2, 3, 4, 5];

const buildRequiredPlayers = (body) =>
  requiredPlayerIndexes.map((index) => ({
    order: index - 1,
    name: normalizeText(body[`player${index}Name`]),
    discord: normalizeText(body[`player${index}Discord`]),
    riotId: normalizeText(body[`player${index}RiotId`]),
  }));

const buildOptionalMembers = (body) => {
  const substitutes = [1, 2]
    .map((index) => ({
      role: "SUBSTITUTE",
      order: index,
      name: normalizeText(body[`sub${index}Name`]),
      discord: normalizeText(body[`sub${index}Discord`]) || null,
      riotId: normalizeText(body[`sub${index}RiotId`]) || null,
    }))
    .filter((member) => member.name);

  const coachName = normalizeText(body.coachName);
  const coach = coachName
    ? [
        {
          role: "COACH",
          order: 1,
          name: coachName,
          discord: normalizeText(body.coachDiscord) || null,
          riotId: normalizeText(body.coachRiotId) || null,
        },
      ]
    : [];

  return [...substitutes, ...coach];
};

const getTournamentRegistrationStatus = asyncHandler(async (req, res) => {
  const tournamentSlug = normalizeText(req.params.slug);

  if (!tournamentSlug) {
    throw new HttpError(400, "Tournament slug is required.");
  }

  const tournament = db
    .prepare(
      `
        SELECT id
        FROM tournaments
        WHERE slug = ?
        LIMIT 1
      `
    )
    .get(tournamentSlug);

  if (!tournament) {
    throw new HttpError(404, "Tournament not found.");
  }

  if (!req.user?.email) {
    res.status(200).json({
      success: true,
      isRegistered: false,
    });
    return;
  }

  const existingRegistration = db
    .prepare(
      `
        SELECT id
        FROM team_registrations
        WHERE tournament_id = ? AND captain_email = ?
        LIMIT 1
      `
    )
    .get(tournament.id, normalizeEmail(req.user.email));

  res.status(200).json({
    success: true,
    isRegistered: Boolean(existingRegistration),
  });
});

const submitTournamentRegistration = asyncHandler(async (req, res) => {
  const tournamentSlug = normalizeText(req.body.tournament);
  const teamName = normalizeText(req.body.teamName);
  const captainName = normalizeText(req.body.captainName);
  const captainEmail = normalizeEmail(req.body.captainEmail);
  const captainPhone = normalizeText(req.body.captainPhone);
  const captainDiscord = normalizeText(req.body.captainDiscord);
  const captainRiotId = normalizeText(req.body.captainRiotId);
  const contactEmail = normalizeEmail(req.body.contactEmail);
  const rulebookAccepted = normalizeBooleanFlag(req.body.rulebook);
  const falsityWarningAccepted = normalizeBooleanFlag(req.body.falsityWarning);
  const requiredPlayers = buildRequiredPlayers(req.body);
  const optionalMembers = buildOptionalMembers(req.body);

  if (
    !tournamentSlug ||
    !teamName ||
    !captainName ||
    !captainPhone ||
    !captainDiscord ||
    !captainRiotId ||
    !isValidEmail(captainEmail) ||
    !isValidEmail(contactEmail) ||
    !rulebookAccepted ||
    !falsityWarningAccepted ||
    requiredPlayers.some((player) => !player.name || !player.discord || !player.riotId)
  ) {
    throw new HttpError(
      400,
      "Please fill all required fields and accept the agreements."
    );
  }

  const tournament = db
    .prepare(
      `
        SELECT id, slug, title, is_active AS isActive
        FROM tournaments
        WHERE slug = ?
        LIMIT 1
      `
    )
    .get(tournamentSlug);

  if (!tournament || !tournament.isActive) {
    throw new HttpError(400, "Selected tournament is not available.");
  }

  const existingRegistration = db
    .prepare(
      `
        SELECT id
        FROM team_registrations
        WHERE tournament_id = ? AND (team_name = ? OR captain_email = ?)
        LIMIT 1
      `
    )
    .get(tournament.id, teamName, captainEmail);

  if (existingRegistration) {
    throw new HttpError(
      400,
      "This team or captain email is already registered for the selected tournament."
    );
  }

  const members = [
    {
      role: "CAPTAIN",
      order: 1,
      name: captainName,
      discord: captainDiscord,
      riotId: captainRiotId,
    },
    ...requiredPlayers.map((player) => ({
      role: "PLAYER",
      ...player,
    })),
    ...optionalMembers,
  ];

  const registrationId = crypto.randomUUID();
  const insertRegistration = db.prepare(`
    INSERT INTO team_registrations (
      id,
      tournament_id,
      team_name,
      captain_name,
      captain_email,
      captain_phone,
      captain_discord,
      captain_riot_id,
      contact_email,
      team_logo_name,
      rulebook_accepted,
      falsity_warning_accepted
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertMember = db.prepare(`
    INSERT INTO registration_members (
      id,
      registration_id,
      role,
      member_order,
      name,
      discord,
      riot_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const saveRegistration = db.transaction(() => {
    insertRegistration.run(
      registrationId,
      tournament.id,
      teamName,
      captainName,
      captainEmail,
      captainPhone,
      captainDiscord,
      captainRiotId,
      contactEmail,
      req.file ? req.file.filename : null,
      rulebookAccepted ? 1 : 0,
      falsityWarningAccepted ? 1 : 0
    );

    for (const member of members) {
      insertMember.run(
        crypto.randomUUID(),
        registrationId,
        member.role,
        member.order,
        member.name,
        member.discord,
        member.riotId
      );
    }
  });

  saveRegistration();

  res.status(201).json({
    success: true,
    message: "Tournament registration submitted successfully.",
  });
});

module.exports = {
  getTournamentRegistrationStatus,
  submitTournamentRegistration,
};
