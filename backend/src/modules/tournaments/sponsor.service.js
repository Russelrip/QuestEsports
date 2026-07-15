const crypto = require("crypto");
const { prisma } = require("../../lib/prisma");
const { HttpError } = require("../../lib/http-error");
const { normalizeInteger, normalizeOptionalUrl, normalizeText } = require("../../lib/validation");
const {
  persistSponsorLogoUpload,
  removeUploadFile,
  sponsorLogoDirectory,
} = require("../../middleware/upload");

const mapSponsor = (sponsor) => ({
  id: sponsor.id,
  name: sponsor.name,
  logoUrl: sponsor.logoImageName ? `/api/uploads/sponsor-logos/${sponsor.logoImageName}` : null,
  websiteUrl: sponsor.websiteUrl,
  displayOrder: sponsor.displayOrder,
});

const listTournamentSponsors = async (tournamentId) => {
  const exists = await prisma.tournament.findUnique({ where: { id: tournamentId }, select: { id: true } });
  if (!exists) throw new HttpError(404, "Tournament not found.");
  return (await prisma.tournamentSponsor.findMany({
    where: { tournamentId },
    orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }],
  })).map(mapSponsor);
};

const saveTournamentSponsor = async ({ tournamentId, sponsorId, body, file }) => {
  if (!sponsorId) {
    const tournament = await prisma.tournament.findUnique({ where: { id: tournamentId }, select: { id: true } });
    if (!tournament) throw new HttpError(404, "Tournament not found.");
  }
  const existing = sponsorId
    ? await prisma.tournamentSponsor.findFirst({ where: { id: sponsorId, tournamentId } })
    : null;
  if (sponsorId && !existing) throw new HttpError(404, "Sponsor not found.");
  const name = normalizeText(body.name || existing?.name);
  if (!name) throw new HttpError(400, "Sponsor name is required.");
  const rawWebsite = normalizeText(body.websiteUrl);
  const websiteUrl = rawWebsite ? normalizeOptionalUrl(rawWebsite) : null;
  if (rawWebsite && (!websiteUrl || !websiteUrl.startsWith("https://"))) {
    throw new HttpError(400, "Sponsor website must be a valid HTTPS URL.");
  }
  const uploaded = await persistSponsorLogoUpload(file);
  const removeLogo = [true, "true", "1", "on"].includes(body.removeLogo);
  const data = {
    name,
    websiteUrl,
    displayOrder: normalizeInteger(body.displayOrder) ?? existing?.displayOrder ?? 100,
    ...(uploaded ? { logoImageName: uploaded.filename } : removeLogo ? { logoImageName: null } : {}),
  };
  try {
    const saved = sponsorId
      ? await prisma.tournamentSponsor.update({ where: { id: sponsorId }, data })
      : await prisma.tournamentSponsor.create({ data: { id: crypto.randomUUID(), tournamentId, ...data } });
    if (existing?.logoImageName && existing.logoImageName !== saved.logoImageName) {
      await removeUploadFile({ directory: sponsorLogoDirectory, filename: existing.logoImageName }).catch(() => undefined);
    }
    return mapSponsor(saved);
  } catch (error) {
    if (uploaded) await removeUploadFile({ directory: sponsorLogoDirectory, filename: uploaded.filename }).catch(() => undefined);
    throw error;
  }
};

const deleteTournamentSponsor = async ({ tournamentId, sponsorId }) => {
  const existing = await prisma.tournamentSponsor.findFirst({ where: { id: sponsorId, tournamentId } });
  if (!existing) throw new HttpError(404, "Sponsor not found.");
  await prisma.tournamentSponsor.delete({ where: { id: sponsorId } });
  if (existing.logoImageName) {
    await removeUploadFile({ directory: sponsorLogoDirectory, filename: existing.logoImageName }).catch(() => undefined);
  }
};

module.exports = { listTournamentSponsors, saveTournamentSponsor, deleteTournamentSponsor };
