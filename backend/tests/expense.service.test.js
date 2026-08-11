const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const servicePath = path.join(__dirname, "../src/modules/expenses/expense.service.js");
const prismaPath = path.join(__dirname, "../src/lib/prisma.js");

const loadService = (prisma) => loadModuleWithMocks(servicePath, { [prismaPath]: { prisma } });

const baseExpense = (overrides = {}) => ({
  id: "expense-1",
  tournamentId: "tournament-1",
  ticketEventId: null,
  description: "Venue deposit",
  category: "venue",
  vendor: "Arena",
  amount: "25000.00",
  currency: "LKR",
  status: "pending",
  expenseDate: new Date("2026-08-10T00:00:00.000Z"),
  notes: null,
  createdBy: { id: "admin-1", firstName: "Quest", lastName: "Admin" },
  tournament: { id: "tournament-1", title: "Quest Cup" },
  ticketEvent: null,
  createdAt: new Date("2026-08-10T00:00:00.000Z"),
  updatedAt: new Date("2026-08-10T00:00:00.000Z"),
  ...overrides,
});

test("expense targets include inactive tournaments for historical cost tracking", async () => {
  let tournamentQuery;
  const { module: service, restore } = loadService({
    tournament: {
      findMany: async (args) => {
        tournamentQuery = args;
        return [{
          id: "tournament-1",
          title: "Completed Quest Cup",
          status: "completed",
          startDate: new Date("2026-07-01T00:00:00.000Z"),
          registrationFeeCurrency: "LKR",
        }];
      },
    },
    ticketEvent: { findMany: async () => [] },
  });
  try {
    const targets = await service.listExpenseTargets();
    assert.equal(Object.hasOwn(tournamentQuery, "where"), false);
    assert.deepEqual(targets, [{
      type: "tournament",
      id: "tournament-1",
      title: "Completed Quest Cup",
      status: "completed",
      date: new Date("2026-07-01T00:00:00.000Z"),
      currency: "LKR",
    }]);
  } finally {
    restore();
  }
});

test("event expense summaries exclude cancelled costs from the tracked total", async () => {
  const { module: service, restore } = loadService({
    tournament: { findUnique: async () => ({ id: "tournament-1", title: "Quest Cup", registrationFeeCurrency: "LKR" }) },
    eventExpense: {
      findMany: async () => [
        baseExpense(),
        baseExpense({ id: "expense-2", amount: "5000.00", status: "paid" }),
        baseExpense({ id: "expense-3", amount: "1000.00", status: "cancelled" }),
      ],
    },
  });
  try {
    const result = await service.listExpenses({ targetType: "tournament", targetId: "tournament-1" });
    assert.equal(result.expenses.length, 3);
    assert.deepEqual(result.summary, [{ currency: "LKR", total: 30000, paid: 5000, pending: 25000, cancelled: 1000 }]);
  } finally {
    restore();
  }
});

test("creating an event expense links exactly the selected ticketed event", async () => {
  let createArgs;
  const { module: service, restore } = loadService({
    ticketEvent: { findUnique: async () => ({ id: "event-1", title: "Quest LAN", currency: "LKR" }) },
    eventExpense: {
      create: async (args) => {
        createArgs = args;
        return baseExpense({ ...args.data, tournamentId: null, ticketEventId: "event-1", tournament: null, ticketEvent: { id: "event-1", title: "Quest LAN" } });
      },
    },
  });
  try {
    const expense = await service.createExpense({
      adminUserId: "admin-1",
      body: { targetType: "event", targetId: "event-1", description: "Staff meals", category: "catering", amount: "7500", status: "paid", expenseDate: "2026-08-11" },
    });
    assert.equal(createArgs.data.tournamentId, null);
    assert.equal(createArgs.data.ticketEventId, "event-1");
    assert.equal(createArgs.data.createdById, "admin-1");
    assert.equal(expense.targetType, "event");
  } finally {
    restore();
  }
});

test("event expenses reject unsupported categories before writing", async () => {
  const { module: service, restore } = loadService({
    tournament: { findUnique: async () => ({ id: "tournament-1", title: "Quest Cup", registrationFeeCurrency: "LKR" }) },
  });
  try {
    await assert.rejects(
      service.createExpense({ body: { targetType: "tournament", targetId: "tournament-1", description: "Mystery", category: "unknown", amount: 10, expenseDate: "2026-08-11" } }),
      (error) => error.statusCode === 400 && /category/i.test(error.message),
    );
  } finally {
    restore();
  }
});
