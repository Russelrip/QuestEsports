const { env } = require("../../config/env");
const { prisma } = require("../prisma");
const { EMAIL_JOB_NAME, COURTESY_TEMPLATE_TYPES } = require("./mail-job-definitions");

// A ceiling on courtesy mail so it cannot eat the day's send allowance.
//
// The provider allows a fixed number of messages a day. Everything Quest sends
// draws on the same allowance, but not everything is equally worth sending: a
// verification link is the only way a new account can be used at all, and a
// password reset is the only way a locked-out one can be recovered. Those must
// never be crowded out by mail that is merely nice to have.
//
// So courtesy mail is held below a ceiling, leaving the remainder for the mail
// somebody is actively waiting on. Held, not dropped: a deferred job keeps its
// payload and goes out when the allowance resets.
//
// The ledger is the job table, which already records every successful send and
// keeps them for thirty days. There is no counter to keep in step with reality,
// because the count is derived from what actually happened.

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// The provider's allowance resets on its own clock, not ours. UTC is the
// default because that is the common convention, and it is configurable because
// getting it wrong should cost a config change rather than a code change: the
// only symptom would be courtesy mail resuming an hour early or late.
const startOfBudgetDay = (now = new Date()) => {
  const offsetMinutes = env.MAIL_BUDGET_RESET_OFFSET_MINUTES || 0;
  const shifted = new Date(now.getTime() - offsetMinutes * 60 * 1000);
  const midnight = Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate()
  );
  return new Date(midnight + offsetMinutes * 60 * 1000);
};

const nextBudgetReset = (now = new Date()) =>
  new Date(startOfBudgetDay(now).getTime() + MS_PER_DAY);

// Unknown classification means transactional, which means send. Withholding is
// the only outcome here with a cost attached, so it is never the answer to not
// knowing.
const isCourtesyMail = (payload) => {
  if (!COURTESY_TEMPLATE_TYPES || typeof COURTESY_TEMPLATE_TYPES !== "object") {
    return false;
  }

  return Object.prototype.hasOwnProperty.call(
    COURTESY_TEMPLATE_TYPES,
    String(payload?.type || "").trim()
  );
};

const countMailSentToday = async ({ database = prisma, now = new Date() } = {}) =>
  database.backgroundJob.count({
    where: {
      name: EMAIL_JOB_NAME,
      status: "succeeded",
      completedAt: { gte: startOfBudgetDay(now) },
    },
  });

// Returns when this job should be tried again, or null to send it now.
//
// Transactional mail is never deferred. If the allowance really is exhausted
// the provider will refuse it and the job's own retry handles that — which is
// the right failure, because a password reset that arrives late is worth more
// than one Quest decided not to attempt.
const getMailDeferral = async ({ payload, database = prisma, now = new Date() }) => {
  if (!isCourtesyMail(payload)) return null;

  const ceiling = env.MAIL_COURTESY_CEILING;
  if (!Number.isFinite(ceiling) || ceiling <= 0) return null;

  const sentToday = await countMailSentToday({ database, now });
  if (sentToday < ceiling) return null;

  return {
    availableAt: nextBudgetReset(now),
    sentToday,
    ceiling,
  };
};

module.exports = {
  startOfBudgetDay,
  nextBudgetReset,
  isCourtesyMail,
  countMailSentToday,
  getMailDeferral,
};
