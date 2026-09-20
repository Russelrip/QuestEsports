const crypto = require("crypto");
const { prisma } = require("../../lib/prisma");
const { HttpError } = require("../../lib/http-error");
const { valorantRequest } = require("./valorant.client");
const { mapTeamResponse, mapMatchCandidate } = require("./valorant.mapper");
const { normalizeRiotId } = require("./valorant.validation");
const {
  createOperation,
  markOperationSucceeded,
  markOperationFailed,
} = require("./valorant-operations");

const listBindings = async () =>
  prisma.valorantTeamBinding.findMany({
    include: {
      savedTeam: { select: { id: true, name: true, teamTag: true } },
      boundByUser: { select: { id: true, username: true } },
    },
    orderBy: { createdAt: "desc" },
  });

// Admin team list (§6.2): Quest bindings joined with the FastAPI team catalog.
// Join shape (chosen over { bindings, teamsByUuid }): each Quest binding is
// augmented with its mapped FastAPI team under `valorantTeam` (null when the
// team no longer exists upstream). This keeps the controller's existing
// `{ bindings: [...] }` envelope intact and stays JSON-safe — a keyed-by-UUID
// object would need its own response documentation, and a Map would not
// survive res.json.
const listTeams = async ({ actorUserId }) => {
  const [bindings, teamsResponse] = await Promise.all([
    listBindings(),
    valorantRequest({
      method: "GET",
      path: "/api/v1/teams",
      actorUserId,
      operationId: crypto.randomUUID(),
      idempotent: true,
    }),
  ]);
  const teamsByUuid = new Map((teamsResponse.data || []).map((team) => [team.id, mapTeamResponse(team)]));
  return bindings.map((binding) => ({ ...binding, valorantTeam: teamsByUuid.get(binding.valorantTeamUuid) ?? null }));
};

const bindTeam = async ({ savedTeamId, actorUserId }) => {
  const savedTeam = await prisma.savedTeam.findUnique({
    where: { id: savedTeamId },
    select: { id: true, name: true, teamTag: true },
  });
  if (!savedTeam) throw new HttpError(404, "Saved team not found.");

  const existingBinding = await prisma.valorantTeamBinding.findFirst({
    where: { savedTeamId, status: "active" },
    select: { id: true },
  });
  if (existingBinding) {
    throw new HttpError(409, "This team already has an active VALORANT binding.");
  }

  const operation = await createOperation({
    type: "team_bind",
    externalKey: savedTeamId,
    actorUserId,
    requestBody: { saved_team_id: savedTeamId },
  });
  await prisma.questValorantOperation.update({
    where: { id: operation.id },
    data: { status: "in_flight" },
  });

  let response;
  try {
    response = await valorantRequest({
      method: "POST",
      path: "/api/v1/teams",
      body: { name: savedTeam.name, short_name: savedTeam.teamTag, quest_saved_team_id: savedTeamId },
      actorUserId,
      operationId: operation.operationId,
      externalKey: savedTeamId,
      idempotent: true,
    });
  } catch (error) {
    await markOperationFailed(operation.id, error);
    throw error;
  }

  const team = mapTeamResponse(response.data);
  const [binding] = await prisma.$transaction([
    prisma.valorantTeamBinding.create({
      data: {
        savedTeamId,
        valorantTeamUuid: team.id,
        status: "active",
        boundByUserId: actorUserId,
      },
    }),
    prisma.savedTeam.update({
      where: { id: savedTeamId },
      data: { game: "valorant" },
    }),
  ]);
  await markOperationSucceeded(operation.id, response);
  return binding;
};

const detachBinding = async ({ bindingId, actorUserId }) => {
  const binding = await prisma.valorantTeamBinding.findUnique({
    where: { id: bindingId },
    select: { id: true, savedTeamId: true, valorantTeamUuid: true, status: true },
  });
  if (!binding) throw new HttpError(404, "VALORANT binding not found.");
  if (binding.status === "detached") throw new HttpError(409, "This binding is already detached.");

  const operation = await createOperation({
    type: "team_bind",
    externalKey: binding.savedTeamId || undefined,
    actorUserId,
    requestBody: { action: "detach", binding_id: bindingId },
  });

  const updated = await prisma.valorantTeamBinding.update({
    where: { id: bindingId },
    data: { status: "detached", detachedAt: new Date() },
  });
  await markOperationSucceeded(operation.id, { status: 200, requestId: null, data: { bindingId } });
  return updated;
};

const discover = async ({
  playerA,
  playerB,
  pageSize = 10,
  maxPages = 1,
  map = null,
  from = null,
  actorUserId,
}) => {
  const anchorA = normalizeRiotId(playerA);
  const anchorB = normalizeRiotId(playerB);
  const response = await valorantRequest({
    method: "POST",
    path: "/api/v1/match-search/two-player",
    body: {
      player_a: anchorA,
      player_b: anchorB,
      page_size: pageSize,
      max_pages: maxPages,
      ...(map ? { map } : {}),
      ...(from ? { from: new Date(from).toISOString() } : {}),
    },
    actorUserId,
    operationId: crypto.randomUUID(),
    idempotent: true,
  });
  return {
    players: response.data.players || {},
    candidates: (response.data.candidates || []).map(mapMatchCandidate),
    search: response.data.search || { pagesExamined: 0, pageSize },
  };
};

module.exports = {
  listBindings,
  listTeams,
  bindTeam,
  detachBinding,
  discover,
};
