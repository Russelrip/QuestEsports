const { asyncHandler } = require("../../lib/async-handler");
const { createRecruitmentApplication } = require("./recruitment.service");

const submitRecruitmentApplication = asyncHandler(async (req, res) => {
  const application = await createRecruitmentApplication({
    body: req.body,
    user: req.user,
  });

  res.status(201).json({
    success: true,
    message: "Recruitment application submitted successfully.",
    application,
  });
});

module.exports = { submitRecruitmentApplication };
