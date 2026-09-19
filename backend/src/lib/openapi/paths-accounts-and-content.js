const { createOperation, idParameter } = require("./helpers");

const accountsAndContentPaths = {
  "/api/v1/game-accounts/valorant/resolve": {
    post: createOperation(
      "Game accounts",
      "Resolve a Riot ID to its stable identifier and current display identity",
      { authenticated: true },
    ),
  },
  "/api/v1/game-accounts/valorant/link": {
    post: createOperation(
      "Game accounts",
      "Link a resolved VALORANT account to the signed-in Quest account",
      { authenticated: true },
    ),
  },
  "/api/v1/game-accounts/valorant/import-from-leaderboard": {
    post: createOperation(
      "Game accounts",
      "Adopt the VALORANT account already registered on the leaderboard by the signed-in user's connected Discord",
      { authenticated: true },
    ),
  },
  "/api/v1/users/me/game-accounts": {
    get: createOperation("Game accounts", "List the signed-in user's linked game accounts", {
      authenticated: true,
    }),
  },
  "/api/v1/users/me/game-accounts/valorant/leaderboard-registration": {
    get: createOperation(
      "Game accounts",
      "Name the VALORANT account the signed-in user's connected Discord is registered with on the leaderboard",
      { authenticated: true },
    ),
  },
  "/api/v1/game-accounts/valorant/change-request": {
    post: createOperation(
      "Game accounts",
      "Refresh a renamed account, or open an admin-reviewed account replacement",
      { authenticated: true },
    ),
  },
  "/api/v1/game-accounts/valorant/change-request/withdraw": {
    post: createOperation(
      "Game accounts",
      "Withdraw the signed-in user's pending account change before it is reviewed",
      { authenticated: true },
    ),
  },
  "/api/v1/admin/game-accounts/change-requests": {
    get: createOperation("Game accounts", "List game account change requests", {
      authenticated: true,
    }),
  },
  "/api/v1/admin/game-accounts/change-requests/{requestId}/review": {
    post: createOperation("Game accounts", "Approve or reject a game account change request", {
      authenticated: true,
    }),
  },
  "/api/v1/teams/{teamId}/registration-readiness": {
    get: createOperation(
      "Game accounts",
      "Server-computed roster readiness for a saved team, optionally scoped to a tournament",
      { authenticated: true },
    ),
  },
  "/api/contact": {
    post: createOperation("Contact", "Submit a contact message"),
  },
  "/api/recruitment-applications": {
    post: createOperation("Recruitment", "Submit a recruitment application", {
      authenticated: true,
    }),
  },
  "/api/game-categories": {
    get: createOperation("Games", "List public game categories"),
  },
  "/api/games": {
    get: createOperation("Games", "List active games"),
  },
  "/api/players/{publicId}": {
    get: createOperation("Players", "Get a public player profile", {
      parameters: idParameter("publicId"),
    }),
  },
  "/api/rulebooks": {
    get: createOperation("Rulebooks", "List published rulebooks"),
  },
  "/api/rulebooks/{slug}": {
    get: createOperation("Rulebooks", "Get a published rulebook", {
      parameters: idParameter("slug"),
    }),
  },
  "/api/posters": {
    get: createOperation("Media", "List public posters"),
    post: createOperation("Media", "Create a poster", { authenticated: true }),
  },
  "/api/posters/{posterId}": {
    get: createOperation("Media", "Get a public poster", {
      parameters: idParameter("posterId"),
    }),
    delete: createOperation("Media", "Delete a poster", {
      authenticated: true,
      parameters: idParameter("posterId"),
    }),
    patch: createOperation("Media", "Update tournament media", {
      authenticated: true,
      parameters: idParameter("posterId"),
    }),
  },
  "/api/posters/{posterId}/image": {
    get: createOperation("Media", "Stream a poster image", {
      parameters: idParameter("posterId"),
    }),
  },
  "/api/event-albums": {
    get: createOperation("Media", "List published event albums"),
  },
  "/api/event-albums/{slug}": {
    get: createOperation("Media", "Get a published event album", {
      parameters: idParameter("slug"),
    }),
  },
  "/api/event-albums/{slug}/photos/{photoId}/image": {
    get: createOperation("Media", "Stream a published album photo", {
      parameters: [...idParameter("slug"), ...idParameter("photoId")],
    }),
  },
  "/api/admin/event-albums": {
    get: createOperation("Media", "List all event albums", { authenticated: true }),
    post: createOperation("Media", "Create an event album", { authenticated: true }),
  },
  "/api/admin/event-albums/{albumId}": {
    get: createOperation("Media", "Get an event album for editing", {
      authenticated: true,
      parameters: idParameter("albumId"),
    }),
    patch: createOperation("Media", "Update an event album", {
      authenticated: true,
      parameters: idParameter("albumId"),
    }),
    delete: createOperation("Media", "Delete an event album", {
      authenticated: true,
      parameters: idParameter("albumId"),
    }),
  },
  "/api/admin/event-albums/{albumId}/photos": {
    post: createOperation("Media", "Upload event album photos", {
      authenticated: true,
      parameters: idParameter("albumId"),
    }),
  },
  "/api/admin/event-albums/{albumId}/photos/{photoId}/image": {
    get: createOperation("Media", "Stream an event album photo for editing", {
      authenticated: true,
      parameters: [...idParameter("albumId"), ...idParameter("photoId")],
    }),
  },
  "/api/admin/event-albums/{albumId}/photos/reorder": {
    patch: createOperation("Media", "Reorder event album photos", {
      authenticated: true,
      parameters: idParameter("albumId"),
    }),
  },
  "/api/admin/event-albums/{albumId}/photos/{photoId}": {
    delete: createOperation("Media", "Delete an event album photo", {
      authenticated: true,
      parameters: [...idParameter("albumId"), ...idParameter("photoId")],
    }),
  },
  "/api/images": {
    get: createOperation("Media", "List managed images", {
      authenticated: true,
    }),
    post: createOperation("Media", "Upload managed images", {
      authenticated: true,
    }),
  },
  "/api/images/{imageId}": {
    get: createOperation("Media", "Get managed image metadata", {
      authenticated: true,
      parameters: idParameter("imageId"),
    }),
    delete: createOperation("Media", "Delete a managed image", {
      authenticated: true,
      parameters: idParameter("imageId"),
    }),
  },
  "/api/images/{imageId}/binary": {
    get: createOperation("Media", "Stream a managed image", {
      authenticated: true,
      parameters: idParameter("imageId"),
    }),
  },
  "/api/admin/media/files": {
    get: createOperation("Media", "List public upload files", {
      authenticated: true,
    }),
  },
  "/api/teams/profile": {
    get: createOperation("Teams", "List the current user's teams", {
      authenticated: true,
    }),
  },
  "/api/me/invitations": {
    get: createOperation("Teams", "List unanswered invitations addressed to the signed-in user", {
      authenticated: true,
    }),
  },
  "/api/teams": {
    post: createOperation("Teams", "Create a saved team", {
      authenticated: true,
    }),
  },
  "/api/teams/{teamId}": {
    patch: createOperation("Teams", "Update a saved team", {
      authenticated: true,
      parameters: idParameter("teamId"),
    }),
    delete: createOperation("Teams", "Delete a saved team", {
      authenticated: true,
      parameters: idParameter("teamId"),
    }),
  },
  "/api/teams/{teamId}/members/{memberId}/nudge": {
    post: createOperation("Teams", "Remind a member about an unanswered invitation", {
      authenticated: true,
      parameters: [...idParameter("teamId"), ...idParameter("memberId")],
    }),
  },
  // No anonymous preview: an invitation is answered by the identity of whoever
  // signs in to claim it, so there is nothing to show before a session exists.
  "/api/me/invitations/{invitationId}/respond": {
    post: createOperation("Teams", "Accept or decline an invitation addressed to you", {
      authenticated: true,
      parameters: idParameter("invitationId"),
    }),
  },
  "/api/payments/{orderId}/bank-transfer-proof": {
    post: createOperation("Payments", "Upload bank-transfer evidence", {
      authenticated: true,
      parameters: idParameter("orderId"),
    }),
  },
  "/api/products/{productId}/images/{imageId}": {
    get: createOperation("Shop", "Stream a product image", {
      parameters: [...idParameter("productId"), ...idParameter("imageId")],
    }),
  },
};

module.exports = { accountsAndContentPaths };
