const { PERMISSION_SCOPES } = require("../../modules/permissions/permission.middleware");
const { createQueryParameter, createOperation, idParameter } = require("./helpers");

const vetoPaths = {
  "/api/v1/veto-rooms/mine": {
    get: createOperation("Veto", "List the signed-in captain's active veto rooms", { authenticated: true }),
  },
  "/api/v1/veto-rooms/{code}": {
    get: createOperation("Veto", "Get an authorized live or published veto room", { parameters: idParameter("code") }),
  },
  "/api/v1/veto-rooms/{code}/ready": {
    post: createOperation("Veto", "Set team readiness using account or role-link authority", { parameters: idParameter("code") }),
  },
  "/api/v1/veto-rooms/{code}/toss": {
    post: createOperation("Veto", "Call and atomically resolve a digital Heads or Tails toss", { parameters: idParameter("code") }),
  },
  "/api/v1/veto-rooms/{code}/team-a": {
    post: createOperation("Veto", "Let the toss winner choose Team A or Team B and start the veto", { parameters: idParameter("code") }),
  },
  "/api/v1/veto-rooms/{code}/actions": {
    post: createOperation("Veto", "Commit the current authorized ban, pick, or side choice", { parameters: idParameter("code") }),
  },
  "/api/v1/admin/veto/catalog": {
    get: createOperation("Veto", "List maps, versioned pools, presets, and room templates", {
      authenticated: true,
      permissionScopes: [PERMISSION_SCOPES.VETO_CATALOG_CONFIG],
      parameters: [createQueryParameter(
        "tournamentId",
        { type: "string" },
        "Optional; omit it for global catalog reads, or provide it to scope the catalog to a tournament.",
      )],
    }),
  },
  "/api/v1/admin/veto/maps": {
    post: createOperation("Veto", "Create a map in the veto catalog", { authenticated: true }),
  },
  "/api/v1/admin/veto/maps/{id}": {
    patch: createOperation("Veto", "Enable or disable a map in the veto catalog", { authenticated: true, parameters: idParameter("id") }),
  },
  "/api/v1/admin/veto/pools": {
    post: createOperation("Veto", "Create a versioned map pool", {
      authenticated: true,
      permissionScopes: [PERMISSION_SCOPES.VETO_CATALOG_CONFIG],
    }),
  },
  "/api/v1/admin/veto/presets": {
    post: createOperation("Veto", "Create a versioned veto rule preset", {
      authenticated: true,
      permissionScopes: [PERMISSION_SCOPES.VETO_CATALOG_CONFIG],
    }),
  },
  "/api/v1/admin/veto/templates": {
    post: createOperation("Veto", "Save a reusable room template", {
      authenticated: true,
      permissionScopes: [PERMISSION_SCOPES.VETO_CATALOG_CONFIG],
    }),
  },
  "/api/v1/admin/tournaments/{id}/veto-config": {
    get: createOperation("Veto", "Get a tournament's default veto configuration", {
      authenticated: true,
      permissionScopes: [PERMISSION_SCOPES.VETO_CATALOG_CONFIG],
      parameters: idParameter("id"),
    }),
    put: createOperation("Veto", "Set a tournament's default veto configuration", {
      authenticated: true,
      permissionScopes: [PERMISSION_SCOPES.VETO_CATALOG_CONFIG],
      parameters: idParameter("id"),
    }),
  },
  "/api/v1/admin/veto-rooms": {
    get: createOperation("Veto", "List veto rooms available to staff", {
      authenticated: true,
      permissionScopes: [PERMISSION_SCOPES.TOURNAMENT_READ],
      parameters: [createQueryParameter(
        "tournamentId",
        { type: "string" },
        "Optional; without it, the service returns rooms for the authenticated staff assignments.",
      )],
    }),
    post: createOperation("Veto", "Create a linked or standalone veto room", {
      authenticated: true,
      permissionScopes: [PERMISSION_SCOPES.VETO_OPERATIONS],
    }),
  },
  "/api/v1/admin/veto-rooms/{roomId}": {
    delete: createOperation("Veto", "Delete a draft, cancelled, or completed veto room", { authenticated: true, permissionScopes: [PERMISSION_SCOPES.VETO_OPERATIONS], parameters: idParameter("roomId") }),
    get: createOperation("Veto", "Get a veto room for staff operation", {
      authenticated: true,
      permissionScopes: [PERMISSION_SCOPES.TOURNAMENT_READ],
      parameters: idParameter("roomId"),
    }),
  },
  "/api/v1/admin/veto-rooms/{roomId}/start": {
    post: createOperation("Veto", "Start or force-start the toss/veto lifecycle", { authenticated: true, permissionScopes: [PERMISSION_SCOPES.VETO_OPERATIONS], parameters: idParameter("roomId") }),
  },
  "/api/v1/admin/veto-rooms/{roomId}/open": {
    post: createOperation("Veto", "Open a room for team readiness", { authenticated: true, permissionScopes: [PERMISSION_SCOPES.VETO_OPERATIONS], parameters: idParameter("roomId") }),
  },
  "/api/v1/admin/veto-rooms/{roomId}/assign-team-a": {
    post: createOperation("Veto", "Manually assign Team A and Team B", { authenticated: true, permissionScopes: [PERMISSION_SCOPES.VETO_OPERATIONS], parameters: idParameter("roomId") }),
  },
  "/api/v1/admin/veto-rooms/{roomId}/manual-toss": {
    post: createOperation("Veto", "Record the result of a physical coin toss", { authenticated: true, permissionScopes: [PERMISSION_SCOPES.VETO_OPERATIONS], parameters: idParameter("roomId") }),
  },
  "/api/v1/admin/veto-rooms/{roomId}/rewind": {
    post: createOperation("Veto", "Audit and rewind the latest committed veto action", { authenticated: true, permissionScopes: [PERMISSION_SCOPES.VETO_OPERATIONS], parameters: idParameter("roomId") }),
  },
  "/api/v1/admin/veto-rooms/{roomId}/reset": {
    post: createOperation("Veto", "Audit and reset a room to its pre-veto state", { authenticated: true, permissionScopes: [PERMISSION_SCOPES.VETO_OPERATIONS], parameters: idParameter("roomId") }),
  },
  "/api/v1/admin/veto-rooms/{roomId}/cancel": {
    post: createOperation("Veto", "Cancel an active veto room", { authenticated: true, permissionScopes: [PERMISSION_SCOPES.VETO_OPERATIONS], parameters: idParameter("roomId") }),
  },
  "/api/v1/admin/veto-rooms/{roomId}/rotate-link": {
    post: createOperation("Veto", "Rotate a private team or viewer access link", { authenticated: true, permissionScopes: [PERMISSION_SCOPES.VETO_OPERATIONS], parameters: idParameter("roomId") }),
  },
  "/api/v1/admin/tournaments/{id}/challonge": {
    get: createOperation("Challonge", "Get Challonge integration status", {
      authenticated: true,
      permissionScopes: [PERMISSION_SCOPES.TOURNAMENT_ADMINISTRATION],
      parameters: idParameter("id"),
    }),
    patch: createOperation("Challonge", "Configure a Challonge integration", {
      authenticated: true,
      permissionScopes: [PERMISSION_SCOPES.TOURNAMENT_ADMINISTRATION],
      parameters: idParameter("id"),
    }),
  },
  "/api/v1/admin/tournaments/{id}/challonge/sync": {
    post: createOperation("Challonge", "Synchronize a Challonge tournament", {
      authenticated: true,
      permissionScopes: [PERMISSION_SCOPES.TOURNAMENT_ADMINISTRATION],
      parameters: idParameter("id"),
    }),
  },
  "/api/v1/admin/tournaments/{id}/challonge/logs": {
    get: createOperation("Challonge", "List sanitized synchronization logs", {
      authenticated: true,
      permissionScopes: [PERMISSION_SCOPES.TOURNAMENT_ADMINISTRATION],
      parameters: idParameter("id"),
    }),
  },
  "/api/v1/admin/tournaments/{id}/challonge/participants": {
    post: createOperation(
      "Challonge",
      "Create a participant in a connected Challonge tournament",
      { authenticated: true, permissionScopes: [PERMISSION_SCOPES.TOURNAMENT_ADMINISTRATION], parameters: idParameter("id") },
    ),
  },
  "/api/v1/admin/tournaments/{id}/challonge/participants/{participantId}": {
    put: createOperation("Challonge", "Update a participant in Challonge", {
      authenticated: true,
      permissionScopes: [PERMISSION_SCOPES.TOURNAMENT_ADMINISTRATION],
      parameters: [...idParameter("id"), ...idParameter("participantId")],
    }),
    delete: createOperation(
      "Challonge",
      "Delete or deactivate a participant in Challonge",
      {
        authenticated: true,
        permissionScopes: [PERMISSION_SCOPES.TOURNAMENT_ADMINISTRATION],
        parameters: [...idParameter("id"), ...idParameter("participantId")],
      },
    ),
  },
  "/api/v1/admin/tournaments/{id}/challonge/participant-mappings/{participantId}":
    {
      patch: createOperation(
        "Challonge",
        "Confirm an external participant mapping",
        {
          authenticated: true,
          permissionScopes: [PERMISSION_SCOPES.TOURNAMENT_ADMINISTRATION],
          parameters: [...idParameter("id"), ...idParameter("participantId")],
        },
      ),
    },
  "/api/v1/admin/tournaments/{id}/challonge/state": {
    put: createOperation(
      "Challonge",
      "Change the connected Challonge tournament state",
      { authenticated: true, permissionScopes: [PERMISSION_SCOPES.TOURNAMENT_ADMINISTRATION], parameters: idParameter("id") },
    ),
  },
  "/api/v1/admin/tournaments/{id}/challonge/matches/{matchId}": {
    put: createOperation("Challonge", "Report a Challonge match result", {
      authenticated: true,
      permissionScopes: [PERMISSION_SCOPES.TOURNAMENT_ADMINISTRATION],
      parameters: [...idParameter("id"), ...idParameter("matchId")],
    }),
  },
  "/api/v1/admin/tournaments/{id}/matches": {
    get: createOperation("Matches", "List tournament matches for staff", {
      authenticated: true,
      permissionScopes: [PERMISSION_SCOPES.TOURNAMENT_READ],
      parameters: idParameter("id"),
    }),
    post: createOperation("Matches", "Create a Quest-managed match", {
      authenticated: true,
      permissionScopes: [PERMISSION_SCOPES.MATCH_OPERATIONS],
      parameters: idParameter("id"),
    }),
  },
  "/api/v1/admin/matches/{matchId}": {
    patch: createOperation("Matches", "Update Quest-owned match operations", {
      authenticated: true,
      permissionScopes: [PERMISSION_SCOPES.MATCH_OPERATIONS],
      parameters: idParameter("matchId"),
    }),
  },
  "/api/v1/admin/matches/{matchId}/room": {
    post: createOperation("Match Rooms", "Create or resynchronize a match room", { authenticated: true, permissionScopes: [PERMISSION_SCOPES.MATCH_OPERATIONS], parameters: idParameter("matchId") }),
    delete: createOperation("Match Rooms", "Delete the room of a finished match with its chat and support history", { authenticated: true, permissionScopes: [PERMISSION_SCOPES.MATCH_OPERATIONS], parameters: idParameter("matchId") }),
  },
  "/api/v1/admin/tournaments/{id}/match-rooms": {
    post: createOperation("Match Rooms", "Create or resync rooms for every eligible match in a tournament", { authenticated: true, permissionScopes: [PERMISSION_SCOPES.MATCH_OPERATIONS], parameters: idParameter("id") }),
  },
  "/api/v1/admin/match-rooms": {
    get: createOperation("Match Rooms", "List match rooms visible to tournament staff or directly assigned match staff", {
      authenticated: true,
      permissionScopes: [PERMISSION_SCOPES.TOURNAMENT_READ],
    }),
  },
  "/api/v1/admin/tournaments/{id}/staff": {
    get: createOperation("Permissions", "List tournament staff assignments", {
      authenticated: true,
      permissionScopes: [PERMISSION_SCOPES.STAFF_ROSTER_MANAGEMENT],
      requiredGlobalRole: "admin",
      permissionDescription: "Requires the global admin role and the staff.roster.management scope; a tournament_admin assignment alone is insufficient.",
      parameters: idParameter("id"),
    }),
    post: createOperation("Permissions", "Assign tournament staff", {
      authenticated: true,
      permissionScopes: [PERMISSION_SCOPES.STAFF_ROSTER_MANAGEMENT],
      requiredGlobalRole: "admin",
      permissionDescription: "Requires the global admin role and the staff.roster.management scope; a tournament_admin assignment alone is insufficient.",
      parameters: idParameter("id"),
    }),
  },
  "/api/v1/admin/tournaments/{id}/staff/{assignmentId}": {
    delete: createOperation(
      "Permissions",
      "Remove a tournament staff assignment",
      {
        authenticated: true,
        permissionScopes: [PERMISSION_SCOPES.STAFF_ROSTER_MANAGEMENT],
        requiredGlobalRole: "admin",
        permissionDescription: "Requires the global admin role and the staff.roster.management scope; a tournament_admin assignment alone is insufficient.",
        parameters: [...idParameter("id"), ...idParameter("assignmentId")],
      },
    ),
  },
};

module.exports = { vetoPaths };
