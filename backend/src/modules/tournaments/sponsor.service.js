const crypto = require("crypto");
const { prisma } = require("../../lib/prisma");
const { HttpError } = require("../../lib/http-error");
const { removeUploadsQuietly } = require("../../lib/upload-cleanup");
const { normalizeInteger, normalizeOptionalUrl, normalizeText } = require("../../lib/validation");
const {
  persistSponsorLogoUpload,
  sponsorLogoDirectory,
} = require("../../middleware/upload");

const mapSponsor = (sponsor) => ({
  id: sponsor.id,
  name: sponsor.name,
  partnershipLabel: sponsor.partnershipLabel,
  logoUrl: sponsor.logoImageName ? `/api/uploads/sponsor-logos/${sponsor.logoImageName}` : null,
  websiteUrl: sponsor.websiteUrl,
  displayOrder: sponsor.displayOrder,
});

// Tournaments and events carry identical sponsor rows; only the owning table,
// the foreign key and the not-found wording differ.
const owners = {
  tournament: { ownerModel: "tournament", sponsorModel: "tournamentSponsor", ownerField: "tournamentId", notFound: "Tournament not found." },
  event: { ownerModel: "eventSeries", sponsorModel: "eventSponsor", ownerField: "seriesId", notFound: "Event not found." },
};

const listSponsors = async (owner, ownerId) => {
  const exists = await prisma[owner.ownerModel].findUnique({ where: { id: ownerId }, select: { id: true } });
  if (!exists) throw new HttpError(404, owner.notFound);
  return (await prisma[owner.sponsorModel].findMany({
    where: { [owner.ownerField]: ownerId },
    orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }],
  })).map(mapSponsor);
};

const saveSponsor = async (owner, { ownerId, sponsorId, body, file }) => {
  const logContext = { [owner.ownerField]: ownerId, sponsorId };
  if (!sponsorId) {
    const exists = await prisma[owner.ownerModel].findUnique({ where: { id: ownerId }, select: { id: true } });
    if (!exists) throw new HttpError(404, owner.notFound);
  }
  const existing = sponsorId
    ? await prisma[owner.sponsorModel].findFirst({ where: { id: sponsorId, [owner.ownerField]: ownerId } })
    : null;
  if (sponsorId && !existing) throw new HttpError(404, "Sponsor not found.");
  const name = normalizeText(body.name || existing?.name);
  if (!name) throw new HttpError(400, "Sponsor name is required.");
  const partnershipLabel = normalizeText(body.partnershipLabel || existing?.partnershipLabel || "Official Sponsor");
  if (partnershipLabel.length > 80) throw new HttpError(400, "Partnership label must be 80 characters or fewer.");
  const rawWebsite = normalizeText(body.websiteUrl);
  const websiteUrl = rawWebsite ? normalizeOptionalUrl(rawWebsite) : null;
  if (rawWebsite && (!websiteUrl || !websiteUrl.startsWith("https://"))) {
    throw new HttpError(400, "Sponsor website must be a valid HTTPS URL.");
  }
  const uploaded = await persistSponsorLogoUpload(file);
  const removeLogo = [true, "true", "1", "on"].includes(body.removeLogo);
  const data = {
    name,
    partnershipLabel,
    websiteUrl,
    displayOrder: normalizeInteger(body.displayOrder) ?? existing?.displayOrder ?? 100,
    ...(uploaded ? { logoImageName: uploaded.filename } : removeLogo ? { logoImageName: null } : {}),
  };
  try {
    const saved = sponsorId
      ? await prisma[owner.sponsorModel].update({ where: { id: sponsorId }, data })
      : await prisma[owner.sponsorModel].create({ data: { id: crypto.randomUUID(), [owner.ownerField]: ownerId, ...data } });
    if (existing?.logoImageName && existing.logoImageName !== saved.logoImageName) {
      await removeUploadsQuietly(
        [{ directory: sponsorLogoDirectory, filename: existing.logoImageName }],
        { operation: "saveSponsor", ...logContext }
      );
    }
    return mapSponsor(saved);
  } catch (error) {
    if (uploaded) {
      await removeUploadsQuietly(
        [{ directory: sponsorLogoDirectory, filename: uploaded.filename }],
        { operation: "rollbackSponsorUpload", ...logContext }
      );
    }
    throw error;
  }
};

const deleteSponsor = async (owner, { ownerId, sponsorId }) => {
  const existing = await prisma[owner.sponsorModel].findFirst({ where: { id: sponsorId, [owner.ownerField]: ownerId } });
  if (!existing) throw new HttpError(404, "Sponsor not found.");
  await prisma[owner.sponsorModel].delete({ where: { id: sponsorId } });
  if (existing.logoImageName) {
    await removeUploadsQuietly(
      [{ directory: sponsorLogoDirectory, filename: existing.logoImageName }],
      { operation: "deleteSponsor", [owner.ownerField]: ownerId, sponsorId }
    );
  }
};

// Collapses every child tournament's sponsors onto the event itself, one row
// per brand. Most events are backed by a single lineup of sponsors rather than
// a different set per game, and an event sponsor already shows on every child
// tournament, so holding them once on the event is the tidier shape.
const promoteTournamentSponsorsToEvent = async (eventId) => {
  const event = await prisma.eventSeries.findUnique({
    where: { id: eventId },
    select: {
      id: true,
      sponsors: { select: { name: true } },
      tournaments: {
        orderBy: [{ seriesOrder: "asc" }, { createdAt: "asc" }],
        select: { sponsors: { orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }] } },
      },
    },
  });
  if (!event) throw new HttpError(404, owners.event.notFound);

  const childSponsors = event.tournaments.flatMap((tournament) => tournament.sponsors);
  if (!childSponsors.length) {
    return { moved: 0, removed: 0, sponsors: await listEventSponsors(eventId) };
  }

  const seen = new Set(event.sponsors.map((sponsor) => normalizeText(sponsor.name).toLowerCase()));
  const promoted = [];
  // A promoted row takes over the child's logo file, so that file has to outlive
  // the row it came from; every other child logo is orphaned by the delete.
  const keptLogos = new Set();
  for (const sponsor of childSponsors) {
    const key = normalizeText(sponsor.name).toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    if (sponsor.logoImageName) keptLogos.add(sponsor.logoImageName);
    promoted.push({
      id: crypto.randomUUID(),
      seriesId: eventId,
      name: sponsor.name,
      partnershipLabel: sponsor.partnershipLabel,
      logoImageName: sponsor.logoImageName,
      websiteUrl: sponsor.websiteUrl,
      displayOrder: sponsor.displayOrder,
    });
  }

  await prisma.$transaction([
    ...(promoted.length ? [prisma.eventSponsor.createMany({ data: promoted })] : []),
    prisma.tournamentSponsor.deleteMany({ where: { id: { in: childSponsors.map((sponsor) => sponsor.id) } } }),
  ]);

  const orphanedLogos = childSponsors
    .filter((sponsor) => sponsor.logoImageName && !keptLogos.has(sponsor.logoImageName))
    .map((sponsor) => ({ directory: sponsorLogoDirectory, filename: sponsor.logoImageName }));
  if (orphanedLogos.length) {
    await removeUploadsQuietly(orphanedLogos, { operation: "promoteTournamentSponsorsToEvent", seriesId: eventId });
  }

  return { moved: promoted.length, removed: childSponsors.length, sponsors: await listEventSponsors(eventId) };
};

const listTournamentSponsors = (tournamentId) => listSponsors(owners.tournament, tournamentId);
const saveTournamentSponsor = ({ tournamentId, ...rest }) => saveSponsor(owners.tournament, { ownerId: tournamentId, ...rest });
const deleteTournamentSponsor = ({ tournamentId, sponsorId }) => deleteSponsor(owners.tournament, { ownerId: tournamentId, sponsorId });
const listEventSponsors = (eventId) => listSponsors(owners.event, eventId);
const saveEventSponsor = ({ eventId, ...rest }) => saveSponsor(owners.event, { ownerId: eventId, ...rest });
const deleteEventSponsor = ({ eventId, sponsorId }) => deleteSponsor(owners.event, { ownerId: eventId, sponsorId });

module.exports = {
  mapSponsor,
  listTournamentSponsors,
  saveTournamentSponsor,
  deleteTournamentSponsor,
  listEventSponsors,
  saveEventSponsor,
  deleteEventSponsor,
  promoteTournamentSponsorsToEvent,
};
