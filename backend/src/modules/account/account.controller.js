const { asyncHandler } = require("../../lib/async-handler");
const {
  getAccountDashboard,
  updateAccountAvatar,
  removeAccountAvatar,
} = require("./account.service");

const getDashboard = asyncHandler(async (req, res) => {
  const dashboard = await getAccountDashboard({ user: req.user });
  res.status(200).json({ success: true, dashboard });
});

const uploadAvatar = asyncHandler(async (req, res) => {
  const user = await updateAccountAvatar({ user: req.user, file: req.file });
  res.status(200).json({ success: true, message: "Profile picture updated.", user });
});

const deleteAvatar = asyncHandler(async (req, res) => {
  const user = await removeAccountAvatar({ user: req.user });
  res.status(200).json({ success: true, message: "Profile picture removed.", user });
});

module.exports = { getDashboard, uploadAvatar, deleteAvatar };
