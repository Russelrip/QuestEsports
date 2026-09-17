const { prisma } = require("../../lib/prisma");
const { asyncHandler } = require("../../lib/async-handler");
const { HttpError } = require("../../lib/http-error");
const { hasStaffPermission, isAdmin, isSuperAdmin, STAFF_PERMISSION_KEYS } = require("./staff-permission.service");

const PERMISSION_SCOPES = Object.freeze({
  TOURNAMENT_READ: "tournament.read",
  TOURNAMENT_ADMINISTRATION: "tournament.administration",
  STAFF_ROSTER_MANAGEMENT: "staff.roster.management",
  MATCH_OPERATIONS: "match.operations",
  VETO_OPERATIONS: "veto.operations",
  VETO_CATALOG_CONFIG: "veto.catalog.config",
});

// Staff roster management is deliberately absent: only admins assign tournament
// staff (docs/roles-and-permissions.md), so a tournament admin cannot grant
// themselves or anyone else a place on the roster.
const TOURNAMENT_ADMIN_SCOPES = Object.freeze([
  PERMISSION_SCOPES.TOURNAMENT_READ,
  PERMISSION_SCOPES.TOURNAMENT_ADMINISTRATION,
  PERMISSION_SCOPES.MATCH_OPERATIONS,
  PERMISSION_SCOPES.VETO_OPERATIONS,
  PERMISSION_SCOPES.VETO_CATALOG_CONFIG,
]);

const ROLE_SCOPES = Object.freeze({
  admin: Object.freeze(Object.values(PERMISSION_SCOPES)),
  tournament_admin: TOURNAMENT_ADMIN_SCOPES,
  referee: Object.freeze([
    PERMISSION_SCOPES.TOURNAMENT_READ,
    PERMISSION_SCOPES.MATCH_OPERATIONS,
    PERMISSION_SCOPES.VETO_OPERATIONS,
  ]),
});

const validScopes = new Set(Object.values(PERMISSION_SCOPES));

// Tournament-scoped operations that a site-wide staff area also opens, for every
// tournament. Someone with the `tournaments` area runs the whole tournament
// editor, and the Challonge panel in it sits behind tournament administration.
// Match and veto operations are not here: those stay with tournament staff.
const SITE_AREA_FOR_SCOPE = Object.freeze({
  [PERMISSION_SCOPES.TOURNAMENT_ADMINISTRATION]: "tournaments",
});

const suppliedValues = (...values) => values.filter((value) => value !== undefined && value !== null && value !== "");

const requestIdentifiers = (req, parameter, bodyField, queryField) => suppliedValues(
  parameter ? req.params?.[parameter] : undefined,
  bodyField ? req.body?.[bodyField] : undefined,
  queryField ? req.query?.[queryField] : undefined,
);

const matchingIdentifier = (values, message) => {
  const identifier = values[0];
  if (values.some((value) => value !== identifier)) throw new HttpError(400, message);
  return identifier || null;
};

const resolveTournamentId = async (req, {
  parameter,
  bodyField = "tournamentId",
  queryField = "tournamentId",
  matchParameter = "matchId",
  matchBodyField = "matchId",
  matchQueryField = "matchId",
  roomParameter = "roomId",
  roomBodyField = "roomId",
  roomQueryField = "roomId",
} = {}) => {
  const explicitTournamentId = matchingIdentifier([
    ...(parameter ? requestIdentifiers(req, parameter, null, null) : suppliedValues(req.params?.tournamentId, req.params?.id)),
    ...(bodyField ? suppliedValues(req.body?.[bodyField]) : []),
    ...(queryField ? suppliedValues(req.query?.[queryField]) : []),
  ], "The tournament identifiers do not match.");

  const matchId = matchingIdentifier(
    requestIdentifiers(req, matchParameter, matchBodyField, matchQueryField),
    "The match identifiers do not match.",
  );
  const roomId = matchingIdentifier(
    requestIdentifiers(req, roomParameter, roomBodyField, roomQueryField),
    "The room identifiers do not match.",
  );
  let derivedTournamentId = null;
  let resourceResolved = false;

  if (matchId) {
    const match = await prisma.match.findUnique({
      where: { id: matchId },
      select: { tournamentId: true },
    });
    if (!match) throw new HttpError(404, "Match not found.");
    derivedTournamentId = match.tournamentId;
    resourceResolved = true;
  }

  if (roomId) {
    const room = await prisma.vetoRoom.findUnique({
      where: { id: roomId },
      select: { tournamentId: true },
    });
    if (!room) throw new HttpError(404, "Veto room not found.");
    if (resourceResolved && derivedTournamentId !== room.tournamentId) {
      throw new HttpError(400, "The tournament does not match the selected room.");
    }
    derivedTournamentId = room.tournamentId;
    resourceResolved = true;
  }

  if (explicitTournamentId && resourceResolved && explicitTournamentId !== derivedTournamentId) {
    throw new HttpError(400, "The tournament does not match the selected resource.");
  }
  const resolvedTournamentId = derivedTournamentId || explicitTournamentId || null;
  if (explicitTournamentId) {
    const tournament = await prisma.tournament.findUnique({
      where: { id: explicitTournamentId },
      select: { id: true },
    });
    if (!tournament) throw new HttpError(404, "Tournament not found.");
  }
  return resolvedTournamentId;
};

const requirePermission = (scope, options = {}) =>
  asyncHandler(async (req, res, next) => {
    if (!req.user) throw new HttpError(401, "You must be logged in to access this resource.");
    if (!scope) throw new HttpError(400, "Permission scope is required.");
    if (!validScopes.has(scope)) throw new HttpError(400, "Unknown permission scope.");

    const tournamentId = await resolveTournamentId(req, options);
    if (isAdmin(req.user)) {
      next();
      return;
    }
    if (SITE_AREA_FOR_SCOPE[scope] && await hasStaffPermission(req.user, SITE_AREA_FOR_SCOPE[scope])) {
      next();
      return;
    }
    if (!tournamentId && !options.allowUnscoped) throw new HttpError(403, "Tournament staff access is required.");

    const roles = Object.entries(ROLE_SCOPES)
      .filter(([, scopes]) => scopes.includes(scope))
      .map(([role]) => role)
      .filter((role) => role !== "admin");
    const assignment = await prisma.tournamentStaffAssignment.findFirst({
      where: {
        ...(tournamentId ? { tournamentId } : {}),
        userId: req.user.id,
        role: { in: roles },
      },
      select: { id: true },
    });
    if (!assignment && options.allowDirectMatchAssignment && options.allowUnscoped && !tournamentId) {
      const directMatchRoom = await prisma.matchRoom.findFirst({
        where: { match: { assignedStaffId: req.user.id } },
        select: { id: true },
      });
      if (!directMatchRoom) throw new HttpError(403, "Tournament staff access is required.");
    } else if (!assignment) {
      throw new HttpError(403, "Tournament staff access is required.");
    }
    next();
  });

// Route-level defence in depth for the public veto code routes. `veto.service`
// remains the authority on who may read or mutate a room; these guards only
// reject callers that cannot possibly be authorized, using the same status
// codes the service already returns, before any room lookup happens.
const VETO_ROOM_CODE_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

const requireVetoRoomCode = (req, res, next) => {
  const code = String(req.params?.code ?? "").trim();
  if (!VETO_ROOM_CODE_PATTERN.test(code)) {
    next(new HttpError(404, "Veto room not found."));
    return;
  }
  next();
};

const requireVetoRoomCredential = (req, res, next) => {
  if (req.user) {
    next();
    return;
  }
  if (String(req.headers?.["x-veto-token"] ?? "").trim()) {
    next();
    return;
  }
  next(new HttpError(401, "This veto room requires an authorized account or access link."));
};

// The owner tier: making or unmaking admins and managing staff roles. An admin
// without the flag is refused.
const requireSuperAdmin = (req, res, next) => {
  if (!req.user) {
    next(new HttpError(401, "You must be logged in to access this resource."));
    return;
  }
  if (!isSuperAdmin(req.user)) {
    next(new HttpError(403, "Super admin access is required."));
    return;
  }
  next();
};

// Site-wide admin areas granted through staff roles (see
// staff-permission.service). Admins pass; anyone else needs a role granting at
// least one of `permissions`. Pass several when a read is shared between pages,
// such as the tournament list the album and registration screens pick from.
// Unknown areas fail closed at startup rather than silently letting nobody — or
// everybody — through.
const requireStaffPermission = (...permissions) => {
  if (permissions.length === 0) throw new Error("requireStaffPermission needs at least one area.");
  for (const permission of permissions) {
    if (!STAFF_PERMISSION_KEYS.includes(permission)) {
      throw new Error(`Unknown staff permission: ${permission}`);
    }
  }
  return asyncHandler(async (req, res, next) => {
    if (!req.user) throw new HttpError(401, "You must be logged in to access this resource.");
    if (!(await hasStaffPermission(req.user, ...permissions))) {
      throw new HttpError(403, "You do not have access to this area.");
    }
    next();
  });
};

const requireTournamentStaff = ({
  roles = ["tournament_admin", "referee"],
  parameter = "id",
} = {}) =>
  asyncHandler(async (req, res, next) => {
    if (!req.user) throw new HttpError(401, "You must be logged in to access this resource.");
    if (isAdmin(req.user)) {
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
    if (isAdmin(req.user)) {
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
    if (isAdmin(req.user)) {
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
    if (isAdmin(req.user)) {
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
  isAdmin,
  isSuperAdmin,
  PERMISSION_SCOPES,
  SCOPES: PERMISSION_SCOPES,
  ROLE_SCOPES,
  resolveTournamentId,
  requirePermission,
  requireSuperAdmin,
  requireStaffPermission,
  requireTournamentStaff,
  requireMatchStaff,
  requireVetoRoomStaff,
  requireVetoTournamentStaff,
  requireVetoRoomCode,
  requireVetoRoomCredential,
};
