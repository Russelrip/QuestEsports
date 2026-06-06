const crypto = require("crypto");
const { prisma } = require("../../lib/prisma");
const { HttpError } = require("../../lib/http-error");
const { normalizeSlug, normalizeText } = require("../../lib/validation");

const mapRulebook = (rulebook) => ({
  id: rulebook.id,
  slug: rulebook.slug,
  title: rulebook.title,
  game: rulebook.game,
  variant: rulebook.variant,
  content: rulebook.content,
  tournamentCount: rulebook._count?.tournaments ?? undefined,
  createdAt: rulebook.createdAt,
  updatedAt: rulebook.updatedAt,
});

const parseRulebookPayload = (body) => {
  const title = normalizeText(body.title);
  const slug = normalizeSlug(body.slug || title);
  const game = normalizeText(body.game);
  const variant = normalizeText(body.variant) || "Standard";
  const content = normalizeText(body.content);

  if (!title || !slug || !game || !content) {
    throw new HttpError(400, "Title, slug, game, and rulebook content are required.");
  }

  return { title, slug, game, variant, content };
};

const listRulebooks = async () => {
  const rulebooks = await prisma.rulebook.findMany({
    orderBy: [{ game: "asc" }, { variant: "asc" }, { title: "asc" }],
    include: { _count: { select: { tournaments: true } } },
  });
  return rulebooks.map(mapRulebook);
};

const getPublicRulebookBySlug = async (slug) => {
  const rulebook = await prisma.rulebook.findUnique({
    where: { slug: normalizeSlug(slug) },
  });
  if (!rulebook) {
    throw new HttpError(404, "Rulebook not found.");
  }
  return mapRulebook(rulebook);
};

const createRulebook = async (body) => {
  const payload = parseRulebookPayload(body);
  const existing = await prisma.rulebook.findUnique({ where: { slug: payload.slug }, select: { id: true } });
  if (existing) {
    throw new HttpError(400, "A rulebook with this slug already exists.");
  }
  return mapRulebook(await prisma.rulebook.create({ data: { id: crypto.randomUUID(), ...payload } }));
};

const updateRulebook = async (rulebookId, body) => {
  const payload = parseRulebookPayload(body);
  const existing = await prisma.rulebook.findFirst({
    where: { slug: payload.slug, id: { not: rulebookId } },
    select: { id: true },
  });
  if (existing) {
    throw new HttpError(400, "A rulebook with this slug already exists.");
  }
  return mapRulebook(await prisma.rulebook.update({ where: { id: rulebookId }, data: payload }));
};

const deleteRulebook = async (rulebookId) => {
  const deleted = await prisma.rulebook.deleteMany({ where: { id: rulebookId } });
  if (deleted.count === 0) {
    throw new HttpError(404, "Rulebook not found.");
  }
};

module.exports = {
  listRulebooks,
  getPublicRulebookBySlug,
  createRulebook,
  updateRulebook,
  deleteRulebook,
};
