const { prisma } = require("../../lib/prisma");
const { HttpError } = require("../../lib/http-error");
const { removeUploadsQuietly } = require("../../lib/upload-cleanup");
const {
  avatarDirectory,
  persistAvatarUpload,
} = require("../../middleware/upload");
const { listProfileTeams } = require("../teams/team.service");
const { mapUserForResponse, PUBLIC_USER_SELECT } = require("../auth/auth.service");

const mapRegistration = (registration) => ({
  id: registration.id,
  entryType: registration.entryType,
  displayName: registration.teamName,
  status: registration.status,
  paymentStatus: registration.paymentStatus,
  verificationStatus: registration.verificationStatus,
  createdAt: registration.createdAt,
  reservedUntil: registration.reservedUntil,
  additionalData: registration.additionalData || {},
  event: registration.tournament.series
    ? {
        id: registration.tournament.series.id,
        slug: registration.tournament.series.slug,
        title: registration.tournament.series.title,
      }
    : null,
  tournament: {
    id: registration.tournament.id,
    slug: registration.tournament.slug,
    title: registration.tournament.title,
    game: registration.tournament.game,
    status: registration.tournament.status,
    startDate: registration.tournament.startDate,
    startDateStatus: registration.tournament.startDateStatus || "scheduled",
    endDate: registration.tournament.endDate,
    endDateStatus: registration.tournament.endDateStatus || "scheduled",
    bannerUrl: registration.tournament.bannerImageName
      ? `/api/uploads/tournament-banners/${registration.tournament.bannerImageName}`
      : null,
  },
  payment: registration.payments[0]
      ? {
        id: registration.payments[0].id,
        orderId: registration.payments[0].providerOrderId,
        provider: registration.payments[0].provider,
        status: registration.payments[0].status,
        amount: Number(registration.payments[0].amount),
        currency: registration.payments[0].currency,
      }
    : null,
});

const getAccountDashboard = async ({ user }) => {
  const [registrations, teams, orders, recruitmentApplications] = await Promise.all([
    prisma.teamRegistration.findMany({
      where: {
        OR: [
          { userId: user.id },
          {
            members: {
              some: { userId: user.id, inviteStatus: "accepted" },
            },
          },
        ],
      },
      orderBy: { createdAt: "desc" },
      take: 101,
      include: {
        tournament: {
          select: {
            id: true,
            slug: true,
            title: true,
            game: true,
            status: true,
            startDate: true,
            startDateStatus: true,
            endDate: true,
            endDateStatus: true,
            bannerImageName: true,
            series: {
              select: { id: true, slug: true, title: true },
            },
          },
        },
        payments: {
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    }),
    listProfileTeams({ user }),
    prisma.merchandiseOrder.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 25,
      include: {
        items: true,
        payments: { orderBy: { createdAt: "desc" }, take: 1 },
      },
    }),
    prisma.recruitmentApplication.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 25,
      select: {
        id: true,
        applicationType: true,
        game: true,
        teamName: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
  ]);

  const now = Date.now();
  const registrationsTruncated = registrations.length > 100;
  const mappedRegistrations = registrations.slice(0, 100).map(mapRegistration);
  const isPast = (entry) =>
    ["completed", "cancelled"].includes(entry.tournament.status) ||
    (entry.tournament.endDate &&
      new Date(entry.tournament.endDate).getTime() < now);

  return {
    currentRegistrations: mappedRegistrations.filter((entry) => !isPast(entry)),
    pastRegistrations: mappedRegistrations.filter(isPast),
    teams,
    recruitmentApplications,
    orders: orders.map((order) => ({
      id: order.id,
      publicToken: order.publicToken,
      status: order.status,
      currency: order.currency,
      total: Number(order.total),
      createdAt: order.createdAt,
      itemCount: order.items.reduce((total, item) => total + item.quantity, 0),
      paymentStatus: order.payments[0]?.status || "created",
    })),
    registrationsTruncated,
  };
};

const updateAccountAvatar = async ({ user, file }) => {
  if (!file) {
    throw new HttpError(400, "Choose a profile picture to upload.");
  }

  const persisted = await persistAvatarUpload(file);
  let existing;
  let updated;

  try {
    existing = await prisma.user.findUnique({
      where: { id: user.id },
      select: { avatarImageName: true },
    });
    updated = await prisma.user.update({
      where: { id: user.id },
      data: { avatarImageName: persisted.filename },
      select: PUBLIC_USER_SELECT,
    });
  } catch (error) {
    await removeUploadsQuietly(
      [{ directory: avatarDirectory, filename: persisted.filename }],
      { operation: "rollbackAccountAvatarUpload", userId: user.id }
    );
    throw error;
  }

  if (existing?.avatarImageName) {
    await removeUploadsQuietly(
      [{ directory: avatarDirectory, filename: existing.avatarImageName }],
      { operation: "replaceAccountAvatar", userId: user.id }
    );
  }

  return mapUserForResponse(updated);
};

const removeAccountAvatar = async ({ user }) => {
  const existing = await prisma.user.findUnique({
    where: { id: user.id },
    select: { avatarImageName: true },
  });
  const previousName = existing?.avatarImageName;
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { avatarImageName: null },
    select: PUBLIC_USER_SELECT,
  });

  if (previousName) {
    await removeUploadsQuietly(
      [{ directory: avatarDirectory, filename: previousName }],
      { operation: "removeAccountAvatar", userId: user.id }
    );
  }

  return mapUserForResponse(updated);
};

module.exports = {
  getAccountDashboard,
  updateAccountAvatar,
  removeAccountAvatar,
};
