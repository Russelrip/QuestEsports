const { normalizeText } = require("../../lib/validation");
const { buildShortCode, mapPublicBracket, overlayBracketLogos } = require("./bracket.service");
const { isRegistrationActive } = require("./registration-eligibility");
const { isPayHereConfigured } = require("../payments/payment.service");
const { resolveEffectiveTeamLogoName, getTeamLogoUrl } = require("../teams/team-logo");
const { getTournamentRegistrationState } = require("./registration-state");

const getTournamentBannerUrl = (bannerImageName) =>
  bannerImageName ? `/api/uploads/tournament-banners/${bannerImageName}` : null;

const getShowcaseImageUrl = (imageName) =>
  imageName ? `/api/uploads/tournament-banners/${imageName}` : null;

const mapGameCategory = (category) => category ? ({
  id: category.id,
  slug: category.slug,
  displayName: category.displayName,
  artworkUrl: category.artworkName ? `/api/uploads/game-assets/${category.artworkName}` : null,
  logoUrl: category.logoName ? `/api/uploads/game-assets/${category.logoName}` : null,
}) : null;

const mapSponsor = (sponsor) => ({
  id: sponsor.id,
  name: sponsor.name,
  partnershipLabel: sponsor.partnershipLabel,
  logoUrl: sponsor.logoImageName
    ? `/api/uploads/sponsor-logos/${sponsor.logoImageName}`
    : null,
  websiteUrl: sponsor.websiteUrl,
  displayOrder: sponsor.displayOrder,
});

const normalizeChallongeUrl = (value) => {
  const raw = normalizeText(value);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    if (
      url.protocol !== "https:" ||
      (host !== "challonge.com" && !host.endsWith(".challonge.com"))
    ) return null;
    const segments = url.pathname.split("/").filter(Boolean);
    if (segments.at(-1)?.toLowerCase() === "module") segments.pop();
    if (segments.length === 0) return null;
    url.pathname = `/${segments.join("/")}`;
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
};

const buildChallongeEmbedUrl = (value) => {
  const normalized = normalizeChallongeUrl(value);
  return normalized ? `${normalized}/module` : null;
};

const withRegistrationCount = (tournament) => {
  if (tournament.registrationCount !== undefined) {
    return {
      ...tournament,
      capacityUsed: tournament.capacityUsed ?? tournament.registrationCount,
    };
  }

  const registrations = tournament.teamRegistrations || [];
  const confirmedRegistrationCount = registrations
    .filter(({ status }) => status === "approved")
    .length;
  const activeRegistrationCount = Number.isInteger(tournament._count?.teamRegistrations)
    ? tournament._count.teamRegistrations
    : registrations.filter((registration) => isRegistrationActive(registration)).length;
  const adminHoldCount = tournament._count?.adminSlotReservations || 0;
  const activeHeldRegistrationCount = (tournament.adminSlotReservations || [])
    .filter(({ registration }) => isRegistrationActive(registration))
    .length;
  const capacityUsed = activeRegistrationCount + adminHoldCount - activeHeldRegistrationCount;

  return {
    ...tournament,
    registrationCount: confirmedRegistrationCount,
    capacityUsed: tournament.capacityUsed ?? capacityUsed,
  };
};

const mapTournament = (tournament, { parentWindow } = {}) => {
  const tournamentWithRegistrationCount = withRegistrationCount(tournament);
  const state = getTournamentRegistrationState({
    tournament: tournamentWithRegistrationCount,
    capacityUsed: tournamentWithRegistrationCount.capacityUsed ?? tournamentWithRegistrationCount.registrationCount ?? 0,
  });
  const parentNotOpen = parentWindow?.registrationOpenAt && new Date(parentWindow.registrationOpenAt).getTime() > Date.now();
  const parentClosed = parentWindow?.registrationCloseAt && new Date(parentWindow.registrationCloseAt).getTime() <= Date.now();
  const registrationState = parentNotOpen ? "upcoming" : parentClosed ? "registration_closed" : state.state;
  const registrationAction = registrationState === "registration_open"
    ? "register"
    : registrationState === "waitlist_open"
      ? "waitlist"
      : "closed";
  const registrationLabel = registrationState === "registration_open"
    ? state.label
    : registrationState === "waitlist_open"
      ? "Join waitlist"
      : registrationState === "upcoming"
        ? "Registration opens soon"
        : "Registration closed";

  return {
    id: tournamentWithRegistrationCount.id,
    slug: tournamentWithRegistrationCount.slug,
    title: tournamentWithRegistrationCount.title,
    game: tournamentWithRegistrationCount.game,
    gameCategory: mapGameCategory(tournamentWithRegistrationCount.gameCategory),
    organizer: tournamentWithRegistrationCount.organizer || "Quest E-sports",
    country: tournamentWithRegistrationCount.country || "Sri Lanka",
    location: tournamentWithRegistrationCount.location || "TBA",
    series: tournamentWithRegistrationCount.series || null,
    seriesOrder: tournamentWithRegistrationCount.seriesOrder,
    displayPriority: tournamentWithRegistrationCount.displayPriority,
    bannerUrl: getTournamentBannerUrl(tournamentWithRegistrationCount.bannerImageName),
    heroUrl: getTournamentBannerUrl(
      tournamentWithRegistrationCount.heroImageName || tournamentWithRegistrationCount.bannerImageName
    ),
    shortDescription: tournamentWithRegistrationCount.shortDescription,
    fullDescription: tournamentWithRegistrationCount.fullDescription,
    rules: tournamentWithRegistrationCount.rules,
    rulebook: tournamentWithRegistrationCount.rulebook || null,
    registrationOpenAt: tournamentWithRegistrationCount.registrationOpenAt,
    startDate: tournamentWithRegistrationCount.startDate,
    startDateStatus: tournamentWithRegistrationCount.startDateStatus || "scheduled",
    endDate: tournamentWithRegistrationCount.endDate,
    endDateStatus: tournamentWithRegistrationCount.endDateStatus || "scheduled",
    registrationDeadline: tournamentWithRegistrationCount.registrationDeadline,
    registrationDeadlineStatus:
      tournamentWithRegistrationCount.registrationDeadlineStatus || "scheduled",
    format: tournamentWithRegistrationCount.format,
    registrationMode: tournamentWithRegistrationCount.registrationMode,
    entryType: tournamentWithRegistrationCount.entryType || "team",
    teamSize: tournamentWithRegistrationCount.teamSize,
    minRosterSize: tournamentWithRegistrationCount.minRosterSize || tournamentWithRegistrationCount.teamSize,
    maxRosterSize: tournamentWithRegistrationCount.maxRosterSize || tournamentWithRegistrationCount.teamSize,
    maxSubstitutes: tournamentWithRegistrationCount.maxSubstitutes || 0,
    allowCoach: Boolean(tournamentWithRegistrationCount.allowCoach),
    coachRequired: Boolean(tournamentWithRegistrationCount.coachRequired),
    registrationFields: tournamentWithRegistrationCount.registrationFields || [],
    paymentMethod: tournamentWithRegistrationCount.paymentMethod ||
      (Number(tournamentWithRegistrationCount.registrationFeeAmount || 0) > 0
        ? "payhere"
        : "free"),
    registrationFee: {
      amount: Number(tournamentWithRegistrationCount.registrationFeeAmount || 0),
      currency: tournamentWithRegistrationCount.registrationFeeCurrency || "LKR",
    },
    registrationFeeTiers: Array.isArray(tournamentWithRegistrationCount.registrationFeeTiers)
      ? tournamentWithRegistrationCount.registrationFeeTiers
      : [],
    registrationPaymentAvailable:
      Number(tournamentWithRegistrationCount.registrationFeeAmount || 0) === 0 ||
      tournamentWithRegistrationCount.paymentMethod === "bank_transfer" ||
      (tournamentWithRegistrationCount.paymentMethod === "payhere" && isPayHereConfigured()),
    reservationMinutes: tournamentWithRegistrationCount.reservationMinutes || 1440,
    bankTransferReviewMinutes:
      tournamentWithRegistrationCount.bankTransferReviewMinutes || 1440,
    // NULL is carried through as NULL: it is the public statement that this
    // tournament has no slot ceiling, not a missing value.
    maxTeams: tournamentWithRegistrationCount.maxTeams ?? null,
    waitlistEnabled: Boolean(tournamentWithRegistrationCount.waitlistEnabled),
    registrationAction,
    registrationLabel,
    registrationCount: tournamentWithRegistrationCount.registrationCount,
    capacityUsed: tournamentWithRegistrationCount.capacityUsed,
    prizePool: tournamentWithRegistrationCount.prizePool,
    status: tournamentWithRegistrationCount.status,
    isPublished: tournamentWithRegistrationCount.isPublished,
    showBracketPublicly: tournamentWithRegistrationCount.showBracketPublicly ?? true,
    bracketLink: tournamentWithRegistrationCount.bracketLink,
    challongeEmbedUrl: buildChallongeEmbedUrl(tournamentWithRegistrationCount.bracketLink),
    bracketSource: tournamentWithRegistrationCount.challongeIntegration?.enabled
      ? "challonge"
      : tournamentWithRegistrationCount.bracket?.status === "published"
        ? "native"
        : "none",
    sponsors: (tournamentWithRegistrationCount.sponsors || []).map(mapSponsor),
    contactLink: tournamentWithRegistrationCount.contactLink,
    isFeatured: tournamentWithRegistrationCount.isFeatured,
    scheduleData: tournamentWithRegistrationCount.scheduleData || null,
    isCompleted: tournamentWithRegistrationCount.status === "completed",
    showcase: {
      posterUrl: getShowcaseImageUrl(tournamentWithRegistrationCount.completedPosterImageName),
      firstPlaceUrl: getShowcaseImageUrl(tournamentWithRegistrationCount.firstPlaceImageName),
      secondPlaceUrl: getShowcaseImageUrl(tournamentWithRegistrationCount.secondPlaceImageName),
      thirdPlaceUrl: getShowcaseImageUrl(tournamentWithRegistrationCount.thirdPlaceImageName),
    },
    eventMedia: (tournamentWithRegistrationCount.posters || []).map((poster) => ({
      id: poster.id,
      title: poster.title,
      description: poster.description,
      category: poster.category,
      createdAt: poster.createdAt,
      imageUrl: poster.imageAsset.storedFilename
        ? `/api/uploads/poster-images/${poster.imageAsset.storedFilename}`
        : `/api/posters/${poster.id}/image`,
    })),
    eventAlbums: (tournamentWithRegistrationCount.eventAlbums || []).map((album) => ({
      id: album.id,
      slug: album.slug,
      title: album.title,
      description: album.description,
      location: album.location,
      eventDate: album.eventDate,
      photoCount: album._count.photos,
      photos: album.photos.map((photo) => ({
        id: photo.id,
        caption: photo.caption,
        imageUrl: `/api/event-albums/${encodeURIComponent(album.slug)}/photos/${photo.id}/image`,
      })),
    })),
    registrationState,
    isRegistrationOpen: registrationState === "registration_open",
    isSlotsFull: registrationState === "slots_full",
    isRegistrationClosed: registrationState === "registration_closed",
    isWaitlistOpen: registrationState === "waitlist_open",
    createdAt: tournamentWithRegistrationCount.createdAt,
    updatedAt: tournamentWithRegistrationCount.updatedAt,
  };
};

const mapAdminTournament = (tournament) => ({
  ...mapTournament(tournament),
  discordRequired: Boolean(tournament.discordRequired),
  autoApproveRegistrations: Boolean(tournament.autoApproveRegistrations),
  bankName: tournament.bankName,
  bankBranch: tournament.bankBranch,
  bankAccountName: tournament.bankAccountName,
  bankAccountNumber: tournament.bankAccountNumber,
});

const mapTournamentWithRegistrations = (
  tournament,
  registrations = tournament.teamRegistrations || []
) => {
  const liveBracket = tournament.bracket
    ? overlayBracketLogos(tournament.bracket, registrations)
    : null;

  return {
    ...mapAdminTournament(tournament),
    bracket: liveBracket,
    registrations: registrations.map((registration) => ({
    id: registration.id,
    teamName: registration.teamName,
    contactEmail: registration.contactEmail,
    logoUrl: getTeamLogoUrl(resolveEffectiveTeamLogoName(registration)),
    status: registration.status,
    paymentStatus: registration.paymentStatus,
    verificationStatus: registration.verificationStatus,
    createdAt: registration.createdAt,
    memberCount: Array.isArray(registration.members)
      ? registration.members.filter((member) => member.role !== "COACH").length
      : registration._count?.members ?? 0,
    captain: {
      name: registration.captainName,
      email: registration.captainEmail,
      phone: registration.captainPhone,
      discord: registration.captainDiscord,
      riotId: registration.captainRiotId,
    },
    })),
  };
};

const mapCompletedChallongeResult = (integration) => {
  if (!integration?.enabled || !integration.snapshotData) return null;

  const snapshot = integration.snapshotData;
  const participants = Array.isArray(snapshot.participants) ? snapshot.participants : [];
  const matches = Array.isArray(snapshot.matches) ? snapshot.matches : [];
  const links = new Map(
    (integration.participantLinks || []).map((link) => [
      String(link.externalParticipantId),
      link,
    ])
  );
  const mapStanding = (participant, rank) => {
    const link = links.get(String(participant.id));
    const registration = link?.isConfirmed ? link.registration : null;
    return {
      rank,
      name: registration?.teamName || link?.displayName || participant.name || "Participant",
      seed: Number.isInteger(participant.seed) ? participant.seed : null,
      logoUrl: registration
        ? getTeamLogoUrl(resolveEffectiveTeamLogoName(registration))
        : null,
    };
  };

  const standings = participants
    .filter((participant) => Number.isInteger(participant.finalRank) && participant.finalRank >= 1 && participant.finalRank <= 3)
    .sort((left, right) => left.finalRank - right.finalRank)
    .map((participant) => mapStanding(participant, participant.finalRank));

  if (!standings.some((standing) => standing.rank === 1)) {
    const finalWinnerId = [...matches].reverse().find((match) => match.winnerId)?.winnerId;
    const winner = participants.find((participant) => String(participant.id) === String(finalWinnerId));
    if (winner) standings.unshift(mapStanding(winner, 1));
  }

  return {
    status: snapshot.tournament?.state || "complete",
    completedAt: snapshot.tournament?.completedAt || null,
    standings,
  };
};

const mapTournamentWithPublicTeams = (
  tournament,
  { participantPagination, bracketRegistrations } = {},
) => ({
  ...mapTournament(tournament),
  ...mapPublicBracket(
    tournament.bracket,
    bracketRegistrations || tournament.teamRegistrations,
  ),
  resultSummary: mapCompletedChallongeResult(tournament.challongeIntegration),
  registeredTeams: (tournament.teamRegistrations || [])
    .filter((registration) => (registration.entryType || "team") === "team")
    .map((registration) => ({
    id: registration.id,
    teamName: registration.teamName,
    logoUrl: getTeamLogoUrl(resolveEffectiveTeamLogoName(registration)),
    shortCode: buildShortCode(registration.teamName),
    memberCount: (registration.members || []).filter((member) => member.role !== "COACH").length,
    status: registration.status,
    captainName: registration.captainName,
    })),
  registeredParticipants: (tournament.teamRegistrations || []).map((registration) => ({
    id: registration.id,
    entryType: registration.entryType || "team",
    displayName:
      (registration.entryType || "team") === "solo"
        ? registration.captainName
        : registration.teamName,
    logoUrl: getTeamLogoUrl(resolveEffectiveTeamLogoName(registration)),
    avatarUrl:
      (registration.entryType || "team") === "solo" && registration.user?.avatarImageName
        ? `/api/uploads/avatars/${registration.user.avatarImageName}`
        : null,
    captainName: registration.captainName,
    shortCode: buildShortCode(registration.teamName),
    memberCount: (registration.members || []).filter((member) => member.role !== "COACH").length,
  })),
  ...(participantPagination ? { participantPagination } : {}),
});

const sortPublicTournaments = (tournaments) =>
  [...tournaments].sort((left, right) => {
    const priorityDifference = left.displayPriority - right.displayPriority;

    if (priorityDifference !== 0) {
      return priorityDifference;
    }

    if (left.isRegistrationOpen !== right.isRegistrationOpen) {
      return left.isRegistrationOpen ? -1 : 1;
    }

    if (left.isFeatured !== right.isFeatured) {
      return left.isFeatured ? -1 : 1;
    }

    const leftStartDate = left.startDate
      ? new Date(left.startDate).getTime()
      : Number.POSITIVE_INFINITY;
    const rightStartDate = right.startDate
      ? new Date(right.startDate).getTime()
      : Number.POSITIVE_INFINITY;
    const startDateDifference =
      leftStartDate === rightStartDate ? 0 : leftStartDate - rightStartDate;

    if (startDateDifference !== 0) {
      return startDateDifference;
    }

    return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
  });

module.exports = {
  normalizeChallongeUrl,
  buildChallongeEmbedUrl,
  withRegistrationCount,
  mapTournament,
  mapAdminTournament,
  mapTournamentWithRegistrations,
  mapTournamentWithPublicTeams,
  sortPublicTournaments,
};
