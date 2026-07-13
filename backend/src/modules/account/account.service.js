const { prisma } = require("../../lib/prisma");
const { HttpError } = require("../../lib/http-error");
const {
  avatarDirectory,
  persistAvatarUpload,
  removeUploadFile,
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
        status: registration.payments[0].status,
        amount: Number(registration.payments[0].amount),
        currency: registration.payments[0].currency,
      }
    : null,
});

const getAccountDashboard = async ({ user }) => {
  const [registrations, teams, orders] = await Promise.all([
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
  const existing = await prisma.user.findUnique({
    where: { id: user.id },
    select: { avatarImageName: true },
  });
  let updated;

  try {
    updated = await prisma.user.update({
      where: { id: user.id },
      data: { avatarImageName: persisted.filename },
      select: PUBLIC_USER_SELECT,
    });
  } catch (error) {
    await removeUploadFile({ directory: avatarDirectory, filename: persisted.filename });
    throw error;
  }

  if (existing?.avatarImageName) {
    await removeUploadFile({
      directory: avatarDirectory,
      filename: existing.avatarImageName,
    }).catch(() => undefined);
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
    await removeUploadFile({
      directory: avatarDirectory,
      filename: previousName,
    }).catch(() => undefined);
  }

  return mapUserForResponse(updated);
};

module.exports = {
  getAccountDashboard,
  updateAccountAvatar,
  removeAccountAvatar,
};
