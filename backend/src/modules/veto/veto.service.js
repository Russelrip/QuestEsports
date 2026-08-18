const crypto = require("crypto");
const { prisma } = require("../../lib/prisma");
const { HttpError } = require("../../lib/http-error");
const { normalizeText } = require("../../lib/validation");

const FORMATS = new Set(["bo1", "bo3", "bo5", "premier", "custom"]);
const CONTROL_MODES = new Set(["captain_or_link", "link_only", "staff_only"]);
const ORDER_METHODS = new Set(["toss", "slot_order", "higher_seed", "lower_seed", "staff_assignment"]);
const TOSS_METHODS = new Set(["digital", "manual"]);
const ACTION_KINDS = new Set(["ban", "pick", "side"]);
const SIDES = new Set(["attack", "defense"]);
const TEAM_COLORS = ["#22d3ee", "#fb7185"];

const roomInclude = {
  tournament: { select: { id: true, slug: true, title: true, game: true } },
  match: { select: { id: true, identifier: true, status: true, scheduledAt: true } },
  participants: { orderBy: { slot: "asc" } },
  actions: { where: { invalidatedAt: null }, orderBy: [{ sequence: "asc" }, { createdAt: "asc" }] },
};

const randomCode = () => crypto.randomBytes(7).toString("base64url").toLowerCase();
const randomToken = () => crypto.randomBytes(32).toString("hex");
const hashToken = (token) => crypto.createHash("sha256").update(String(token || "")).digest("hex");

const parseRevision = (value) => {
  const revision = Number(value);
  if (!Number.isInteger(revision) || revision < 0) throw new HttpError(400, "A valid room revision is required.");
  return revision;
};

const parseSlot = (value, label = "Team slot") => {
  const slot = Number(value);
  if (![1, 2].includes(slot)) throw new HttpError(400, `${label} must be 1 or 2.`);
  return slot;
};

const normalizeSettings = (body = {}) => {
  const controlMode = normalizeText(body.controlMode) || "captain_or_link";
  const teamOrderMethod = normalizeText(body.teamOrderMethod) || "toss";
  const tossMethod = normalizeText(body.tossMethod) || "digital";
  if (!CONTROL_MODES.has(controlMode)) throw new HttpError(400, "Invalid veto control mode.");
  if (!ORDER_METHODS.has(teamOrderMethod)) throw new HttpError(400, "Invalid team-order method.");
  if (!TOSS_METHODS.has(tossMethod)) throw new HttpError(400, "Invalid toss method.");
  const turnSeconds = body.turnSeconds === null || body.turnSeconds === "" || body.turnSeconds === undefined
    ? null
    : Number(body.turnSeconds);
  if (turnSeconds !== null && (!Number.isInteger(turnSeconds) || turnSeconds < 10 || turnSeconds > 900)) {
    throw new HttpError(400, "Turn timer must be between 10 and 900 seconds.");
  }
  return {
    controlMode,
    teamOrderMethod,
    tossMethod,
    tossCallerSlot: parseSlot(body.tossCallerSlot || 2, "Toss caller"),
    turnSeconds,
    viewerEnabled: Boolean(body.viewerEnabled),
    publishResult: Boolean(body.publishResult),
  };
};

const validateSteps = (steps, format = "custom", mapCount = 7) => {
  if (!Array.isArray(steps) || steps.length < 1 || steps.length > 40) throw new HttpError(400, "A preset needs between 1 and 40 steps.");
  let consumed = 0;
  let played = 0;
  const selectedSeries = new Set();
  let deciderIndex = -1;
  let premierBanCount = 0;
  const normalized = steps.map((raw, index) => {
    const kind = normalizeText(raw?.kind).toLowerCase();
    if (!["ban", "pick", "decider", "side"].includes(kind)) throw new HttpError(400, `Preset step ${index + 1} has an invalid action.`);
    const actor = raw.actor === null || raw.actor === undefined ? null : normalizeText(raw.actor).toUpperCase();
    if (kind !== "decider" && !["A", "B"].includes(actor)) throw new HttpError(400, `Preset step ${index + 1} needs Team A or Team B.`);
    if (format === "premier" && kind === "ban") {
      const expectedActor = premierBanCount % 2 === 0 ? "A" : "B";
      if (actor !== expectedActor) throw new HttpError(400, `Premier ban ${premierBanCount + 1} must be made by Team ${expectedActor}.`);
      premierBanCount += 1;
    }
    if (format === "premier" && kind === "side") throw new HttpError(400, "Premier format does not support side selection.");
    const seriesIndex = raw.seriesIndex === undefined || raw.seriesIndex === null ? null : Number(raw.seriesIndex);
    if (["pick", "decider", "side"].includes(kind) && (!Number.isInteger(seriesIndex) || seriesIndex < 1 || seriesIndex > 9)) {
      throw new HttpError(400, `Preset step ${index + 1} needs a valid series map number.`);
    }
    if (["ban", "pick", "decider"].includes(kind)) consumed += 1;
    if (["pick", "decider"].includes(kind)) {
      if (selectedSeries.has(seriesIndex)) throw new HttpError(400, `Series map ${seriesIndex} is selected more than once.`);
      selectedSeries.add(seriesIndex);
      played += 1;
    }
    if (kind === "decider") {
      if (deciderIndex !== -1) throw new HttpError(400, "A preset can contain only one automatic decider.");
      deciderIndex = index;
      if (consumed !== mapCount) throw new HttpError(400, "The automatic decider must leave exactly one map in the selected pool.");
    } else if (deciderIndex !== -1 && (format === "premier" || ["ban", "pick"].includes(kind))) {
      throw new HttpError(400, format === "premier"
        ? "No manual step can follow the automatic decider in Premier format."
        : "No map can be banned or picked after the automatic decider.");
    }
    return { kind, actor: kind === "decider" ? null : actor, seriesIndex };
  });
  const expectedPlayed = format === "bo1" || format === "premier" ? 1 : format === "bo3" ? 3 : format === "bo5" ? 5 : played;
  if (played !== expectedPlayed) throw new HttpError(400, `${format.toUpperCase()} requires ${expectedPlayed} played map${expectedPlayed === 1 ? "" : "s"}.`);
  if (consumed > mapCount) throw new HttpError(400, "The preset consumes more maps than the selected pool contains.");
  if (format !== "custom" && [...selectedSeries].sort((a, b) => a - b).some((value, index) => value !== index + 1)) {
    throw new HttpError(400, "Played maps must use consecutive series numbers starting at 1.");
  }
  return normalized;
};

const builtInSteps = {
  bo1: [
    ["ban", "A"], ["ban", "B"], ["ban", "A"], ["ban", "B"], ["ban", "A"], ["ban", "B"],
    ["decider", null, 1], ["side", "A", 1],
  ],
  bo3: [
    ["ban", "A"], ["ban", "B"], ["pick", "A", 1], ["side", "B", 1],
    ["pick", "B", 2], ["side", "A", 2], ["ban", "A"], ["ban", "B"],
    ["decider", null, 3], ["side", "A", 3],
  ],
  bo5: [
    ["ban", "A"], ["ban", "B"], ["pick", "A", 1], ["side", "B", 1],
    ["pick", "B", 2], ["side", "A", 2], ["pick", "A", 3], ["side", "B", 3],
    ["pick", "B", 4], ["side", "A", 4], ["decider", null, 5], ["side", "A", 5],
  ],
  premier: [
    ["ban", "A"], ["ban", "B"], ["ban", "A"], ["ban", "B"], ["ban", "A"], ["ban", "B"],
    ["decider", null, 1],
  ],
};

const normalizeArtworkPath = (value) => {
  const artworkUrl = normalizeText(value) || null;
  if (artworkUrl !== null && !artworkUrl.startsWith("/api/uploads/") && !artworkUrl.startsWith("/images/")) {
    throw new HttpError(400, "Map artwork must use a project-relative upload path.");
  }
  return artworkUrl;
};

const getBuiltInSteps = (format) => (builtInSteps[format] || []).map(([kind, actor, seriesIndex]) => ({ kind, actor, seriesIndex: seriesIndex || null }));

const isStaffForTournament = async (user, tournamentId, roles = ["tournament_admin", "referee"]) => {
  if (user?.role === "admin") return true;
  if (!user || !tournamentId) return false;
  return Boolean(await prisma.tournamentStaffAssignment.findFirst({
    where: { tournamentId, userId: user.id, role: { in: roles } },
    select: { id: true },
  }));
};

const requireRoomStaff = async (user, room, roles) => {
  if (!(await isStaffForTournament(user, room.tournamentId, roles))) throw new HttpError(403, "Tournament staff access is required.");
};

const captainSlotForUser = async (room, user) => {
  if (!user) return null;
  const registrationIds = room.participants.map((entry) => entry.registrationId).filter(Boolean);
  if (!registrationIds.length) return null;
  const registrations = await prisma.teamRegistration.findMany({
    where: {
      id: { in: registrationIds },
      OR: [{ userId: user.id }, { savedTeam: { captainUserId: user.id } }],
    },
    select: { id: true },
  });
  const ids = new Set(registrations.map((entry) => entry.id));
  return room.participants.find((entry) => entry.registrationId && ids.has(entry.registrationId))?.slot || null;
};

const participantSlotForUser = async (room, user) => {
  if (!user) return null;
  const registrationIds = room.participants.map((entry) => entry.registrationId).filter(Boolean);
  if (!registrationIds.length) return null;
  const registrations = await prisma.teamRegistration.findMany({
    where: {
      id: { in: registrationIds },
      OR: [
        { userId: user.id },
        { savedTeam: { captainUserId: user.id } },
        { members: { some: { userId: user.id, inviteStatus: "accepted" } } },
        { savedTeam: { members: { some: { userId: user.id, inviteStatus: "accepted" } } } },
      ],
    },
    select: { id: true },
  });
  const ids = new Set(registrations.map((entry) => entry.id));
  return room.participants.find((entry) => entry.registrationId && ids.has(entry.registrationId))?.slot || null;
};

const resolveAccess = async ({ room, user, token }) => {
  if (await isStaffForTournament(user, room.tournamentId)) return { kind: "staff", slot: null };
  if (room.controlMode !== "link_only") {
    const slot = await captainSlotForUser(room, user);
    if (slot) return room.controlMode === "staff_only" ? { kind: "viewer", slot: null } : { kind: "team", slot };
    if (await participantSlotForUser(room, user)) return { kind: "viewer", slot: null };
  }
  if (token) {
    const grant = await prisma.vetoAccessGrant.findFirst({
      where: { roomId: room.id, tokenHash: hashToken(token), revokedAt: null },
    });
    if (grant && (!grant.expiresAt || grant.expiresAt > new Date())) {
      void prisma.vetoAccessGrant.update({ where: { id: grant.id }, data: { lastUsedAt: new Date() } }).catch(() => {});
      if (grant.role === "viewer") return { kind: "viewer", slot: null };
      if (room.controlMode === "staff_only") return { kind: "viewer", slot: null };
      return { kind: "team", slot: grant.role === "team_1" ? 1 : 2 };
    }
  }
  if (room.status === "completed" && room.publishResult) return { kind: "public", slot: null };
  throw new HttpError(user ? 403 : 401, "This veto room requires an authorized account or access link.");
};

const mapRoom = (room, access = { kind: "public", slot: null }) => {
  const snapshot = room.configSnapshot || {};
  const activeActions = room.actions || [];
  const steps = Array.isArray(snapshot.steps) ? snapshot.steps : [];
  const selectedSlugs = new Set(activeActions.map((action) => action.mapSlug).filter(Boolean));
  const currentStep = steps[room.currentStep] || null;
  return {
    id: room.id,
    code: room.code,
    title: room.title,
    format: room.format,
    status: room.status,
    revision: room.revision,
    controlMode: room.controlMode,
    teamOrderMethod: room.teamOrderMethod,
    toss: {
      method: room.tossMethod,
      callerSlot: room.tossCallerSlot,
      call: room.tossCall,
      result: room.tossResult,
      winnerSlot: room.tossWinnerSlot,
      teamASlot: room.teamASlot,
    },
    timer: { seconds: room.turnSeconds, deadline: room.turnDeadline },
    viewerEnabled: room.viewerEnabled,
    publishResult: room.publishResult,
    tournament: room.tournament || null,
    match: room.match || null,
    participants: room.participants.map((entry) => ({
      id: entry.id,
      slot: entry.slot,
      registrationId: entry.registrationId,
      displayName: entry.displayName,
      seed: entry.seed,
      accentColor: entry.accentColor,
      ready: Boolean(entry.readyAt),
      joined: Boolean(entry.joinedAt),
      team: room.teamASlot === entry.slot ? "A" : room.teamASlot ? "B" : null,
    })),
    maps: (snapshot.maps || []).map((entry) => ({ ...entry, available: !selectedSlugs.has(entry.slug) })),
    steps,
    currentStep: room.currentStep,
    currentAction: currentStep,
    actions: activeActions.map((action) => ({
      id: action.id,
      sequence: action.sequence,
      kind: action.kind,
      actorSlot: action.actorSlot,
      mapSlug: action.mapSlug,
      mapName: action.mapName,
      side: action.side,
      payload: action.payload,
      createdAt: action.createdAt,
    })),
    access,
    timestamps: {
      openedAt: room.openedAt,
      startedAt: room.startedAt,
      completedAt: room.completedAt,
      cancelledAt: room.cancelledAt,
      updatedAt: room.updatedAt,
    },
  };
};

const getRoomRecord = async (where) => {
  const room = await prisma.vetoRoom.findUnique({ where, include: roomInclude });
  if (!room) throw new HttpError(404, "Veto room not found.");
  return room;
};

const listCatalog = async ({ tournamentId } = {}) => {
  const scope = tournamentId ? { OR: [{ tournamentId: null }, { tournamentId }] } : { tournamentId: null };
  const [maps, pools, presets, templates] = await Promise.all([
    prisma.vetoMap.findMany({ orderBy: { name: "asc" } }),
    prisma.vetoMapPool.findMany({ where: { ...scope, isArchived: false }, include: { maps: { where: { map: { isActive: true } }, include: { map: true }, orderBy: { displayOrder: "asc" } } }, orderBy: [{ isBuiltIn: "desc" }, { name: "asc" }, { version: "desc" }] }),
    prisma.vetoRulePreset.findMany({ where: { ...scope, isArchived: false }, orderBy: [{ isBuiltIn: "desc" }, { format: "asc" }, { name: "asc" }] }),
    prisma.vetoRoomTemplate.findMany({ where: { ...scope, isArchived: false }, include: { mapPool: true, rulePreset: true }, orderBy: [{ isDefault: "desc" }, { name: "asc" }] }),
  ]);
  return {
    maps,
    pools: pools.map((pool) => ({ ...pool, maps: pool.maps.map((entry) => entry.map) })),
    presets,
    templates,
  };
};

const createPool = async ({ user, body }) => {
  const tournamentId = normalizeText(body.tournamentId) || null;
  if (tournamentId) {
    if (!(await isStaffForTournament(user, tournamentId, ["tournament_admin"]))) throw new HttpError(403, "Tournament admin access is required.");
  } else if (!user || user.role !== "admin") throw new HttpError(403, "Super admin access is required to create global map pools.");
  const name = normalizeText(body.name).slice(0, 120);
  const mapIds = Array.isArray(body.mapIds) ? [...new Set(body.mapIds.map(normalizeText).filter(Boolean))] : [];
  if (!name || mapIds.length < 1) throw new HttpError(400, "Pool name and at least one map are required.");
  const activeMaps = await prisma.vetoMap.findMany({ where: { id: { in: mapIds }, isActive: true }, select: { id: true } });
  if (activeMaps.length !== mapIds.length) throw new HttpError(400, "Map pools can only include active maps.");
  const latest = await prisma.vetoMapPool.findFirst({ where: { name, tournamentId }, orderBy: { version: "desc" }, select: { version: true } });
  return prisma.vetoMapPool.create({ data: { name, tournamentId, version: (latest?.version || 0) + 1, maps: { create: mapIds.map((mapId, index) => ({ mapId, displayOrder: index })) } }, include: { maps: { include: { map: true }, orderBy: { displayOrder: "asc" } } } });
};

const updateMapAvailability = async ({ user, mapId, isActive }) => {
  if (!user || user.role !== "admin") throw new HttpError(403, "Super admin access is required to update maps.");
  if (typeof isActive !== "boolean") throw new HttpError(400, "isActive must be a boolean.");
  const map = await prisma.vetoMap.findUnique({ where: { id: mapId } });
  if (!map) throw new HttpError(404, "Veto map not found.");
  return prisma.vetoMap.update({ where: { id: mapId }, data: { isActive } });
};

const createPreset = async ({ user, body }) => {
  const tournamentId = normalizeText(body.tournamentId) || null;
  if (tournamentId) {
    if (!(await isStaffForTournament(user, tournamentId, ["tournament_admin"]))) throw new HttpError(403, "Tournament admin access is required.");
  } else if (!user || user.role !== "admin") throw new HttpError(403, "Super admin access is required to create global rule presets.");
  const name = normalizeText(body.name).slice(0, 120);
  const format = normalizeText(body.format).toLowerCase();
  if (!name || !FORMATS.has(format)) throw new HttpError(400, "Preset name and format are required.");
  const steps = validateSteps(body.steps, format, Number(body.mapCount) || 7);
  const latest = await prisma.vetoRulePreset.findFirst({ where: { name, tournamentId }, orderBy: { version: "desc" }, select: { version: true } });
  return prisma.vetoRulePreset.create({ data: { name, format, steps, tournamentId, version: (latest?.version || 0) + 1 } });
};

const createTemplate = async ({ user, body }) => {
  const tournamentId = normalizeText(body.tournamentId) || null;
  if (tournamentId) {
    if (!(await isStaffForTournament(user, tournamentId, ["tournament_admin"]))) throw new HttpError(403, "Tournament admin access is required.");
  } else if (user?.role !== "admin") throw new HttpError(403, "Super admin access is required.");
  const name = normalizeText(body.name).slice(0, 120);
  const format = normalizeText(body.format).toLowerCase();
  if (!name || !FORMATS.has(format) || !body.mapPoolId || !body.rulePresetId) throw new HttpError(400, "Template name, format, pool, and rule preset are required.");
  const [pool, preset] = await Promise.all([
    prisma.vetoMapPool.findUnique({ where: { id: body.mapPoolId }, select: { tournamentId: true } }),
    prisma.vetoRulePreset.findUnique({ where: { id: body.rulePresetId }, select: { tournamentId: true, format: true } }),
  ]);
  if (!pool || !preset) throw new HttpError(400, "Choose a valid map pool and rule preset.");
  if ((pool.tournamentId && pool.tournamentId !== tournamentId) || (preset.tournamentId && preset.tournamentId !== tournamentId)) {
    throw new HttpError(403, "Pool and preset scope must match the template tournament.");
  }
  if (preset.format !== format && preset.format !== "custom") throw new HttpError(400, "The rule preset does not match the template format.");
  const settings = normalizeSettings(body.settings || body);
  const latest = await prisma.vetoRoomTemplate.findFirst({ where: { name, tournamentId }, orderBy: { version: "desc" }, select: { version: true } });
  return prisma.vetoRoomTemplate.create({ data: { name, format, tournamentId, mapPoolId: body.mapPoolId, rulePresetId: body.rulePresetId, settings, version: (latest?.version || 0) + 1 } });
};

const createMap = async ({ user, body }) => {
  if (!user || user.role !== "admin") throw new HttpError(403, "Super admin access is required to create maps.");
  const name = normalizeText(body.name).slice(0, 100);
  const slug = normalizeText(body.slug || name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  if (!name || !slug) throw new HttpError(400, "Map name is required.");
  return prisma.vetoMap.create({ data: { name, slug, artworkUrl: normalizeArtworkPath(body.artworkUrl), accentColor: /^#[0-9a-f]{6}$/i.test(body.accentColor || "") ? body.accentColor : "#8b5cf6" } });
};

const getTournamentConfig = async ({ user, tournamentId }) => {
  await requireRoomStaff(user, { tournamentId }, ["tournament_admin"]);
  return prisma.tournamentVetoConfig.findUnique({ where: { tournamentId }, include: { defaultTemplate: true } });
};

const saveTournamentConfig = async ({ user, tournamentId, body }) => {
  await requireRoomStaff(user, { tournamentId }, ["tournament_admin"]);
  const settings = normalizeSettings(body.settings || body);
  const defaultTemplateId = normalizeText(body.defaultTemplateId) || null;
  return prisma.tournamentVetoConfig.upsert({ where: { tournamentId }, create: { tournamentId, defaultTemplateId, settings }, update: { defaultTemplateId, settings }, include: { defaultTemplate: true } });
};

const participantInput = (input, slot) => ({
  slot,
  registrationId: normalizeText(input?.registrationId) || null,
  displayName: (normalizeText(input?.displayName) || `Team ${slot}`).slice(0, 160),
  seed: Number.isInteger(Number(input?.seed)) ? Number(input.seed) : null,
  accentColor: normalizeText(input?.accentColor) || TEAM_COLORS[slot - 1],
});

const createRoom = async ({ user, body }) => {
  let tournamentId = normalizeText(body.tournamentId) || null;
  let match = null;
  if (body.matchId) {
    match = await prisma.match.findUnique({ where: { id: body.matchId }, include: { participants: { orderBy: { slot: "asc" } }, tournament: { select: { id: true, title: true } }, vetoRoom: { select: { id: true } } } });
    if (!match) throw new HttpError(404, "Match not found.");
    if (match.vetoRoom) throw new HttpError(409, "This match already has a veto room.");
    tournamentId = match.tournamentId;
  }
  await requireRoomStaff(user, { tournamentId });
  const format = normalizeText(body.format).toLowerCase();
  if (!FORMATS.has(format)) throw new HttpError(400, "Choose BO1, BO3, BO5, Premier, or Custom.");
  let template = null;
  if (body.templateId) template = await prisma.vetoRoomTemplate.findUnique({ where: { id: body.templateId } });
  const mapPoolId = normalizeText(body.mapPoolId || template?.mapPoolId);
  const rulePresetId = normalizeText(body.rulePresetId || template?.rulePresetId);
  const [pool, preset] = await Promise.all([
    prisma.vetoMapPool.findUnique({ where: { id: mapPoolId }, include: { maps: { where: { map: { isActive: true } }, include: { map: true }, orderBy: { displayOrder: "asc" } } } }),
    prisma.vetoRulePreset.findUnique({ where: { id: rulePresetId } }),
  ]);
  if (!pool || !preset) throw new HttpError(400, "Choose a valid map pool and rule preset.");
  if ((pool.tournamentId && pool.tournamentId !== tournamentId) || (preset.tournamentId && preset.tournamentId !== tournamentId)) {
    throw new HttpError(403, "Pool and preset scope must match the room tournament.");
  }
  if (preset.format !== format && preset.format !== "custom") throw new HttpError(400, "The rule preset does not match the selected format.");
  let steps;
  if (format === "premier") {
    const isValorantPool = String(pool.game || "").toLowerCase() === "valorant"
      && pool.maps.every(({ map }) => String(map.game || "").toLowerCase() === "valorant");
    if (!isValorantPool || pool.maps.length !== 7) throw new HttpError(400, "Premier rooms require exactly seven active Valorant maps.");
    steps = validateSteps(getBuiltInSteps("premier"), "premier", 7);
  } else {
    steps = validateSteps(preset.steps, format, pool.maps.length);
  }
  const settings = normalizeSettings({ ...(template?.settings || {}), ...body });
  const sourceParticipants = Array.isArray(body.participants) && body.participants.length
    ? body.participants
    : match?.participants || [];
  const participants = [participantInput(sourceParticipants[0], 1), participantInput(sourceParticipants[1], 2)];
  const issuedTokens = { team1: randomToken(), team2: randomToken(), viewer: settings.viewerEnabled ? randomToken() : null };
  const code = randomCode();
  const title = (normalizeText(body.title) || (match ? `${participants[0].displayName} vs ${participants[1].displayName}` : `${format.toUpperCase()} Veto Room`)).slice(0, 180);
  const room = await prisma.$transaction(async (tx) => tx.vetoRoom.create({
    data: {
      code, tournamentId, matchId: match?.id || null, templateId: template?.id || null, mapPoolId: pool.id, rulePresetId: preset.id,
      title, format, ...settings, createdById: user.id, preVetoMatchStatus: match?.status || null,
      configSnapshot: {
        pool: { id: pool.id, name: pool.name, version: pool.version },
        preset: { id: preset.id, name: preset.name, version: preset.version },
        maps: pool.maps.map(({ map }) => ({ slug: map.slug, name: map.name, artworkUrl: map.artworkUrl, accentColor: map.accentColor })),
        steps,
        settings,
      },
      participants: { create: participants },
      grants: { create: [
        { role: "team_1", tokenHash: hashToken(issuedTokens.team1) },
        { role: "team_2", tokenHash: hashToken(issuedTokens.team2) },
        ...(issuedTokens.viewer ? [{ role: "viewer", tokenHash: hashToken(issuedTokens.viewer) }] : []),
      ] },
    },
    include: roomInclude,
  }));
  return { room: mapRoom(room, { kind: "staff", slot: null }), issuedTokens };
};

const listRooms = async ({ user, tournamentId } = {}) => {
  if (!user) throw new HttpError(401, "Sign in to manage veto rooms.");
  const where = {};
  if (tournamentId) {
    await requireRoomStaff(user, { tournamentId });
    where.tournamentId = tournamentId;
  } else if (user.role !== "admin") {
    const assignments = await prisma.tournamentStaffAssignment.findMany({ where: { userId: user.id }, select: { tournamentId: true } });
    where.tournamentId = { in: assignments.map((entry) => entry.tournamentId) };
  }
  const rooms = await prisma.vetoRoom.findMany({ where, include: roomInclude, orderBy: { updatedAt: "desc" }, take: 250 });
  return rooms.map((room) => mapRoom(room, { kind: "staff", slot: null }));
};

const getAdminRoom = async ({ user, roomId }) => {
  const room = await getRoomRecord({ id: roomId });
  await requireRoomStaff(user, room);
  return mapRoom(room, { kind: "staff", slot: null });
};

const getRoom = async ({ code, user, token }) => {
  const room = await getRoomRecord({ code: normalizeText(code).toLowerCase() });
  const access = await resolveAccess({ room, user, token });
  return mapRoom(room, access);
};

const getMyRooms = async (user) => {
  if (!user) throw new HttpError(401, "Sign in to view your veto rooms.");
  const registrations = await prisma.teamRegistration.findMany({ where: { OR: [{ userId: user.id }, { savedTeam: { captainUserId: user.id } }] }, select: { id: true } });
  const ids = registrations.map((entry) => entry.id);
  if (!ids.length) return [];
  const rooms = await prisma.vetoRoom.findMany({ where: { participants: { some: { registrationId: { in: ids } } }, status: { notIn: ["cancelled"] } }, include: roomInclude, orderBy: { updatedAt: "desc" }, take: 50 });
  return Promise.all(rooms.map(async (room) => mapRoom(room, { kind: "team", slot: await captainSlotForUser(room, user) })));
};

const mutateRevision = async (tx, roomId, revision, data) => {
  const result = await tx.vetoRoom.updateMany({ where: { id: roomId, revision }, data: { ...data, revision: { increment: 1 } } });
  if (result.count !== 1) throw new HttpError(409, "The room changed on another device. Refresh and try again.");
};

const syncMatchStatus = async (tx, room, fromStatuses, status) => {
  if (!room.matchId) return;
  await tx.match.updateMany({ where: { id: room.matchId, status: { in: fromStatuses } }, data: { status } });
};

const openRoom = async ({ user, roomId, revision }) => {
  const room = await getRoomRecord({ id: roomId });
  await requireRoomStaff(user, room);
  if (room.status !== "draft") throw new HttpError(409, "Only a draft room can be opened.");
  await prisma.$transaction(async (tx) => {
    await mutateRevision(tx, room.id, parseRevision(revision), { status: "open", openedAt: new Date() });
    await syncMatchStatus(tx, room, ["not_scheduled", "scheduled", "check_in_open", "veto_starting_soon"], "veto_starting_soon");
  });
  return getAdminRoom({ user, roomId });
};

const readyRoom = async ({ code, user, token, body }) => {
  const room = await getRoomRecord({ code: normalizeText(code).toLowerCase() });
  const access = await resolveAccess({ room, user, token });
  let slot = access.slot;
  if (access.kind === "staff" && body.slot) slot = parseSlot(body.slot);
  if (!slot || !["open", "toss_pending", "toss_complete"].includes(room.status)) throw new HttpError(409, "This team cannot change readiness now.");
  const revision = parseRevision(body.expectedRevision);
  await prisma.$transaction(async (tx) => {
    await mutateRevision(tx, room.id, revision, {});
    await tx.vetoRoomParticipant.update({ where: { roomId_slot: { roomId: room.id, slot } }, data: { readyAt: body.ready === false ? null : new Date(), joinedAt: new Date() } });
  });
  return getRoom({ code: room.code, user, token });
};

const allReady = (room) => room.participants.length === 2 && room.participants.every((entry) => entry.readyAt);

const initialTeamASlot = (room) => {
  if (room.teamOrderMethod === "slot_order") return 1;
  if (room.teamOrderMethod === "higher_seed") return [...room.participants].sort((a, b) => (a.seed || 9999) - (b.seed || 9999))[0]?.slot || 1;
  if (room.teamOrderMethod === "lower_seed") return [...room.participants].sort((a, b) => (b.seed || -1) - (a.seed || -1))[0]?.slot || 2;
  return room.teamASlot;
};

const startRoom = async ({ user, roomId, body }) => {
  const room = await getRoomRecord({ id: roomId });
  await requireRoomStaff(user, room);
  const revision = parseRevision(body.expectedRevision);
  if (!body.force && !allReady(room)) throw new HttpError(409, "Both teams must be ready, or staff must force-start the room.");
  let status;
  let teamASlot = initialTeamASlot(room);
  if (room.teamOrderMethod === "toss" && !room.tossWinnerSlot) status = "toss_pending";
  else if (!teamASlot && room.teamOrderMethod === "staff_assignment") throw new HttpError(409, "Assign Team A before starting.");
  else if (room.status === "toss_complete" || room.status === "open") status = "in_progress";
  else throw new HttpError(409, "This room cannot be started from its current state.");
  const now = new Date();
  const turnDeadline = status === "in_progress" && room.turnSeconds ? new Date(now.getTime() + room.turnSeconds * 1000) : null;
  await prisma.$transaction(async (tx) => {
    await mutateRevision(tx, room.id, revision, { status, teamASlot, startedAt: status === "in_progress" ? now : room.startedAt, turnDeadline });
    if (status === "in_progress") await syncMatchStatus(tx, room, ["veto_starting_soon", "veto_in_progress"], "veto_in_progress");
  });
  return getAdminRoom({ user, roomId });
};

const assignTeamA = async ({ user, roomId, body }) => {
  const room = await getRoomRecord({ id: roomId });
  await requireRoomStaff(user, room);
  if (!["draft", "open"].includes(room.status) || room.teamOrderMethod !== "staff_assignment") throw new HttpError(409, "Direct Team A assignment is not available now.");
  await mutateRevision(prisma, room.id, parseRevision(body.expectedRevision), { teamASlot: parseSlot(body.teamASlot, "Team A slot") });
  return getAdminRoom({ user, roomId });
};

const tossRoom = async ({ code, user, token, body }) => {
  const room = await getRoomRecord({ code: normalizeText(code).toLowerCase() });
  const access = await resolveAccess({ room, user, token });
  if (room.status !== "toss_pending" || room.teamOrderMethod !== "toss") throw new HttpError(409, "The toss is not accepting a call.");
  if (room.tossMethod !== "digital") throw new HttpError(409, "Staff must record this physical toss.");
  if (access.kind !== "staff" && access.slot !== room.tossCallerSlot) throw new HttpError(403, "Only the designated team can call the toss.");
  const call = normalizeText(body.call).toLowerCase();
  if (!["heads", "tails"].includes(call)) throw new HttpError(400, "Choose Heads or Tails.");
  const result = crypto.randomInt(0, 2) === 0 ? "heads" : "tails";
  const winnerSlot = result === call ? room.tossCallerSlot : (room.tossCallerSlot === 1 ? 2 : 1);
  await mutateRevision(prisma, room.id, parseRevision(body.expectedRevision), { tossCall: call, tossResult: result, tossWinnerSlot: winnerSlot });
  return getRoom({ code: room.code, user, token });
};

const recordManualToss = async ({ user, roomId, body }) => {
  const room = await getRoomRecord({ id: roomId });
  await requireRoomStaff(user, room);
  if (room.status !== "toss_pending" || room.tossMethod !== "manual") throw new HttpError(409, "This room is not waiting for a physical toss.");
  const call = normalizeText(body.call).toLowerCase();
  const result = normalizeText(body.result).toLowerCase();
  if (!["heads", "tails"].includes(call) || !["heads", "tails"].includes(result)) throw new HttpError(400, "Record a valid Heads or Tails call and result.");
  const winnerSlot = result === call ? room.tossCallerSlot : (room.tossCallerSlot === 1 ? 2 : 1);
  await mutateRevision(prisma, room.id, parseRevision(body.expectedRevision), { tossCall: call, tossResult: result, tossWinnerSlot: winnerSlot });
  return getAdminRoom({ user, roomId });
};

const chooseTeamA = async ({ code, user, token, body }) => {
  const room = await getRoomRecord({ code: normalizeText(code).toLowerCase() });
  const access = await resolveAccess({ room, user, token });
  if (room.status !== "toss_pending" || !room.tossWinnerSlot) throw new HttpError(409, "Complete the toss before choosing Team A.");
  if (access.kind !== "staff" && access.slot !== room.tossWinnerSlot) throw new HttpError(403, "Only the toss winner can choose Team A or Team B.");
  const choice = normalizeText(body.choice).toUpperCase();
  if (!["A", "B"].includes(choice)) throw new HttpError(400, "Choose Team A or Team B.");
  const teamASlot = choice === "A" ? room.tossWinnerSlot : (room.tossWinnerSlot === 1 ? 2 : 1);
  const now = new Date();
  const turnDeadline = room.turnSeconds ? new Date(now.getTime() + room.turnSeconds * 1000) : null;
  await prisma.$transaction(async (tx) => {
    await mutateRevision(tx, room.id, parseRevision(body.expectedRevision), {
      teamASlot,
      status: "in_progress",
      startedAt: now,
      turnDeadline,
    });
    await syncMatchStatus(tx, room, ["veto_starting_soon", "veto_in_progress"], "veto_in_progress");
  });
  return getRoom({ code: room.code, user, token });
};

const actorSlotForStep = (room, step) => step.actor === "A" ? room.teamASlot : step.actor === "B" ? (room.teamASlot === 1 ? 2 : 1) : null;

const advanceAutomatic = async (tx, room) => {
  const steps = room.configSnapshot.steps || [];
  let currentStep = room.currentStep;
  while (steps[currentStep]?.kind === "decider") {
    const selected = new Set(room.actions.filter((action) => !action.invalidatedAt).map((action) => action.mapSlug).filter(Boolean));
    const remaining = (room.configSnapshot.maps || []).filter((map) => !selected.has(map.slug));
    if (remaining.length !== 1) throw new HttpError(409, "The decider step requires exactly one remaining map.");
    const map = remaining[0];
    await tx.vetoRoomAction.create({ data: { roomId: room.id, sequence: currentStep + 1, kind: "decider", mapSlug: map.slug, mapName: map.name, payload: { seriesIndex: steps[currentStep].seriesIndex } } });
    room.actions.push({ sequence: currentStep + 1, kind: "decider", mapSlug: map.slug, mapName: map.name, invalidatedAt: null });
    currentStep += 1;
  }
  return currentStep;
};

const submitAction = async ({ code, user, token, body }) => {
  const room = await getRoomRecord({ code: normalizeText(code).toLowerCase() });
  const access = await resolveAccess({ room, user, token });
  if (room.status !== "in_progress") throw new HttpError(409, "The veto is not in progress.");
  const revision = parseRevision(body.expectedRevision);
  const step = room.configSnapshot.steps?.[room.currentStep];
  if (!step || !ACTION_KINDS.has(step.kind)) throw new HttpError(409, "No team action is available.");
  const expectedSlot = actorSlotForStep(room, step);
  if (access.kind !== "staff" && (access.kind !== "team" || access.slot !== expectedSlot)) throw new HttpError(403, "It is not your team’s turn.");
  let map = null;
  let side = null;
  if (["ban", "pick"].includes(step.kind)) {
    const mapSlug = normalizeText(body.mapSlug).toLowerCase();
    map = room.configSnapshot.maps?.find((entry) => entry.slug === mapSlug);
    if (!map) throw new HttpError(400, "Choose a map from this room’s pool.");
    if (room.actions.some((action) => action.mapSlug === mapSlug)) throw new HttpError(409, "That map is no longer available.");
  } else {
    side = normalizeText(body.side).toLowerCase();
    if (!SIDES.has(side)) throw new HttpError(400, "Choose Attack or Defense.");
    const mapAction = room.actions.find((action) => ["pick", "decider"].includes(action.kind) && Number(action.payload?.seriesIndex) === Number(step.seriesIndex));
    if (!mapAction) throw new HttpError(409, "The map for this side choice has not been selected.");
    map = { slug: mapAction.mapSlug, name: mapAction.mapName };
  }
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await mutateRevision(tx, room.id, revision, {});
    await tx.vetoRoomAction.create({ data: { roomId: room.id, sequence: room.currentStep + 1, kind: step.kind, actorSlot: expectedSlot, mapSlug: map.slug, mapName: map.name, side, payload: { seriesIndex: step.seriesIndex }, createdById: user?.id || null } });
    room.actions.push({ sequence: room.currentStep + 1, kind: step.kind, actorSlot: expectedSlot, mapSlug: map.slug, mapName: map.name, side, payload: { seriesIndex: step.seriesIndex }, invalidatedAt: null });
    room.currentStep += 1;
    room.currentStep = await advanceAutomatic(tx, room);
    const complete = room.currentStep >= room.configSnapshot.steps.length;
    await tx.vetoRoom.update({ where: { id: room.id }, data: { currentStep: room.currentStep, status: complete ? "completed" : "in_progress", completedAt: complete ? now : null, turnDeadline: complete || !room.turnSeconds ? null : new Date(now.getTime() + room.turnSeconds * 1000) } });
    if (complete) {
      await syncMatchStatus(tx, room, ["veto_in_progress", "veto_starting_soon", "ready"], "ready");
      await tx.vetoAccessGrant.updateMany({ where: { roomId: room.id, expiresAt: null }, data: { expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000) } });
    }
  });
  return getRoom({ code: room.code, user, token });
};

const rewindRoom = async ({ user, roomId, body }) => {
  const room = await getRoomRecord({ id: roomId });
  await requireRoomStaff(user, room);
  const targetStep = Number(body.targetStep);
  if (!Number.isInteger(targetStep) || targetStep < 0 || targetStep > room.currentStep) throw new HttpError(400, "Choose a valid rewind step.");
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await mutateRevision(tx, room.id, parseRevision(body.expectedRevision), { currentStep: targetStep, status: "in_progress", completedAt: null, turnDeadline: room.turnSeconds ? new Date(now.getTime() + room.turnSeconds * 1000) : null });
    await tx.vetoRoomAction.updateMany({ where: { roomId: room.id, invalidatedAt: null, sequence: { gt: targetStep } }, data: { invalidatedAt: now, invalidatedById: user.id } });
    room.currentStep = targetStep;
    room.actions = room.actions.filter((action) => action.sequence <= targetStep);
    const advancedStep = await advanceAutomatic(tx, room);
    if (advancedStep !== targetStep) await tx.vetoRoom.update({ where: { id: room.id }, data: { currentStep: advancedStep } });
    await syncMatchStatus(tx, room, ["ready", "veto_in_progress"], "veto_in_progress");
  });
  return getAdminRoom({ user, roomId });
};

const resetRoom = async ({ user, roomId, body }) => {
  const room = await getRoomRecord({ id: roomId });
  await requireRoomStaff(user, room);
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await mutateRevision(tx, room.id, parseRevision(body.expectedRevision), { status: "open", tossCall: null, tossResult: null, tossWinnerSlot: null, teamASlot: null, currentStep: 0, startedAt: null, completedAt: null, turnDeadline: null });
    await tx.vetoRoomParticipant.updateMany({ where: { roomId: room.id }, data: { readyAt: null } });
    await tx.vetoRoomAction.updateMany({ where: { roomId: room.id, invalidatedAt: null }, data: { invalidatedAt: now, invalidatedById: user.id } });
    await syncMatchStatus(tx, room, ["ready", "veto_in_progress", "veto_starting_soon"], "veto_starting_soon");
  });
  return getAdminRoom({ user, roomId });
};

const cancelRoom = async ({ user, roomId, body }) => {
  const room = await getRoomRecord({ id: roomId });
  await requireRoomStaff(user, room);
  await prisma.$transaction(async (tx) => {
    await mutateRevision(tx, room.id, parseRevision(body.expectedRevision), { status: "cancelled", cancelledAt: new Date(), turnDeadline: null });
    if (room.matchId && room.preVetoMatchStatus) await tx.match.updateMany({ where: { id: room.matchId, status: { in: ["veto_starting_soon", "veto_in_progress"] } }, data: { status: room.preVetoMatchStatus } });
  });
  return getAdminRoom({ user, roomId });
};

const rotateGrant = async ({ user, roomId, role }) => {
  const room = await getRoomRecord({ id: roomId });
  await requireRoomStaff(user, room);
  if (!["team_1", "team_2", "viewer"].includes(role)) throw new HttpError(400, "Invalid access-link role.");
  const token = randomToken();
  await prisma.$transaction([
    prisma.vetoAccessGrant.updateMany({ where: { roomId, role, revokedAt: null }, data: { revokedAt: new Date() } }),
    prisma.vetoAccessGrant.create({ data: { roomId, role, tokenHash: hashToken(token) } }),
  ]);
  return { role, token };
};

module.exports = {
  FORMATS,
  validateSteps,
  getBuiltInSteps,
  mapRoom,
  listCatalog,
  createPool,
  updateMapAvailability,
  createMap,
  createPreset,
  createTemplate,
  getTournamentConfig,
  saveTournamentConfig,
  createRoom,
  listRooms,
  getAdminRoom,
  getRoom,
  getMyRooms,
  openRoom,
  readyRoom,
  startRoom,
  assignTeamA,
  tossRoom,
  recordManualToss,
  chooseTeamA,
  submitAction,
  rewindRoom,
  resetRoom,
  cancelRoom,
  rotateGrant,
};
