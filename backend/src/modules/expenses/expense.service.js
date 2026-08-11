const crypto = require("crypto");
const { prisma } = require("../../lib/prisma");
const { HttpError } = require("../../lib/http-error");
const { normalizeText } = require("../../lib/validation");

const EXPENSE_CATEGORIES = new Set([
  "venue",
  "prize_pool",
  "staff",
  "equipment",
  "marketing",
  "travel",
  "catering",
  "production",
  "fees",
  "other",
]);
const EXPENSE_STATUSES = new Set(["pending", "paid", "cancelled"]);

const parseTargetType = (value) => {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized === "tournament") return "tournament";
  if (["event", "ticket_event", "ticket-event"].includes(normalized)) return "event";
  throw new HttpError(400, "Choose a valid tournament or event.");
};

const parseExpenseDate = (value, fallback) => {
  const raw = normalizeText(value) || (fallback ? new Date(fallback).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new HttpError(400, "Expense date must use YYYY-MM-DD.");
  }
  const parsed = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== raw) {
    throw new HttpError(400, "Expense date is invalid.");
  }
  return parsed;
};

const mapExpense = (expense) => ({
  id: expense.id,
  targetType: expense.tournamentId ? "tournament" : "event",
  targetId: expense.tournamentId || expense.ticketEventId,
  targetTitle: expense.tournament?.title || expense.ticketEvent?.title || null,
  description: expense.description,
  category: expense.category,
  vendor: expense.vendor,
  amount: Number(expense.amount),
  currency: expense.currency,
  status: expense.status,
  expenseDate: new Date(expense.expenseDate).toISOString().slice(0, 10),
  notes: expense.notes,
  createdBy: expense.createdBy
    ? {
        id: expense.createdBy.id,
        name: `${expense.createdBy.firstName} ${expense.createdBy.lastName}`.trim(),
      }
    : null,
  createdAt: expense.createdAt,
  updatedAt: expense.updatedAt,
});

const expenseInclude = {
  tournament: { select: { id: true, title: true } },
  ticketEvent: { select: { id: true, title: true } },
  createdBy: { select: { id: true, firstName: true, lastName: true } },
};

const ensureTargetExists = async (targetType, targetId) => {
  const id = normalizeText(targetId);
  if (!id) throw new HttpError(400, "Choose a tournament or event.");
  const target = targetType === "tournament"
    ? await prisma.tournament.findUnique({ where: { id }, select: { id: true, title: true, registrationFeeCurrency: true } })
    : await prisma.ticketEvent.findUnique({ where: { id }, select: { id: true, title: true, currency: true } });
  if (!target) throw new HttpError(404, targetType === "tournament" ? "Tournament not found." : "Event not found.");
  return target;
};

const parsePayload = async ({ body, existing }) => {
  const targetType = parseTargetType(body.targetType || (existing?.tournamentId ? "tournament" : "event"));
  const targetId = normalizeText(body.targetId || existing?.tournamentId || existing?.ticketEventId);
  const target = await ensureTargetExists(targetType, targetId);
  const description = normalizeText(body.description ?? existing?.description);
  const category = normalizeText(body.category ?? existing?.category ?? "other").toLowerCase();
  const vendor = normalizeText(body.vendor ?? existing?.vendor) || null;
  const rawAmount = body.amount ?? existing?.amount;
  const amount = Number(rawAmount);
  const currency = normalizeText(body.currency ?? existing?.currency ?? target.registrationFeeCurrency ?? target.currency ?? "LKR").toUpperCase();
  const status = normalizeText(body.status ?? existing?.status ?? "pending").toLowerCase();
  const notes = normalizeText(body.notes ?? existing?.notes) || null;
  const expenseDate = parseExpenseDate(body.expenseDate, existing?.expenseDate);

  if (!description) throw new HttpError(400, "Expense description is required.");
  if (description.length > 160) throw new HttpError(400, "Expense description must be 160 characters or fewer.");
  if (!EXPENSE_CATEGORIES.has(category)) throw new HttpError(400, "Choose a valid expense category.");
  if (vendor && vendor.length > 120) throw new HttpError(400, "Vendor must be 120 characters or fewer.");
  if (!Number.isFinite(amount) || amount < 0 || amount > 9999999999.99) throw new HttpError(400, "Enter a valid non-negative expense amount.");
  if (!/^[A-Z]{3}$/.test(currency)) throw new HttpError(400, "Currency must be a three-letter code such as LKR.");
  if (!EXPENSE_STATUSES.has(status)) throw new HttpError(400, "Choose a valid expense status.");
  if (notes && notes.length > 1000) throw new HttpError(400, "Notes must be 1,000 characters or fewer.");

  return {
    tournamentId: targetType === "tournament" ? targetId : null,
    ticketEventId: targetType === "event" ? targetId : null,
    description,
    category,
    vendor,
    amount: amount.toFixed(2),
    currency,
    status,
    expenseDate,
    notes,
  };
};

const listExpenseTargets = async () => {
  const [tournaments, events] = await Promise.all([
    prisma.tournament.findMany({
      orderBy: [{ startDate: { sort: "desc", nulls: "last" } }, { title: "asc" }],
      select: { id: true, title: true, status: true, startDate: true, registrationFeeCurrency: true },
    }),
    prisma.ticketEvent.findMany({
      orderBy: [{ startsAt: "desc" }, { title: "asc" }],
      select: { id: true, title: true, status: true, startsAt: true, currency: true },
    }),
  ]);
  return [
    ...tournaments.map((item) => ({ type: "tournament", id: item.id, title: item.title, status: item.status, date: item.startDate, currency: item.registrationFeeCurrency })),
    ...events.map((item) => ({ type: "event", id: item.id, title: item.title, status: item.status, date: item.startsAt, currency: item.currency })),
  ];
};

const listExpenses = async ({ targetType: rawTargetType, targetId }) => {
  const targetType = parseTargetType(rawTargetType);
  const target = await ensureTargetExists(targetType, targetId);
  const expenses = await prisma.eventExpense.findMany({
    where: targetType === "tournament" ? { tournamentId: normalizeText(targetId) } : { ticketEventId: normalizeText(targetId) },
    orderBy: [{ expenseDate: "desc" }, { createdAt: "desc" }],
    include: expenseInclude,
  });
  const mapped = expenses.map(mapExpense);
  const summaryByCurrency = new Map();
  mapped.forEach((expense) => {
    const summary = summaryByCurrency.get(expense.currency) || { currency: expense.currency, total: 0, paid: 0, pending: 0, cancelled: 0 };
    summary[expense.status] += expense.amount;
    if (expense.status !== "cancelled") summary.total += expense.amount;
    summaryByCurrency.set(expense.currency, summary);
  });
  return {
    target: { type: targetType, id: target.id, title: target.title },
    expenses: mapped,
    summary: [...summaryByCurrency.values()],
  };
};

const createExpense = async ({ body, adminUserId }) => {
  const data = await parsePayload({ body });
  const expense = await prisma.eventExpense.create({
    data: { id: crypto.randomUUID(), ...data, createdById: adminUserId || null },
    include: expenseInclude,
  });
  return mapExpense(expense);
};

const updateExpense = async ({ expenseId, body }) => {
  const existing = await prisma.eventExpense.findUnique({ where: { id: expenseId } });
  if (!existing) throw new HttpError(404, "Expense not found.");
  const data = await parsePayload({ body, existing });
  const expense = await prisma.eventExpense.update({ where: { id: expenseId }, data, include: expenseInclude });
  return { before: mapExpense({ ...existing, createdBy: null }), expense: mapExpense(expense) };
};

const deleteExpense = async (expenseId) => {
  const existing = await prisma.eventExpense.findUnique({ where: { id: expenseId }, include: expenseInclude });
  if (!existing) throw new HttpError(404, "Expense not found.");
  await prisma.eventExpense.delete({ where: { id: expenseId } });
  return mapExpense(existing);
};

module.exports = {
  EXPENSE_CATEGORIES,
  EXPENSE_STATUSES,
  parseExpenseDate,
  listExpenseTargets,
  listExpenses,
  createExpense,
  updateExpense,
  deleteExpense,
};
