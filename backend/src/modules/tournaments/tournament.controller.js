const { asyncHandler } = require("../../lib/async-handler");
const {
  getTournamentRegistrationStatus,
  createTournamentRegistration,
} = require("./tournament.service");

const getTournamentRegistrationStatusController = asyncHandler(async (req, res) => {
  const result = await getTournamentRegistrationStatus({
    slug: req.params.slug,
    user: req.user,
  });

  res.status(200).json({
    success: true,
    isRegistered: result.isRegistered,
  });
});

const submitTournamentRegistration = asyncHandler(async (req, res) => {
  await createTournamentRegistration({
    body: req.body,
    file: req.file,
  });

  res.status(201).json({
    success: true,
    message: "Tournament registration submitted successfully.",
  });
});

module.exports = {
  getTournamentRegistrationStatus: getTournamentRegistrationStatusController,
  submitTournamentRegistration,
};
