const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const budgetPath = path.join(__dirname, "../src/lib/mail/mail-budget.js");
const envPath = path.join(__dirname, "../src/config/env.js");
const prismaPath = path.join(__dirname, "../src/lib/prisma.js");
const definitionsPath = path.join(__dirname, "../src/lib/mail/mail-job-definitions.js");

// The provider allows a fixed number of messages a day and everything Quest
// sends draws on the same allowance. A verification link and a password reset
// are the only way into and back into an account, so they must never be
// crowded out by mail nobody is blocked on.

const loadBudget = ({
  sentToday = 0,
  ceiling = 60,
  offsetMinutes = 0,
  courtesyTypes = { registrationReceived: "registrationReceived" },
} = {}) => {
  const state = { counts: [] };
  const loaded = loadModuleWithMocks(budgetPath, {
    [envPath]: {
      env: {
        MAIL_DAILY_LIMIT: 100,
        MAIL_COURTESY_CEILING: ceiling,
        MAIL_BUDGET_RESET_OFFSET_MINUTES: offsetMinutes,
      },
    },
    [prismaPath]: {
      prisma: {
        backgroundJob: {
          count: async (args) => {
            state.counts.push(args);
            return sentToday;
          },
        },
      },
    },
    [definitionsPath]: {
      EMAIL_JOB_NAME: "email.send",
      COURTESY_TEMPLATE_TYPES: courtesyTypes,
    },
  });
  return { ...loaded, state };
};

test("courtesy mail is held once the ceiling is reached", async () => {
  const { module: budget, restore } = loadBudget({ sentToday: 60, ceiling: 60 });
  try {
    const now = new Date("2026-09-08T15:00:00.000Z");
    const deferral = await budget.getMailDeferral({
      payload: { type: "registrationReceived" },
      now,
    });

    assert.ok(deferral);
    // Held, not dropped: it goes out when the allowance resets.
    assert.equal(deferral.availableAt.toISOString(), "2026-09-09T00:00:00.000Z");
    assert.equal(deferral.sentToday, 60);
  } finally {
    restore();
  }
});

test("courtesy mail below the ceiling goes out now", async () => {
  const { module: budget, restore } = loadBudget({ sentToday: 59, ceiling: 60 });
  try {
    assert.equal(
      await budget.getMailDeferral({ payload: { type: "registrationReceived" } }),
      null,
    );
  } finally {
    restore();
  }
});

test("transactional mail is never held, however little allowance is left", async () => {
  const { module: budget, restore, state } = loadBudget({ sentToday: 99, ceiling: 60 });
  try {
    for (const type of ["verification", "resetPassword", "emailChange", "securityAlert"]) {
      assert.equal(await budget.getMailDeferral({ payload: { type } }), null);
    }
    // Not even counted: there is no decision to make, so there is no query to
    // run on the way to making it.
    assert.deepEqual(state.counts, []);
  } finally {
    restore();
  }
});

test("an unclassifiable payload is treated as transactional", async () => {
  const { module: budget, restore } = loadBudget({ sentToday: 99, courtesyTypes: null });
  try {
    // Withholding is the only outcome here with a cost attached, so it is never
    // the answer to not knowing.
    assert.equal(budget.isCourtesyMail({ type: "registrationReceived" }), false);
    assert.equal(await budget.getMailDeferral({ payload: {} }), null);
  } finally {
    restore();
  }
});

test("a ceiling of zero or nonsense disables the hold rather than blocking everything", async () => {
  for (const ceiling of [0, Number.NaN]) {
    const { module: budget, restore } = loadBudget({ sentToday: 5000, ceiling });
    try {
      assert.equal(
        await budget.getMailDeferral({ payload: { type: "registrationReceived" } }),
        null,
      );
    } finally {
      restore();
    }
  }
});

test("the day is counted from the provider's reset, which is configurable", async () => {
  const { module: budget, restore, state } = loadBudget({ sentToday: 60 });
  try {
    await budget.getMailDeferral({
      payload: { type: "registrationReceived" },
      now: new Date("2026-09-08T15:00:00.000Z"),
    });
    const [args] = state.counts;
    // The ledger is the job table itself: every successful send is already
    // recorded there, so there is no counter to keep in step with reality.
    assert.equal(args.where.name, "email.send");
    assert.equal(args.where.status, "succeeded");
    assert.equal(args.where.completedAt.gte.toISOString(), "2026-09-08T00:00:00.000Z");
  } finally {
    restore();
  }

  const shifted = loadBudget({ sentToday: 60, offsetMinutes: 330 });
  try {
    // A provider that resets at 05:30 UTC puts 05:00 in the previous day.
    assert.equal(
      shifted.module.startOfBudgetDay(new Date("2026-09-08T05:00:00.000Z")).toISOString(),
      "2026-09-07T05:30:00.000Z",
    );
    assert.equal(
      shifted.module.startOfBudgetDay(new Date("2026-09-08T06:00:00.000Z")).toISOString(),
      "2026-09-08T05:30:00.000Z",
    );
  } finally {
    shifted.restore();
  }
});
