const { createQueryParameter, createResponse, createOperation, idParameter } = require("./helpers");

const publicCompetitionPaths = {
  "/api/v1/home": {
    get: createOperation(
      "Foundation",
      "Get the cached homepage tournament and live-match feed",
    ),
  },
  "/api/v1/tournaments/{slug}": {
    get: createOperation("Foundation", "Get slim versioned tournament detail", {
      parameters: [
        ...idParameter("slug"),
        createQueryParameter("participantPage", { type: "integer", minimum: 1 }),
        createQueryParameter("participantPageSize", { type: "integer", minimum: 1, maximum: 50 }),
      ],
    }),
  },
  "/api/v1/tournaments/{slug}/bracket": {
    get: createOperation(
      "Brackets",
      "Get the authoritative Challonge or native bracket snapshot",
      { parameters: idParameter("slug") },
    ),
  },
  "/api/v1/tournaments/{slug}/matches": {
    get: createOperation("Matches", "List a tournament's public matches", {
      parameters: idParameter("slug"),
    }),
  },
  "/api/v1/matches": {
    get: createOperation("Matches", "List paginated public matches"),
  },
  "/api/v1/tournaments/{slug}/results": {
    get: createOperation("Matches", "List a tournament's public VALORANT results", {
      parameters: idParameter("slug"),
    }),
  },
  "/api/v1/admin/valorant/tournaments/{tournamentId}/anchors": {
    get: createOperation("Valorant", "Derive discovery anchors from approved rosters", {
      authenticated: true,
      parameters: idParameter("tournamentId"),
    }),
  },
  "/api/v1/admin/valorant/tournaments/{tournamentId}/fixtures": {
    get: createOperation("Valorant", "List bracket fixtures with their derived anchors", {
      authenticated: true,
      parameters: idParameter("tournamentId"),
    }),
  },
  "/api/v1/admin/valorant/tournaments/{tournamentId}/fixtures/{matchId}/discover": {
    post: createOperation("Valorant", "Propose matches for one fixture using derived anchors", {
      authenticated: true,
      parameters: [...idParameter("tournamentId"), ...idParameter("matchId")],
    }),
  },
  "/api/v1/valorant/series/{seriesId}": {
    get: createOperation("Matches", "Get a public VALORANT match scoreboard", {
      parameters: idParameter("seriesId"),
    }),
  },
  "/api/v1/matches/next": {
    get: createOperation(
      "Matches",
      "Get the next public or authenticated-user match",
    ),
  },
  "/api/v1/events": {
    get: {
      tags: ["Realtime"],
      summary: "Subscribe to public and authorized private invalidation events",
      description:
        "Subscribe to public topics such as matches and brackets, or to authorized user:{userId} and match-room:{code} topics. Events are invalidation hints that trigger a refresh of persisted state; shared transport recovery also sends a public reconciliation update. This endpoint provides no durable replay.",
      security: [{ sessionCookie: [] }, {}],
      parameters: [
        createQueryParameter(
          "topics",
          { type: "string", default: "matches,brackets" },
          "Comma-separated public topics or authorized private topics (user:{userId} and match-room:{code}). Exact topics and their public roots are supported.",
        ),
      ],
      responses: {
        200: {
          description: "SSE stream of invalidation hints",
          content: {
            "text/event-stream": {
              schema: { type: "string" },
            },
          },
        },
        204: createResponse("Realtime disabled; EventSource must not reconnect"),
        401: createResponse("Authentication required for private match-room topics"),
        403: createResponse("The requested private topic is not authorized"),
        429: createResponse("Too many live-update connections"),
        503: createResponse("Clustered realtime transport is unavailable; retry later"),
      },
    },
  },
};

module.exports = { publicCompetitionPaths };
