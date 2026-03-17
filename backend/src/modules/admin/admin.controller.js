const { asyncHandler } = require("../../lib/async-handler");
const {
  getAdminDashboardData,
  listAdminUsers,
  getAdminUserById,
  createAdminUser,
  updateAdminUser,
  deleteAdminUser,
  listContactMessages,
  updateContactMessageReadStatus,
  deleteContactMessage,
  listTeamRegistrations,
  getRegistrationsByTournament,
  updateTeamRegistrationStatus,
} = require("./admin.service");

const getDashboard = asyncHandler(async (req, res) => {
  const stats = await getAdminDashboardData();

  res.status(200).json({
    success: true,
    stats,
  });
});

const getUsers = asyncHandler(async (req, res) => {
  const result = await listAdminUsers(req.query);

  res.status(200).json({
    success: true,
    users: result.items,
    pagination: result.pagination,
  });
});

const getUser = asyncHandler(async (req, res) => {
  const user = await getAdminUserById(req.params.userId);

  res.status(200).json({
    success: true,
    user,
  });
});

const createUser = asyncHandler(async (req, res) => {
  const user = await createAdminUser({ body: req.body });

  res.status(201).json({
    success: true,
    message: "User created successfully.",
    user,
  });
});

const updateUser = asyncHandler(async (req, res) => {
  const user = await updateAdminUser({
    userId: req.params.userId,
    body: req.body,
    currentUser: req.user,
  });

  res.status(200).json({
    success: true,
    message: "User updated successfully.",
    user,
  });
});

const removeUser = asyncHandler(async (req, res) => {
  await deleteAdminUser({
    userId: req.params.userId,
    currentUser: req.user,
  });

  res.status(200).json({
    success: true,
    message: "User deleted successfully.",
  });
});

const getContactMessages = asyncHandler(async (req, res) => {
  const result = await listContactMessages(req.query);

  res.status(200).json({
    success: true,
    messages: result.items,
    pagination: result.pagination,
  });
});

const updateContactMessageStatus = asyncHandler(async (req, res) => {
  const contactMessage = await updateContactMessageReadStatus(
    req.params.messageId,
    req.body.isRead
  );

  res.status(200).json({
    success: true,
    message: "Contact message updated successfully.",
    contactMessage,
  });
});

const removeContactMessage = asyncHandler(async (req, res) => {
  await deleteContactMessage(req.params.messageId);

  res.status(200).json({
    success: true,
    message: "Contact message deleted successfully.",
  });
});

const getTeamRegistrations = asyncHandler(async (req, res) => {
  const result = await listTeamRegistrations(req.query);

  res.status(200).json({
    success: true,
    registrations: result.items,
    tournaments: result.tournaments,
    pagination: result.pagination,
  });
});

const getTournamentRegistrations = asyncHandler(async (req, res) => {
  const result = await getRegistrationsByTournament(
    req.params.tournamentId,
    req.query
  );

  res.status(200).json({
    success: true,
    tournament: result.tournament,
    registrations: result.items,
    tournaments: result.tournaments,
    pagination: result.pagination,
  });
});

const updateRegistrationStatus = asyncHandler(async (req, res) => {
  const registration = await updateTeamRegistrationStatus(
    req.params.registrationId,
    req.body
  );

  res.status(200).json({
    success: true,
    message: "Registration updated successfully.",
    registration,
  });
});

module.exports = {
  getDashboard,
  getUsers,
  getUser,
  createUser,
  updateUser,
  removeUser,
  getContactMessages,
  updateContactMessageStatus,
  removeContactMessage,
  getTeamRegistrations,
  getTournamentRegistrations,
  updateRegistrationStatus,
};
