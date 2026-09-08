const {
  buildVerificationEmail,
  buildResetPasswordEmail,
  buildEmailChangeEmail,
  buildRegistrationReceivedEmail,
  buildSecurityAlertEmail,
  buildTicketOrderEmail,
} = require("./templates");
const { buildActionUrl, sendMail } = require("./sendMail");
const { decryptSecret } = require("../secret-box");
const { logger } = require("../logger");

const EMAIL_JOB_NAME = "email.send";
// Mail nobody is blocked on. Held below a ceiling when the day's send allowance
// is running down, so it cannot crowd out a verification or a password reset —
// the two kinds of mail where not arriving means somebody cannot use their
// account at all. Held, never dropped: see mail-budget.js.
const COURTESY_TEMPLATE_TYPES = {
  registrationReceived: "registrationReceived",
};
// Types no longer enqueued, kept only so jobs already in the queue at deploy
// time drain instead of failing their way through every retry.
const RETIRED_TEMPLATE_TYPES = {
  teamInvite: "teamInvite",
};
const EMAIL_TEMPLATE_TYPES = {
  verification: "verification",
  resetPassword: "resetPassword",
  emailChange: "emailChange",
  registrationReceived: "registrationReceived",
  securityAlert: "securityAlert",
  ticketOrder: "ticketOrder",
};

const getRawToken = (payload) =>
  payload.tokenCiphertext
    ? decryptSecret(payload.tokenCiphertext)
    : payload.rawToken;

const processQueuedMailJob = async (payload = {}, { jobId } = {}) => {
  const type = String(payload.type || "").trim();

  switch (type) {
    case EMAIL_TEMPLATE_TYPES.verification:
      return sendMail({
        deliveryId: jobId,
        email: payload.email,
        subject: "Verify your Quest E-sports account",
        skippedLogMessage:
          "Verification email skipped because mail delivery is not configured.",
        templateBuilder: () =>
          buildVerificationEmail({
            firstName: payload.firstName,
            verificationUrl: buildActionUrl(
              "/verify-email",
              getRawToken(payload),
              payload.redirectTo || null,
            ),
          }),
      });
    case EMAIL_TEMPLATE_TYPES.resetPassword:
      return sendMail({
        deliveryId: jobId,
        email: payload.email,
        subject: "Reset your Quest E-sports password",
        skippedLogMessage:
          "Password reset email skipped because mail delivery is not configured.",
        templateBuilder: () =>
          buildResetPasswordEmail({
            firstName: payload.firstName,
            resetUrl: buildActionUrl("/reset-password", getRawToken(payload)),
          }),
      });
    case EMAIL_TEMPLATE_TYPES.emailChange:
      return sendMail({
        deliveryId: jobId,
        email: payload.email,
        subject: "Confirm your new Quest E-sports email",
        skippedLogMessage:
          "Email change confirmation skipped because mail delivery is not configured.",
        templateBuilder: () =>
          buildEmailChangeEmail({
            firstName: payload.firstName,
            nextEmail: payload.nextEmail,
            confirmUrl: buildActionUrl(
              "/confirm-email-change",
              getRawToken(payload),
            ),
          }),
      });
    case EMAIL_TEMPLATE_TYPES.registrationReceived:
      return sendMail({
        deliveryId: jobId,
        email: payload.email,
        subject: "Your Quest E-sports registration was received",
        skippedLogMessage:
          "Registration received email skipped because mail delivery is not configured.",
        templateBuilder: () =>
          buildRegistrationReceivedEmail({
            recipientName: payload.recipientName,
            teamName: payload.teamName,
            tournamentTitle: payload.tournamentTitle,
            pendingMemberCount: payload.pendingMemberCount,
          }),
      });
    case EMAIL_TEMPLATE_TYPES.securityAlert:
      return sendMail({
        deliveryId: jobId,
        email: payload.email,
        subject: payload.subject,
        skippedLogMessage:
          "Security alert email skipped because mail delivery is not configured.",
        templateBuilder: () =>
          buildSecurityAlertEmail({
            firstName: payload.firstName,
            title: payload.title,
            message: payload.message,
            actionLabel: payload.actionLabel,
            actionUrl: payload.actionUrl,
            outro: payload.outro,
          }),
      });
    case EMAIL_TEMPLATE_TYPES.ticketOrder:
      return sendMail({
        deliveryId: jobId,
        email: payload.email,
        subject: `Your Quest E-sports tickets for ${payload.eventTitle}`,
        skippedLogMessage:
          "Ticket confirmation email skipped because mail delivery is not configured.",
        templateBuilder: () =>
          buildTicketOrderEmail({
            firstName: payload.firstName,
            eventTitle: payload.eventTitle,
            quantity: payload.quantity,
            orderUrl: buildActionUrl("/tickets/order", getRawToken(payload)),
          }),
      });
    // A retired template, drained rather than retried. `teamInvite` was one:
    // its whole payload was a token pointing at a page that no longer exists,
    // so a job queued just before the deploy has nothing left to deliver and
    // failing it five times would only be noise. An invitation is not lost by
    // this — it is a row the invitee can find by signing in, which is the
    // reason the email stopped being sent.
    case RETIRED_TEMPLATE_TYPES.teamInvite:
      logger.info("Queued mail skipped for a retired template.", { jobId, type });
      return { skipped: true, retired: true };
    default:
      throw new Error(`Unsupported queued mail type: ${type || "unknown"}`);
  }
};

module.exports = {
  EMAIL_JOB_NAME,
  EMAIL_TEMPLATE_TYPES,
  COURTESY_TEMPLATE_TYPES,
  RETIRED_TEMPLATE_TYPES,
  processQueuedMailJob,
};
