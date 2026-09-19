const { prisma } = require("../../lib/prisma");
const { HttpError } = require("../../lib/http-error");
const {
  normalizeText,
  normalizeSlug,
  normalizeInteger,
  normalizeOptionalUrl,
} = require("../../lib/validation");
const {
  REGISTRATION_MODES,
  ENTRY_TYPES,
  PAYMENT_METHODS,
  REGISTRATION_FIELD_TYPES,
  REGISTRATION_FIELD_SCOPES,
  normalizeBooleanFlag,
  parseOptionalDateValue,
  parseTournamentDateValue,
  parseTournamentStatus,
} = require("./tournament-shared");
const { normalizeChallongeUrl } = require("./tournament-mapping");

const normalizeTournamentInput = ({ body, existingTournament }) => {
  const title = normalizeText(body.title);
  const titleFallback = existingTournament?.title || "";
  const slug =
    normalizeSlug(body.slug) ||
    normalizeSlug(title) ||
    normalizeSlug(titleFallback);
  const game = normalizeText(body.game).toLowerCase();
  const gameCategoryId = normalizeText(body.gameCategoryId) || null;
  const organizer = normalizeText(body.organizer ?? existingTournament?.organizer) || "Quest E-sports";
  const country = normalizeText(body.country ?? existingTournament?.country) || "Sri Lanka";
  const location = normalizeText(body.location ?? existingTournament?.location) || "TBA";
  const normalizedDisplayPriority = normalizeInteger(body.displayPriority);
  const displayPriority =
    normalizedDisplayPriority ?? existingTournament?.displayPriority ?? 100;
  const shortDescription = normalizeText(body.shortDescription);
  const fullDescription = normalizeText(body.fullDescription);
  const rules = normalizeText(body.rules);
  const rulebookId = normalizeText(body.rulebookId) || null;
  const format = normalizeText(body.format);
  const registrationMode = normalizeText(
    body.registrationMode || existingTournament?.registrationMode || "open_entry"
  ).toLowerCase();
  const entryType = normalizeText(
    body.entryType || existingTournament?.entryType || "team"
  ).toLowerCase();
  const seriesId = normalizeText(body.seriesId ?? existingTournament?.seriesId) || null;
  const seriesOrder =
    normalizeInteger(body.seriesOrder) ?? existingTournament?.seriesOrder ?? 100;
  const prizePool = normalizeText(body.prizePool);
  const teamSize = normalizeInteger(body.teamSize);
  // A blank capacity means unlimited registrations. An omitted key is not the
  // same statement: it keeps the tournament's current ceiling so a partial
  // update can never uncap a tournament by accident.
  const maxTeamsProvided = body.maxTeams !== undefined && body.maxTeams !== null;
  // `String(value || "")` would turn a numeric 0 into a blank, and 0 is a
  // rejected capacity rather than an unlimited one.
  const maxTeamsInput = maxTeamsProvided ? String(body.maxTeams).trim() : "";
  const maxTeams = maxTeamsProvided
    ? (maxTeamsInput ? normalizeInteger(maxTeamsInput) : null)
    : existingTournament?.maxTeams ?? null;
  const waitlistEnabled = normalizeBooleanFlag(
    body.waitlistEnabled ?? existingTournament?.waitlistEnabled
  );
  const minRosterSize =
    normalizeInteger(body.minRosterSize) ??
    existingTournament?.minRosterSize ??
    teamSize ??
    1;
  const maxRosterSize =
    normalizeInteger(body.maxRosterSize) ??
    existingTournament?.maxRosterSize ??
    teamSize ??
    1;
  const maxSubstitutes =
    normalizeInteger(body.maxSubstitutes) ??
    existingTournament?.maxSubstitutes ??
    0;
  const allowCoach = normalizeBooleanFlag(
    body.allowCoach ?? existingTournament?.allowCoach
  );
  const coachRequired = normalizeBooleanFlag(
    body.coachRequired ?? existingTournament?.coachRequired
  );
  const discordRequired = normalizeBooleanFlag(
    body.discordRequired ?? existingTournament?.discordRequired
  );
  const autoApproveRegistrations = normalizeBooleanFlag(
    body.autoApproveRegistrations ?? existingTournament?.autoApproveRegistrations
  );
  const showBracketPublicly = normalizeBooleanFlag(
    body.showBracketPublicly ?? existingTournament?.showBracketPublicly ?? true
  );
  const reservationMinutes =
    normalizeInteger(body.reservationMinutes) ??
    existingTournament?.reservationMinutes ??
    15;
  const bankTransferReviewMinutes =
    normalizeInteger(body.bankTransferReviewMinutes) ??
    existingTournament?.bankTransferReviewMinutes ??
    1440;
  const registrationFeeAmount = Number.parseFloat(
    String(
      body.registrationFeeAmount ??
        existingTournament?.registrationFeeAmount ??
        0
    )
  );
  const registrationFeeCurrency = normalizeText(
    body.registrationFeeCurrency ||
      existingTournament?.registrationFeeCurrency ||
      "LKR"
  ).toUpperCase();
  const paymentMethod = normalizeText(
    body.paymentMethod ||
      existingTournament?.paymentMethod ||
      (registrationFeeAmount > 0 ? "payhere" : "free")
  ).toLowerCase();
  const bankName = normalizeText(body.bankName ?? existingTournament?.bankName) || null;
  const bankBranch = normalizeText(body.bankBranch ?? existingTournament?.bankBranch) || null;
  const bankAccountName =
    normalizeText(body.bankAccountName ?? existingTournament?.bankAccountName) || null;
  const bankAccountNumber =
    normalizeText(body.bankAccountNumber ?? existingTournament?.bankAccountNumber) || null;
  let registrationFeeTiers;
  try {
    registrationFeeTiers = Array.isArray(body.registrationFeeTiers)
      ? body.registrationFeeTiers
      : JSON.parse(
          String(
            body.registrationFeeTiers ??
              JSON.stringify(existingTournament?.registrationFeeTiers || [])
          )
        );
  } catch {
    throw new HttpError(400, "Registration fee tiers must be valid JSON.");
  }
  let registrationFields;
  try {
    registrationFields = Array.isArray(body.registrationFields)
      ? body.registrationFields
      : JSON.parse(
          String(
            body.registrationFields ??
              JSON.stringify(existingTournament?.registrationFields || [])
          )
        );
  } catch {
    throw new HttpError(400, "Registration fields must be valid JSON.");
  }
  const status = parseTournamentStatus(body.status || existingTournament?.status);
  const startDateInput = parseTournamentDateValue({
    body,
    existingTournament,
    valueKey: "startDate",
    statusKey: "startDateStatus",
    fieldLabel: "Start date",
  });
  const registrationOpenAt = parseOptionalDateValue(
    body.registrationOpenAt || existingTournament?.registrationOpenAt
  );
  const endDateInput = parseTournamentDateValue({
    body,
    existingTournament,
    valueKey: "endDate",
    statusKey: "endDateStatus",
    fieldLabel: "End date",
  });
  const registrationDeadlineInput = parseTournamentDateValue({
    body,
    existingTournament,
    valueKey: "registrationDeadline",
    statusKey: "registrationDeadlineStatus",
    fieldLabel: "Registration deadline",
  });
  const startDate = startDateInput.value;
  const endDate = endDateInput.value;
  const registrationDeadline = registrationDeadlineInput.value;
  const bracketLink = normalizeText(body.bracketLink)
    ? normalizeChallongeUrl(body.bracketLink)
    : null;
  const contactLink = normalizeText(body.contactLink)
    ? normalizeOptionalUrl(body.contactLink)
    : null;

  if (
    !title ||
    !slug ||
    !game ||
    !format ||
    !prizePool
  ) {
    throw new HttpError(400, "Please fill all required tournament fields.");
  }

  if (!teamSize || teamSize <= 0) {
    throw new HttpError(400, "Team size must be a valid number.");
  }

  if (maxTeamsInput && (!maxTeams || maxTeams <= 0)) {
    throw new HttpError(
      400,
      "Max teams must be a whole number of at least 1, or left blank for unlimited registrations."
    );
  }

  if (!REGISTRATION_MODES.has(registrationMode)) {
    throw new HttpError(400, "Select a valid registration mode.");
  }

  if (!ENTRY_TYPES.has(entryType)) {
    throw new HttpError(400, "Select a valid team or solo entry type.");
  }

  if (
    !minRosterSize ||
    !maxRosterSize ||
    minRosterSize < 1 ||
    maxRosterSize < minRosterSize ||
    maxSubstitutes < 0 ||
    reservationMinutes < 1 ||
    bankTransferReviewMinutes < 1
  ) {
    throw new HttpError(400, "Roster limits and reservation time must be valid.");
  }

  if (coachRequired && !allowCoach) {
    throw new HttpError(400, "Coach requirement requires coaches to be allowed.");
  }

  if (!Number.isFinite(registrationFeeAmount) || registrationFeeAmount < 0) {
    throw new HttpError(400, "Registration fee must be zero or a positive amount.");
  }

  if (!/^[A-Z]{3}$/.test(registrationFeeCurrency)) {
    throw new HttpError(400, "Registration fee currency must be a three-letter code.");
  }

  if (!PAYMENT_METHODS.has(paymentMethod)) {
    throw new HttpError(400, "Select a valid tournament payment method.");
  }
  if (registrationFeeAmount === 0 && paymentMethod !== "free") {
    throw new HttpError(400, "Free tournaments must use the free payment method.");
  }
  if (registrationFeeAmount > 0 && paymentMethod === "free") {
    throw new HttpError(400, "Paid tournaments must use PayHere or bank transfer.");
  }
  if (paymentMethod === "bank_transfer" && registrationFeeCurrency !== "LKR") {
    throw new HttpError(400, "Manual bank-transfer tournaments currently require LKR.");
  }
  if (
    paymentMethod === "bank_transfer" &&
    (!bankName || !bankAccountName || !bankAccountNumber)
  ) {
    throw new HttpError(400, "Complete the bank name, account name, and account number.");
  }

  if (!Array.isArray(registrationFeeTiers) || registrationFeeTiers.length > 20) {
    throw new HttpError(400, "A tournament can define up to 20 registration fee tiers.");
  }
  const normalizedFeeTiers = registrationFeeTiers.map((tier, index) => {
    const startSlot = normalizeInteger(tier?.startSlot);
    const endSlot = normalizeInteger(tier?.endSlot);
    const amount = Number.parseFloat(String(tier?.amount ?? ""));
    if (
      !startSlot ||
      !endSlot ||
      endSlot < startSlot ||
      !Number.isFinite(amount) ||
      amount <= 0
    ) {
      throw new HttpError(400, `Registration fee tier ${index + 1} is invalid.`);
    }
    return { startSlot, endSlot, amount };
  }).sort((left, right) => left.startSlot - right.startSlot);
  if (paymentMethod === "bank_transfer" && normalizedFeeTiers.length > 0 && maxTeams === null) {
    throw new HttpError(
      400,
      "Slot fee tiers need a max team count; a tournament with unlimited registrations has no slots to price."
    );
  }
  if (paymentMethod === "bank_transfer" && normalizedFeeTiers.length > 0) {
    let expectedStart = 1;
    for (const tier of normalizedFeeTiers) {
      if (tier.startSlot !== expectedStart || tier.endSlot > maxTeams) {
        throw new HttpError(
          400,
          "Bank-transfer fee tiers must cover slots consecutively without overlaps or gaps."
        );
      }
      expectedStart = tier.endSlot + 1;
    }
    if (expectedStart !== maxTeams + 1) {
      throw new HttpError(400, "Bank-transfer fee tiers must cover every tournament slot.");
    }
  }

  if (!Array.isArray(registrationFields) || registrationFields.length > 20) {
    throw new HttpError(400, "A tournament can define up to 20 registration fields.");
  }

  const normalizedRegistrationFields = registrationFields.map((field, index) => {
    const key = normalizeSlug(field?.key);
    const label = normalizeText(field?.label);
    const type = normalizeText(field?.type || "text").toLowerCase();
    const scope = normalizeText(field?.scope || "entry").toLowerCase();
    const options = Array.isArray(field?.options)
      ? field.options.map(normalizeText).filter(Boolean).slice(0, 50)
      : [];

    if (
      !key ||
      !label ||
      !REGISTRATION_FIELD_TYPES.has(type) ||
      !REGISTRATION_FIELD_SCOPES.has(scope) ||
      (type === "select" && options.length === 0)
    ) {
      throw new HttpError(400, `Registration field ${index + 1} is invalid.`);
    }

    return {
      key,
      label,
      type,
      scope,
      required: Boolean(field?.required),
      options,
    };
  });

  if (registrationDeadline && startDate && registrationDeadline > startDate) {
    throw new HttpError(
      400,
      "Registration deadline must be before or on the tournament start date."
    );
  }

  if (endDate && startDate && endDate < startDate) {
    throw new HttpError(400, "End date must be after the start date.");
  }

  if (normalizeText(body.bracketLink) && !bracketLink) {
    throw new HttpError(400, "Bracket link must be an HTTPS Challonge tournament URL.");
  }

  if (normalizeText(body.contactLink) && !contactLink) {
    throw new HttpError(400, "Discord/contact link must be a valid URL.");
  }

  return {
    title,
    slug,
    game,
    gameCategoryId,
    organizer,
    country,
    location,
    displayPriority,
    shortDescription,
    fullDescription,
    rules,
    rulebookId,
    registrationOpenAt,
    startDate,
    startDateStatus: startDateInput.status,
    endDate,
    endDateStatus: endDateInput.status,
    registrationDeadline,
    registrationDeadlineStatus: registrationDeadlineInput.status,
    format,
    registrationMode,
    entryType,
    seriesId,
    seriesOrder,
    teamSize,
    minRosterSize,
    maxRosterSize,
    maxSubstitutes,
    allowCoach,
    coachRequired,
    discordRequired,
    autoApproveRegistrations,
    registrationFields: normalizedRegistrationFields,
    paymentMethod,
    registrationFeeAmount,
    registrationFeeCurrency,
    registrationFeeTiers: normalizedFeeTiers,
    reservationMinutes,
    bankTransferReviewMinutes,
    bankName,
    bankBranch,
    bankAccountName,
    bankAccountNumber,
    maxTeams,
    waitlistEnabled,
    prizePool,
    status,
    isPublished: normalizeBooleanFlag(body.isPublished),
    showBracketPublicly,
    isFeatured: normalizeBooleanFlag(body.isFeatured),
    bracketLink,
    contactLink,
    isActive: status === "registration_open",
  };
};

const ensureRulebookMatchesTournamentGame = async ({ rulebookId, game }) => {
  if (!rulebookId) {
    return;
  }

  const rulebook = await prisma.rulebook.findUnique({
    where: { id: rulebookId },
    select: { game: true },
  });

  if (!rulebook) {
    throw new HttpError(400, "Selected rulebook was not found.");
  }

  if (normalizeText(rulebook.game).toLowerCase() !== normalizeText(game).toLowerCase()) {
    throw new HttpError(400, "The selected rulebook must match the tournament game.");
  }
};

module.exports = {
  normalizeTournamentInput,
  ensureRulebookMatchesTournamentGame,
};
