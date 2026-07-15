const { asyncHandler } = require("../../lib/async-handler");
const service = require("./sponsor.service");

const listSponsors = asyncHandler(async (req, res) => {
  res.status(200).json({ success: true, sponsors: await service.listTournamentSponsors(req.params.tournamentId) });
});
const createSponsor = asyncHandler(async (req, res) => {
  const sponsor = await service.saveTournamentSponsor({ tournamentId: req.params.tournamentId, body: req.body, file: req.file });
  res.status(201).json({ success: true, message: "Sponsor created.", sponsor });
});
const updateSponsor = asyncHandler(async (req, res) => {
  const sponsor = await service.saveTournamentSponsor({ tournamentId: req.params.tournamentId, sponsorId: req.params.sponsorId, body: req.body, file: req.file });
  res.status(200).json({ success: true, message: "Sponsor updated.", sponsor });
});
const deleteSponsor = asyncHandler(async (req, res) => {
  await service.deleteTournamentSponsor({ tournamentId: req.params.tournamentId, sponsorId: req.params.sponsorId });
  res.status(200).json({ success: true, message: "Sponsor deleted." });
});

module.exports = { listSponsors, createSponsor, updateSponsor, deleteSponsor };
