const crypto = require("crypto");
const { HttpError } = require("../../lib/http-error");
const { prisma } = require("../../lib/prisma");
const { normalizeText } = require("../../lib/validation");
const { publishRealtimeEvent } = require("../realtime/realtime.service");
const { createNotification } = require("../notifications/notification.service");
const { getBuiltInSteps, validateSteps } = require("../veto/veto.service");

const TERMINAL_MATCH_STATUSES = new Set(["completed", "cancelled", "walkover"]);
const ACTIVE_SUPPORT_LIMIT = 3;
const CHAT_RATE_WINDOW_MS = 10_000;
const CHAT_RATE_MAX = 5;

const userSelect = {
  id: true,
  username: true,
  firstName: true,
  lastName: true,
  avatarImageName: true,
  role: true,
};

const rosterMatchInclude = {
  tournament: {
    select: {
      id: true,
      slug: true,
      title: true,
      game: true,
      staffAssignments: { select: { userId: true } },
    },
  },
  participants: {
    orderBy: { slot: "asc" },
    include: {
      registration: {
        include: {
          user: { select: userSelect },
          members: {
            where: { inviteStatus: "accepted", userId: { not: null } },
            include: { user: { select: userSelect } },
          },
          savedTeam: {
            include: {
              captainUser: { select: userSelect },
              members: {
                where: { inviteStatus: "accepted", userId: { not: null } },
                include: { user: { select: userSelect } },
              },
            },
          },
        },
      },
    },
  },
  assignedStaff: { select: userSelect },
  vetoRoom: { select: { id: true, code: true, status: true, format: true, revision: true } },
};

const avatarUrl = (user) => user?.avatarImageName ? `/api/uploads/avatars/${user.avatarImageName}` : null;
const publicUser = (user) => user ? {
  id: user.id,
  username: user.username,
  firstName: user.firstName,
  lastName: user.lastName,
  avatarUrl: avatarUrl(user),
} : null;

const chooseHigherRole = (current, next) => {
  const priority = { player: 1, captain: 2, staff: 3 };
  return !current || priority[next.role] > priority[current.role] ? next : current;
};

const collectRoomMembers = (match) => {
  const members = new Map();
  const add = (user, role, teamSlot = null) => {
    if (!user?.id) return;
    const next = { userId: user.id, role, teamSlot };
    members.set(user.id, chooseHigherRole(members.get(user.id), next));
  };
  for (const participant of match.participants) {
    const registration = participant.registration;
    if (!registration) continue;
    add(registration.user, "captain", participant.slot);
    add(registration.savedTeam?.captainUser, "captain", participant.slot);
    for (const member of registration.members) {
      add(member.user, member.role === "CAPTAIN" ? "captain" : "player", participant.slot);
    }
    for (const member of registration.savedTeam?.members || []) {
      add(member.user, member.role === "CAPTAIN" ? "captain" : "player", participant.slot);
    }
  }
  add(match.assignedStaff, "staff");
  for (const assignment of match.tournament.staffAssignments) {
    if (assignment.userId) add({ id: assignment.userId }, "staff");
  }
  return [...members.values()];
};

const matchRoomCode = () => crypto.randomBytes(9).toString("base64url").toLowerCase();
const vetoRoomCode = () => crypto.randomBytes(7).toString("base64url").toLowerCase();

const VETO_DEFAULT_SETTINGS = {
  controlMode: "captain_or_link",
  teamOrderMethod: "toss",
  tossMethod: "digital",
  tossCallerSlot: 2,
  turnSeconds: null,
  viewerEnabled: false,
  publishResult: false,
};

const activePoolMaps = (pool) => (Array.isArray(pool?.maps) ? pool.maps : [])
  .map((entry) => entry?.map || entry)
  .filter((map) => map && map.isActive !== false)
  .sort((left, right) => (left.displayOrder || 0) - (right.displayOrder || 0));

const usablePremierPool = (pool, tournamentId) => {
  if (!pool || pool.isArchived || (pool.tournamentId && pool.tournamentId !== tournamentId)) return false;
  if (pool.game && String(pool.game).toLowerCase() !== "valorant") return false;
  const maps = activePoolMaps(pool);
  return maps.length === 7
    && maps.every((map) => String(map.game || "").toLowerCase() === "valorant")
    && new Set(maps.map((map) => map.slug)).size === 7;
};

const usablePremierPreset = (preset, tournamentId, mapCount = 7) => {
  if (!preset || preset.isArchived || (preset.tournamentId && preset.tournamentId !== tournamentId)) return false;
  if (preset.game && String(preset.game).toLowerCase() !== "valorant") return false;
  if (String(preset.format || "").toLowerCase() !== "premier") return false;
  try {
    validateSteps(preset.steps, "premier", mapCount);
    return true;
  } catch (_error) {
    return false;
  }
};

const vetoMapPoolInclude = {
  maps: {
    where: { map: { isActive: true } },
    include: { map: true },
    orderBy: { displayOrder: "asc" },
  },
};

const getProvisioningConfig = async (tournamentId) => {
  if (!prisma.tournamentVetoConfig?.findUnique) return null;
  const config = await prisma.tournamentVetoConfig.findUnique({
    where: { tournamentId },
    include: {
      defaultTemplate: {
        include: {
          mapPool: { include: vetoMapPoolInclude },
          rulePreset: true,
        },
      },
    },
  });
  if (!config?.defaultTemplate && config?.defaultTemplateId && prisma.vetoRoomTemplate?.findUnique) {
    config.defaultTemplate = await prisma.vetoRoomTemplate.findUnique({
      where: { id: config.defaultTemplateId },
      include: { mapPool: { include: vetoMapPoolInclude }, rulePreset: true },
    });
  }
  return config;
};

const getBuiltInPremierPool = async () => {
  if (!prisma.vetoMapPool?.findFirst) return null;
  return prisma.vetoMapPool.findFirst({
    where: { tournamentId: null, game: "valorant", isBuiltIn: true, isArchived: false },
    include: vetoMapPoolInclude,
    orderBy: [{ version: "desc" }, { name: "asc" }],
  });
};

const getBuiltInPremierPreset = async () => {
  if (!prisma.vetoRulePreset?.findFirst) return null;
  return prisma.vetoRulePreset.findFirst({
    where: { tournamentId: null, game: "valorant", format: "premier", isBuiltIn: true, isArchived: false },
    orderBy: [{ version: "desc" }, { name: "asc" }],
  });
};

const ensureMatchVetoRoom = async ({ match, user }) => {
  if (match?.vetoRoom) return match.vetoRoom;
  if (!match?.id || TERMINAL_MATCH_STATUSES.has(match.status)) return null;
  const game = match.game || match.tournament?.game;
  if (String(game || "").toLowerCase() !== "valorant") return null;

  const participants = [...(match.participants || [])].sort((left, right) => left.slot - right.slot);
  if (participants.length !== 2) return null;

  const tournamentId = match.tournamentId || match.tournament?.id || null;
  const config = await getProvisioningConfig(tournamentId);
  const template = config?.defaultTemplate;
  let pool = template?.mapPool;
  let preset = template?.rulePreset;
  let maps = activePoolMaps(pool);
  let steps = null;
  let templateId = null;

  if (template
    && !template.isArchived
    && String(template.format || "").toLowerCase() === "premier"
    && usablePremierPool(pool, tournamentId)
    && usablePremierPreset(preset, tournamentId, maps.length)) {
    steps = validateSteps(getBuiltInSteps("premier"), "premier", maps.length);
    templateId = template.id;
  } else {
    pool = await getBuiltInPremierPool();
    preset = await getBuiltInPremierPreset();
    maps = activePoolMaps(pool);
    if (!usablePremierPool(pool, tournamentId) || !usablePremierPreset(preset, tournamentId, maps.length)) return null;
    steps = validateSteps(getBuiltInSteps("premier"), "premier", maps.length);
  }

  const templateSettings = templateId && template?.settings && typeof template.settings === "object"
    ? template.settings
    : {};
  const configSettings = config?.settings && typeof config.settings === "object" ? config.settings : {};
  const settingOverrides = { ...configSettings, ...templateSettings };
  const settings = Object.keys(VETO_DEFAULT_SETTINGS).reduce((result, key) => {
    result[key] = Object.prototype.hasOwnProperty.call(settingOverrides, key)
      ? settingOverrides[key]
      : VETO_DEFAULT_SETTINGS[key];
    return result;
  }, {});
  const now = new Date();
  const data = {
    code: vetoRoomCode(),
    tournamentId,
    matchId: match.id,
    templateId,
    mapPoolId: pool.id,
    rulePresetId: preset.id,
    title: `${participants[0].displayName} vs ${participants[1].displayName}`.slice(0, 180),
    format: "premier",
    ...settings,
    status: "open",
    createdById: user?.id || null,
    preVetoMatchStatus: match.status || null,
    openedAt: now,
    configSnapshot: {
      pool: { id: pool.id, name: pool.name, version: pool.version },
      preset: { id: preset.id, name: preset.name, version: preset.version },
      maps: maps.map((map) => ({ slug: map.slug, name: map.name, artworkUrl: map.artworkUrl, accentColor: map.accentColor })),
      steps,
      settings,
    },
    participants: {
      create: participants.map((participant, index) => ({
        slot: participant.slot || index + 1,
        registrationId: participant.registrationId || null,
        displayName: participant.displayName || `Team ${index + 1}`,
        seed: participant.seed ?? null,
        accentColor: ["#22d3ee", "#fb7185"][index],
      })),
    },
  };

  try {
    return await prisma.vetoRoom.create({ data });
  } catch (error) {
    if (error?.code !== "P2002" || !prisma.vetoRoom?.findUnique) throw error;
    const racedRoom = await prisma.vetoRoom.findUnique({ where: { matchId: match.id } });
    if (racedRoom) return racedRoom;
    throw error;
  }
};

const ensureMatchRoom = async ({ matchId, force = false, notify = true }) => {
  const match = await prisma.match.findUnique({ where: { id: matchId }, include: rosterMatchInclude });
  if (!match) throw new HttpError(404, "Match not found.");
  const resolvedParticipants = match.participants.filter((participant) => participant.registrationId);
  if (!force && (resolvedParticipants.length !== 2 || TERMINAL_MATCH_STATUSES.has(match.status))) return null;
  const desiredMembers = collectRoomMembers(match);
  if (!force && !desiredMembers.some((member) => member.role === "captain")) return null;

  let room = await prisma.matchRoom.findUnique({ where: { matchId } });
  let created = false;
  if (!room) {
    try {
      room = await prisma.matchRoom.create({ data: { matchId, code: matchRoomCode() } });
      created = true;
    } catch (error) {
      if (error?.code !== "P2002") throw error;
      room = await prisma.matchRoom.findUnique({ where: { matchId } });
    }
  }
  if (!room) throw new HttpError(500, "Unable to create match room.");

  const desiredIds = desiredMembers.map((member) => member.userId);
  await prisma.$transaction(async (tx) => {
    for (const member of desiredMembers) {
      await tx.matchRoomMember.upsert({
        where: { roomId_userId: { roomId: room.id, userId: member.userId } },
        create: { roomId: room.id, ...member },
        update: { role: member.role, teamSlot: member.teamSlot },
      });
    }
    await tx.matchRoomMember.deleteMany({
      where: { roomId: room.id, ...(desiredIds.length ? { userId: { notIn: desiredIds } } : {}) },
    });
  });

  if (created && notify && desiredIds.length) {
    await createNotification({
      eventKey: `match-room:${room.id}:created`,
      type: "match_room_created",
      title: "Your match room is ready",
      body: `${match.participants[0]?.displayName || "Team 1"} vs ${match.participants[1]?.displayName || "Team 2"}`,
      actionUrl: `/match-room/${room.code}`,
      matchRoomId: room.id,
      userIds: desiredIds,
    });
  }
  return room;
};

const ensureStaffMembership = async (room, user) => {
  if (!user) throw new HttpError(401, "Sign in to access this match room.");
  const staff = user.role === "admin"
    || room.match.assignedStaffId === user.id
    || room.match.tournament.staffAssignments.some((entry) => entry.userId === user.id);
  if (!staff) return null;
  return prisma.matchRoomMember.upsert({
    where: { roomId_userId: { roomId: room.id, userId: user.id } },
    create: { roomId: room.id, userId: user.id, role: "staff" },
    update: { role: "staff", teamSlot: null },
  });
};

const baseRoomInclude = {
  match: {
    include: {
      ...rosterMatchInclude,
      tournament: rosterMatchInclude.tournament,
    },
  },
  members: {
    include: { user: { select: userSelect } },
    orderBy: [{ teamSlot: "asc" }, { role: "desc" }, { joinedAt: "asc" }],
  },
};

const loadRoom = async (code) => prisma.matchRoom.findUnique({
  where: { code: normalizeText(code).toLowerCase() },
  include: baseRoomInclude,
});

const accessRoom = async ({ code, user, staffOnly = false }) => {
  let room = await loadRoom(code);
  if (!room) throw new HttpError(404, "Match room not found.");
  await ensureMatchRoom({ matchId: room.matchId, force: true, notify: false });
  room = await loadRoom(code);
  if (!room) throw new HttpError(404, "Match room not found.");
  let member = room.members.find((entry) => entry.userId === user?.id) || null;
  const staffMembership = await ensureStaffMembership(room, user);
  if (staffMembership) member = staffMembership;
  if (!member) throw new HttpError(403, "You are not a member of this match room.");
  if (staffOnly && member.role !== "staff") throw new HttpError(403, "Match staff access is required.");
  await ensureMatchVetoRoom({ match: room.match, user });
  room = await loadRoom(code);
  if (!room) throw new HttpError(404, "Match room not found.");
  member = room.members.find((entry) => entry.userId === user?.id) || null;
  if (!member) throw new HttpError(403, "You are not a member of this match room.");
  return { room, member };
};

const mapRoom = (room, member) => ({
  id: room.id,
  code: room.code,
  chatLocked: Boolean(room.chatLockedAt) || TERMINAL_MATCH_STATUSES.has(room.match.status),
  lastMessageAt: room.lastMessageAt,
  access: { role: member.role, teamSlot: member.teamSlot, mutedUntil: member.mutedUntil },
  match: {
    id: room.match.id,
    identifier: room.match.identifier || room.match.externalId || room.match.id.slice(0, 8),
    status: room.match.status,
    scheduledAt: room.match.scheduledAt,
    estimatedAt: room.match.estimatedAt,
    station: room.match.station,
    tournament: room.match.tournament,
    participants: room.match.participants.map((participant) => ({
      id: participant.id,
      slot: participant.slot,
      registrationId: participant.registrationId,
      displayName: participant.displayName,
      score: participant.score,
      result: participant.result,
      logoUrl: participant.registration?.savedTeam?.logoName || participant.registration?.teamLogoName
        ? `/api/uploads/team-logos/${participant.registration?.savedTeam?.logoName || participant.registration?.teamLogoName}`
        : null,
    })),
    veto: room.match.vetoRoom,
  },
  members: room.members.map((entry) => ({
    id: entry.id,
    role: entry.role,
    teamSlot: entry.teamSlot,
    mutedUntil: entry.role === "staff" || member.role === "staff" ? entry.mutedUntil : null,
    user: publicUser(entry.user),
  })),
});

const getRoom = async ({ code, user }) => {
  const { room, member } = await accessRoom({ code, user });
  return mapRoom(room, member);
};

const listMyRooms = async (user) => {
  const eligibleMatches = await prisma.match.findMany({
    where: {
      status: { notIn: [...TERMINAL_MATCH_STATUSES] },
      participants: {
        some: {
          registration: {
            OR: [
              { userId: user.id },
              { savedTeam: { captainUserId: user.id } },
              { members: { some: { userId: user.id, inviteStatus: "accepted" } } },
              { savedTeam: { members: { some: { userId: user.id, inviteStatus: "accepted" } } } },
            ],
          },
        },
      },
    },
    select: { id: true },
    take: 100,
  });
  for (const match of eligibleMatches) await ensureMatchRoom({ matchId: match.id });
  const rows = await prisma.matchRoomMember.findMany({
    where: { userId: user.id },
    include: {
      room: {
        include: {
          match: {
            include: {
              tournament: { select: { id: true, slug: true, title: true, game: true } },
              participants: { orderBy: { slot: "asc" } },
              vetoRoom: { select: { code: true, status: true, format: true } },
            },
          },
        },
      },
    },
    orderBy: { joinedAt: "desc" },
    take: 100,
  });
  return Promise.all(rows.map(async (entry) => {
    const unreadMessages = await prisma.matchRoomMessage.count({
      where: {
        roomId: entry.roomId,
        hiddenAt: null,
        ...(entry.lastReadAt ? { createdAt: { gt: entry.lastReadAt } } : {}),
        NOT: { senderUserId: user.id },
      },
    });
    return {
      id: entry.room.id,
      code: entry.room.code,
      role: entry.role,
      teamSlot: entry.teamSlot,
      unreadMessages,
      chatLocked: Boolean(entry.room.chatLockedAt) || TERMINAL_MATCH_STATUSES.has(entry.room.match.status),
      match: {
        id: entry.room.match.id,
        identifier: entry.room.match.identifier || entry.room.match.externalId || entry.room.match.id.slice(0, 8),
        status: entry.room.match.status,
        scheduledAt: entry.room.match.scheduledAt,
        tournament: entry.room.match.tournament,
        participants: entry.room.match.participants.map((participant) => ({ slot: participant.slot, displayName: participant.displayName })),
        veto: entry.room.match.vetoRoom,
      },
    };
  }));
};

const listStaffRooms = async (user) => {
  const rooms = await prisma.matchRoom.findMany({
    where: user.role === "admin" ? {} : {
      OR: [
        { match: { assignedStaffId: user.id } },
        { match: { tournament: { staffAssignments: { some: { userId: user.id } } } } },
      ],
    },
    include: {
      match: {
        include: {
          tournament: { select: { id: true, slug: true, title: true, game: true } },
          participants: { orderBy: { slot: "asc" } },
          vetoRoom: { select: { id: true, code: true, status: true, format: true } },
        },
      },
      _count: { select: { messages: true, support: { where: { status: "open" } } } },
    },
    orderBy: [{ match: { scheduledAt: { sort: "asc", nulls: "last" } } }, { updatedAt: "desc" }],
    take: 250,
  });
  return rooms.map((room) => ({
    id: room.id,
    code: room.code,
    chatLocked: Boolean(room.chatLockedAt) || TERMINAL_MATCH_STATUSES.has(room.match.status),
    messageCount: room._count.messages,
    openSupportCount: room._count.support,
    match: {
      id: room.match.id,
      identifier: room.match.identifier || room.match.externalId || room.match.id.slice(0, 8),
      status: room.match.status,
      scheduledAt: room.match.scheduledAt,
      tournament: room.match.tournament,
      participants: room.match.participants.map((participant) => ({ slot: participant.slot, displayName: participant.displayName })),
      veto: room.match.vetoRoom,
    },
  }));
};

const mapMessage = (message, viewerRole) => ({
  id: message.id,
  kind: message.kind,
  body: message.hiddenAt ? "Message hidden by match staff." : message.body,
  hidden: Boolean(message.hiddenAt),
  hiddenReason: viewerRole === "staff" ? message.hiddenReason : null,
  sender: publicUser(message.sender),
  createdAt: message.createdAt,
});

const listMessages = async ({ code, user, before, limit }) => {
  const { room, member } = await accessRoom({ code, user });
  const take = Math.min(Math.max(Number.parseInt(String(limit), 10) || 50, 1), 100);
  let beforeDate;
  if (before) {
    beforeDate = new Date(before);
    if (Number.isNaN(beforeDate.getTime())) throw new HttpError(400, "Invalid message cursor.");
  }
  const messages = await prisma.matchRoomMessage.findMany({
    where: { roomId: room.id, ...(beforeDate ? { createdAt: { lt: beforeDate } } : {}) },
    include: { sender: { select: userSelect } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: take + 1,
  });
  const hasMore = messages.length > take;
  const page = messages.slice(0, take);
  return {
    items: page.reverse().map((message) => mapMessage(message, member.role)),
    nextCursor: hasMore ? page.at(-1)?.createdAt?.toISOString() || null : null,
  };
};

const sendMessage = async ({ code, user, body }) => {
  const { room, member } = await accessRoom({ code, user });
  if (room.chatLockedAt || TERMINAL_MATCH_STATUSES.has(room.match.status)) throw new HttpError(409, "This match-room chat is read-only.");
  if (member.mutedUntil && member.mutedUntil > new Date()) throw new HttpError(403, "You are temporarily muted in this room.");
  const text = normalizeText(body?.body).replace(/\s+/g, " ");
  if (!text || text.length > 1000) throw new HttpError(400, "Messages must be between 1 and 1,000 characters.");
  const recent = await prisma.matchRoomMessage.count({
    where: { roomId: room.id, senderUserId: user.id, createdAt: { gt: new Date(Date.now() - CHAT_RATE_WINDOW_MS) } },
  });
  if (recent >= CHAT_RATE_MAX) throw new HttpError(429, "You are sending messages too quickly.");
  const kind = member.role === "staff" && body?.official === true ? "staff" : "player";
  const message = await prisma.$transaction(async (tx) => {
    const created = await tx.matchRoomMessage.create({
      data: { roomId: room.id, senderUserId: user.id, kind, body: text },
      include: { sender: { select: userSelect } },
    });
    await tx.matchRoom.update({ where: { id: room.id }, data: { lastMessageAt: created.createdAt } });
    await tx.matchRoomMember.update({ where: { id: member.id }, data: { lastReadAt: created.createdAt } });
    return created;
  });
  publishRealtimeEvent(`match-room:${room.code}`, { kind: "message", messageId: message.id });
  if (kind === "staff") {
    await createNotification({
      eventKey: `match-room:${room.id}:official:${message.id}`,
      type: "match_official_message",
      title: "Official match-room update",
      body: text,
      actionUrl: `/match-room/${room.code}`,
      matchRoomId: room.id,
      userIds: room.members.filter((entry) => entry.userId !== user.id && !entry.notificationsMuted).map((entry) => entry.userId),
    });
  }
  return mapMessage(message, member.role);
};

const markRoomRead = async ({ code, user }) => {
  const { room, member } = await accessRoom({ code, user });
  const readAt = new Date();
  await prisma.matchRoomMember.update({ where: { id: member.id }, data: { lastReadAt: readAt } });
  publishRealtimeEvent(`user:${user.id}`, { kind: "room_read", roomId: room.id });
  return { readAt };
};

const canViewSupport = (member, request) => member.role === "staff" || member.role === "captain" || request.openedByUserId === member.userId;

const mapSupport = (request) => ({
  id: request.id,
  subject: request.subject,
  status: request.status,
  openedBy: publicUser(request.openedBy),
  resolvedBy: publicUser(request.resolvedBy),
  resolvedAt: request.resolvedAt,
  createdAt: request.createdAt,
  messages: request.messages.map((message) => ({
    id: message.id,
    body: message.body,
    sender: publicUser(message.sender),
    createdAt: message.createdAt,
  })),
});

const listSupport = async ({ code, user }) => {
  const { room, member } = await accessRoom({ code, user });
  const requests = await prisma.matchSupportRequest.findMany({
    where: {
      roomId: room.id,
      ...(member.role === "staff" || member.role === "captain" ? {} : { openedByUserId: user.id }),
    },
    include: {
      openedBy: { select: userSelect },
      resolvedBy: { select: userSelect },
      messages: { include: { sender: { select: userSelect } }, orderBy: { createdAt: "asc" } },
    },
    orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
    take: 50,
  });
  return requests.map(mapSupport);
};

const openSupport = async ({ code, user, body }) => {
  const { room } = await accessRoom({ code, user });
  const subject = normalizeText(body?.subject).replace(/\s+/g, " ").slice(0, 160);
  const text = normalizeText(body?.body).replace(/\s+/g, " ");
  if (!subject || !text || text.length > 2000) throw new HttpError(400, "Support requests need a subject and a message up to 2,000 characters.");
  const active = await prisma.matchSupportRequest.count({ where: { roomId: room.id, openedByUserId: user.id, status: "open" } });
  if (active >= ACTIVE_SUPPORT_LIMIT) throw new HttpError(409, "Resolve an existing support request before opening another.");
  const request = await prisma.matchSupportRequest.create({
    data: {
      roomId: room.id,
      openedByUserId: user.id,
      subject,
      messages: { create: { senderUserId: user.id, body: text } },
    },
  });
  const recipients = room.members
    .filter((entry) => entry.userId !== user.id && ["staff", "captain"].includes(entry.role))
    .map((entry) => entry.userId);
  await createNotification({
    eventKey: `match-support:${request.id}:opened`,
    type: "match_support_opened",
    title: "Match support requested",
    body: subject,
    actionUrl: `/match-room/${room.code}?tab=support`,
    matchRoomId: room.id,
    userIds: recipients,
  });
  publishRealtimeEvent(`match-room:${room.code}`, { kind: "support", requestId: request.id });
  return request;
};

const replySupport = async ({ code, requestId, user, body }) => {
  const { room, member } = await accessRoom({ code, user });
  const request = await prisma.matchSupportRequest.findFirst({ where: { id: requestId, roomId: room.id } });
  if (!request) throw new HttpError(404, "Support request not found.");
  if (!canViewSupport({ ...member, userId: user.id }, request)) throw new HttpError(403, "You cannot access this support request.");
  if (request.status !== "open") throw new HttpError(409, "This support request is resolved.");
  const text = normalizeText(body?.body).replace(/\s+/g, " ");
  if (!text || text.length > 2000) throw new HttpError(400, "Replies must be between 1 and 2,000 characters.");
  const message = await prisma.matchSupportMessage.create({ data: { requestId, senderUserId: user.id, body: text } });
  const recipients = room.members.filter((entry) => {
    if (entry.userId === user.id) return false;
    return entry.role === "staff" || entry.role === "captain" || entry.userId === request.openedByUserId;
  }).map((entry) => entry.userId);
  await createNotification({
    eventKey: `match-support:${request.id}:message:${message.id}`,
    type: "match_support_reply",
    title: "New match-support reply",
    body: request.subject,
    actionUrl: `/match-room/${room.code}?tab=support`,
    matchRoomId: room.id,
    userIds: recipients,
  });
  publishRealtimeEvent(`match-room:${room.code}`, { kind: "support", requestId: request.id });
  return message;
};

const resolveSupport = async ({ code, requestId, user }) => {
  const { room } = await accessRoom({ code, user, staffOnly: true });
  const result = await prisma.matchSupportRequest.updateMany({
    where: { id: requestId, roomId: room.id, status: "open" },
    data: { status: "resolved", resolvedByUserId: user.id, resolvedAt: new Date() },
  });
  if (!result.count) throw new HttpError(404, "Open support request not found.");
  publishRealtimeEvent(`match-room:${room.code}`, { kind: "support", requestId });
};

const hideMessage = async ({ code, messageId, user, reason }) => {
  const { room } = await accessRoom({ code, user, staffOnly: true });
  const hiddenReason = normalizeText(reason).replace(/\s+/g, " ").slice(0, 500);
  if (!hiddenReason) throw new HttpError(400, "A moderation reason is required.");
  const result = await prisma.matchRoomMessage.updateMany({
    where: { id: messageId, roomId: room.id, hiddenAt: null },
    data: { hiddenAt: new Date(), hiddenByUserId: user.id, hiddenReason },
  });
  if (!result.count) throw new HttpError(404, "Visible message not found.");
  publishRealtimeEvent(`match-room:${room.code}`, { kind: "moderation", messageId });
};

const setMemberMute = async ({ code, memberId, user, mutedUntil }) => {
  const { room } = await accessRoom({ code, user, staffOnly: true });
  const date = mutedUntil ? new Date(mutedUntil) : null;
  if (date && Number.isNaN(date.getTime())) throw new HttpError(400, "Invalid mute expiry.");
  const result = await prisma.matchRoomMember.updateMany({
    where: { id: memberId, roomId: room.id, role: { not: "staff" } },
    data: { mutedUntil: date },
  });
  if (!result.count) throw new HttpError(404, "Player member not found.");
  publishRealtimeEvent(`match-room:${room.code}`, { kind: "moderation", memberId });
};

const setChatLock = async ({ code, user, locked }) => {
  const { room } = await accessRoom({ code, user, staffOnly: true });
  const updated = await prisma.matchRoom.update({ where: { id: room.id }, data: { chatLockedAt: locked ? new Date() : null } });
  publishRealtimeEvent(`match-room:${room.code}`, { kind: "chat_lock", locked: Boolean(updated.chatLockedAt) });
  return { chatLocked: Boolean(updated.chatLockedAt) };
};

const notifyMatchChange = async ({ matchId, type, eventVersion, title, body }) => {
  let room = await prisma.matchRoom.findUnique({ where: { matchId } });
  if (room) room = await ensureMatchRoom({ matchId, force: true, notify: false });
  else room = await ensureMatchRoom({ matchId });
  if (!room) return null;
  const members = await prisma.matchRoomMember.findMany({ where: { roomId: room.id, notificationsMuted: false }, select: { userId: true } });
  return createNotification({
    eventKey: `match-room:${room.id}:${type}:${eventVersion}`,
    type,
    title,
    body,
    actionUrl: `/match-room/${room.code}`,
    matchRoomId: room.id,
    userIds: members.map((entry) => entry.userId),
  });
};

const notifyVetoTurn = async (vetoRoom) => {
  if (!vetoRoom?.id) return;
  const source = await prisma.vetoRoom.findUnique({
    where: { id: vetoRoom.id },
    select: {
      id: true,
      matchId: true,
      code: true,
      revision: true,
      status: true,
      currentStep: true,
      teamASlot: true,
      tossCallerSlot: true,
      tossWinnerSlot: true,
      configSnapshot: true,
      rulePreset: { select: { steps: true } },
    },
  });
  const matchId = source?.matchId;
  if (!matchId) return;
  const room = await ensureMatchRoom({ matchId });
  if (!room) return;
  if (!new Set(["toss_pending", "in_progress"]).has(source.status)) return;
  let targetSlot = null;
  if (source.status === "toss_pending") targetSlot = source.tossWinnerSlot || source.tossCallerSlot || null;
  else {
    const step = (source.rulePreset?.steps || source.configSnapshot?.steps || [])[source.currentStep];
    if (step?.actor === "A") targetSlot = source.teamASlot;
    if (step?.actor === "B") targetSlot = source.teamASlot === 1 ? 2 : 1;
  }
  if (!targetSlot) return;
  const captains = await prisma.matchRoomMember.findMany({
    where: { roomId: room.id, role: "captain", teamSlot: targetSlot, notificationsMuted: false },
    select: { userId: true },
  });
  await createNotification({
    eventKey: `veto-room:${source.id}:turn:${source.revision}`,
    type: "veto_turn",
    title: "It is your team’s veto turn",
    body: "Open the match room to make the next selection.",
    actionUrl: `/match-room/${room.code}?tab=veto`,
    matchRoomId: room.id,
    userIds: captains.map((entry) => entry.userId),
  });
};

module.exports = {
  collectRoomMembers,
  ensureMatchRoom,
  ensureMatchVetoRoom,
  accessRoom,
  getRoom,
  listMyRooms,
  listStaffRooms,
  listMessages,
  sendMessage,
  markRoomRead,
  listSupport,
  openSupport,
  replySupport,
  resolveSupport,
  hideMessage,
  setMemberMute,
  setChatLock,
  notifyMatchChange,
  notifyVetoTurn,
};
