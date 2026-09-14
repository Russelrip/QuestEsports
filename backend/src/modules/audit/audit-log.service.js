const { prisma } = require("../../lib/prisma");
const { HttpError } = require("../../lib/http-error");
const { buildPagination, buildPagedResponse } = require("../../lib/pagination");

// Read side of lib/audit.js. Rows are already sanitized on the way in, so this
// returns them as stored; nothing here may widen what an audit row contains.

// Kept in step with the AuditSource enum and lib/audit.js.
const AUDIT_SOURCES = Object.freeze(["web", "admin", "mobile", "bot", "system"]);
const AUDIT_LOG_MAX_PAGE_SIZE = 100;
const SEARCH_MAX_LENGTH = 120;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const actorSelect = {
  id: true,
  username: true,
  firstName: true,
  lastName: true,
  email: true,
};

const text = (value) => (typeof value === "string" ? value.trim().slice(0, SEARCH_MAX_LENGTH) : "");

// actor_user_id is a uuid column: Postgres rejects the whole query for a
// malformed value, so refuse it here with a 400 instead of surfacing a 500.
const parseActorUserId = (value) => {
  const id = text(value);
  if (!id) return null;
  if (!UUID_PATTERN.test(id)) throw new HttpError(400, "actorUserId must be a user id.");
  return id;
};

const parseSource = (value) => {
  const source = text(value);
  if (!source) return null;
  if (!AUDIT_SOURCES.includes(source)) {
    throw new HttpError(400, `source must be one of: ${AUDIT_SOURCES.join(", ")}.`);
  }
  return source;
};

const parseInstant = (value, name) => {
  const raw = text(value);
  if (!raw) return null;
  const instant = new Date(raw);
  if (Number.isNaN(instant.getTime())) throw new HttpError(400, `${name} must be a date.`);
  return instant;
};

const buildAuditLogWhere = (query = {}) => {
  const action = text(query.action);
  const targetType = text(query.targetType);
  const targetId = text(query.targetId);
  const actorUserId = parseActorUserId(query.actorUserId);
  const actor = text(query.actor);
  const source = parseSource(query.source);
  const from = parseInstant(query.from, "from");
  const to = parseInstant(query.to, "to");
  if (from && to && from > to) throw new HttpError(400, "from must be before to.");

  const actorMatch = actor
    ? {
        actor: {
          is: {
            OR: [
              { username: { contains: actor, mode: "insensitive" } },
              { email: { contains: actor, mode: "insensitive" } },
              { firstName: { contains: actor, mode: "insensitive" } },
              { lastName: { contains: actor, mode: "insensitive" } },
            ],
          },
        },
      }
    : {};

  return {
    ...(action ? { action } : {}),
    ...(targetType ? { targetType } : {}),
    ...(targetId ? { targetId } : {}),
    ...(actorUserId ? { actorUserId } : {}),
    ...actorMatch,
    ...(source ? { source } : {}),
    // `to` is exclusive so a day filter can pass the next midnight.
    ...(from || to
      ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) } }
      : {}),
  };
};

const mapActor = (actor) =>
  actor
    ? {
        id: actor.id,
        username: actor.username,
        name: [actor.firstName, actor.lastName].filter(Boolean).join(" ") || null,
        email: actor.email,
      }
    : null;

const mapAuditLog = (row) => ({
  id: row.id,
  createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
  action: row.action,
  targetType: row.targetType,
  targetId: row.targetId,
  // Null for automation, and for an account deleted since (onDelete SetNull):
  // the row cannot tell those apart, so neither does the response.
  actorUserId: row.actorUserId,
  actor: mapActor(row.actor),
  source: row.source,
  reason: row.reason,
  requestId: row.requestId,
  ipAddress: row.ipAddress,
  beforeData: row.beforeData ?? null,
  afterData: row.afterData ?? null,
});

const listAuditLogs = async (query = {}) => {
  const where = buildAuditLogWhere(query);
  const pagination = buildPagination(
    { page: query.page, pageSize: query.pageSize },
    { maxPageSize: AUDIT_LOG_MAX_PAGE_SIZE }
  );

  const [total, rows] = await prisma.$transaction([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      include: { actor: { select: actorSelect } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (pagination.page - 1) * pagination.pageSize,
      take: pagination.pageSize,
    }),
  ]);

  return buildPagedResponse({
    items: rows.map(mapAuditLog),
    total,
    page: pagination.page,
    pageSize: pagination.pageSize,
  });
};

// The distinct actions and target types actually present, for filter menus.
// Callers pass free-form strings, so the stored values are the only honest list.
const listAuditLogFacets = async () => {
  const [actions, targetTypes] = await Promise.all([
    prisma.auditLog.groupBy({ by: ["action"], _count: { _all: true }, orderBy: { action: "asc" } }),
    prisma.auditLog.groupBy({ by: ["targetType"], _count: { _all: true }, orderBy: { targetType: "asc" } }),
  ]);

  return {
    actions: actions.map((row) => ({ value: row.action, count: row._count._all })),
    targetTypes: targetTypes.map((row) => ({ value: row.targetType, count: row._count._all })),
    sources: [...AUDIT_SOURCES],
  };
};

module.exports = {
  AUDIT_LOG_MAX_PAGE_SIZE,
  AUDIT_SOURCES,
  buildAuditLogWhere,
  listAuditLogFacets,
  listAuditLogs,
  mapAuditLog,
};
