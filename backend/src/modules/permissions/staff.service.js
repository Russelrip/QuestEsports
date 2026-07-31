const crypto = require("crypto");
const { prisma } = require("../../lib/prisma");
const { HttpError } = require("../../lib/http-error");
const { normalizeText } = require("../../lib/validation");

const STAFF_ROLES = new Set(["tournament_admin", "referee"]);

const mapAssignment = (assignment) => ({
  id: assignment.id,
  tournamentId: assignment.tournamentId,
  userId: assignment.userId,
  role: assignment.role,
  user: assignment.user
    ? {
        id: assignment.user.id,
        username: assignment.user.username,
        firstName: assignment.user.firstName,
        lastName: assignment.user.lastName,
      }
    : undefined,
  createdAt: assignment.createdAt,
  updatedAt: assignment.updatedAt,
});

const listTournamentStaff = async (tournamentId) => {
  const rows = await prisma.tournamentStaffAssignment.findMany({
    where: { tournamentId },
    include: {
      user: { select: { id: true, username: true, firstName: true, lastName: true } },
    },
    orderBy: [{ role: "asc" }, { createdAt: "asc" }],
  });
  return rows.map(mapAssignment);
};

const assignTournamentStaff = async ({ tournamentId, body }) => {
  const userId = normalizeText(body.userId);
  const role = normalizeText(body.role).toLowerCase();
  if (!userId || !STAFF_ROLES.has(role)) {
    throw new HttpError(400, "A valid user and tournament staff role are required.");
  }
  const [tournament, user] = await Promise.all([
    prisma.tournament.findUnique({ where: { id: tournamentId }, select: { id: true } }),
    prisma.user.findUnique({ where: { id: userId }, select: { id: true } }),
  ]);
  if (!tournament) throw new HttpError(404, "Tournament not found.");
  if (!user) throw new HttpError(404, "User not found.");

  const assignment = await prisma.tournamentStaffAssignment.upsert({
    where: { tournamentId_userId_role: { tournamentId, userId, role } },
    create: { id: crypto.randomUUID(), tournamentId, userId, role },
    update: {},
    include: {
      user: { select: { id: true, username: true, firstName: true, lastName: true } },
    },
  });
  return mapAssignment(assignment);
};

const removeTournamentStaff = async ({ tournamentId, assignmentId }) => {
  const deleted = await prisma.tournamentStaffAssignment.deleteMany({
    where: { id: assignmentId, tournamentId },
  });
  if (!deleted.count) throw new HttpError(404, "Tournament staff assignment not found.");
};

module.exports = {
  listTournamentStaff,
  assignTournamentStaff,
  removeTournamentStaff,
};
