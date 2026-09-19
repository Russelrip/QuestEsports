const { prisma } = require("../../lib/prisma");
const { importLegacyPosters } = require("../media/legacy-import.service");
const { migrateImageAssetsToFilesystem } = require("../media/media.service");

const getAdminDashboardData = async () => {
  const [
    totalTournaments,
    openTournaments,
    totalRegistrations,
    pendingRegistrations,
    pendingRecruitmentApplications,
    unreadContactMessages,
    pendingPayments,
    actionableOrders,
  ] =
    await prisma.$transaction([
      prisma.tournament.count(),
      prisma.tournament.count({ where: { status: "registration_open" } }),
      prisma.teamRegistration.count(),
      prisma.teamRegistration.count({ where: { status: "pending" } }),
      prisma.recruitmentApplication.count({ where: { status: "pending" } }),
      prisma.contactSubmission.count({ where: { isRead: false } }),
      prisma.paymentTransaction.count({ where: { status: { in: ["pending", "review_required"] } } }),
      prisma.merchandiseOrder.count({ where: { status: { in: ["paid", "processing"] } } }),
    ]);

  return {
    totalTournaments,
    openTournaments,
    totalRegistrations,
    pendingRegistrations,
    pendingRecruitmentApplications,
    unreadContactMessages,
    pendingPayments,
    actionableOrders,
  };
};

const runLegacyPosterImport = async () => importLegacyPosters();
const runPosterImageAssetMigration = async () => migrateImageAssetsToFilesystem();

module.exports = {
  getAdminDashboardData,
  runLegacyPosterImport,
  runPosterImageAssetMigration,
};
