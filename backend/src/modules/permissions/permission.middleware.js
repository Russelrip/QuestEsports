const { prisma } = require("../../lib/prisma");
const { asyncHandler } = require("../../lib/async-handler");
const { HttpError } = require("../../lib/http-error");

const isSuperAdmin = (user) => user?.role === "admin";

const requireSuperAdmin = (req, res, next) => {
  if (!isSuperAdmin(req.user)) {
    next(new HttpError(403, "Super admin access is required."));
    return;
  }
  next();
};

const requireTournamentStaff = ({
  roles = ["tournament_admin", "referee"],
  parameter = "id",
} = {}) =>
  asyncHandler(async (req, res, next) => {
    if (!req.user) throw new HttpError(401, "You must be logged in to access this resource.");
    if (isSuperAdmin(req.user)) {
      next();
      return;
    }

    const tournamentId = req.params[parameter];
    if (!tournamentId) throw new HttpError(400, "Tournament id is required.");
    const assignment = await prisma.tournamentStaffAssignment.findFirst({
      where: { tournamentId, userId: req.user.id, role: { in: roles } },
      select: { id: true },
    });
    if (!assignment) throw new HttpError(403, "Tournament staff access is required.");
    next();
  });

const requireMatchStaff = ({ roles = ["tournament_admin", "referee"] } = {}) =>
  asyncHandler(async (req, res, next) => {
    if (!req.user) throw new HttpError(401, "You must be logged in to access this resource.");
    if (isSuperAdmin(req.user)) {
      next();
      return;
    }
    const match = await prisma.match.findUnique({
      where: { id: req.params.matchId },
      select: { tournamentId: true },
    });
    if (!match) throw new HttpError(404, "Match not found.");
    const assignment = await prisma.tournamentStaffAssignment.findFirst({
      where: { tournamentId: match.tournamentId, userId: req.user.id, role: { in: roles } },
      select: { id: true },
    });
    if (!assignment) throw new HttpError(403, "Tournament staff access is required.");
    next();
  });

const requireVetoRoomStaff = ({ roles = ["tournament_admin", "referee"] } = {}) =>
  asyncHandler(async (req, res, next) => {
    if (!req.user) throw new HttpError(401, "You must be logged in to access this resource.");
    if (isSuperAdmin(req.user)) {
      next();
      return;
    }
    const room = await prisma.vetoRoom.findUnique({
      where: { id: req.params.roomId },
      select: { id: true, tournamentId: true },
    });
    if (!room) throw new HttpError(404, "Veto room not found.");
    const assignment = await prisma.tournamentStaffAssignment.findFirst({
      where: { tournamentId: room.tournamentId, userId: req.user.id, role: { in: roles } },
      select: { id: true },
    });
    if (!assignment) throw new HttpError(403, "Tournament staff access is required.");
    next();
  });

const requireVetoTournamentStaff = ({
  roles = ["tournament_admin", "referee"],
  parameter = null,
  bodyField = "tournamentId",
} = {}) =>
  asyncHandler(async (req, res, next) => {
    if (!req.user) throw new HttpError(401, "You must be logged in to access this resource.");

    let tournamentId = parameter ? req.params[parameter] : req.body?.[bodyField];
    if (req.body?.matchId) {
      const match = await prisma.match.findUnique({
        where: { id: req.body.matchId },
        select: { tournamentId: true },
      });
      if (!match) throw new HttpError(404, "Match not found.");
      if (tournamentId && tournamentId !== match.tournamentId) {
        throw new HttpError(400, "The tournament does not match the selected match.");
      }
      tournamentId = match.tournamentId;
    }
    if (isSuperAdmin(req.user)) {
      next();
      return;
    }
    if (!tournamentId) throw new HttpError(403, "Tournament staff access is required.");
    const assignment = await prisma.tournamentStaffAssignment.findFirst({
      where: { tournamentId, userId: req.user.id, role: { in: roles } },
      select: { id: true },
    });
    if (!assignment) throw new HttpError(403, "Tournament staff access is required.");
    next();
  });

module.exports = {
  isSuperAdmin,
  requireSuperAdmin,
  requireTournamentStaff,
  requireMatchStaff,
  requireVetoRoomStaff,
  requireVetoTournamentStaff,
};
