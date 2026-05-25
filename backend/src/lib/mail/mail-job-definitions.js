const {
  buildVerificationEmail,
  buildResetPasswordEmail,
  buildEmailChangeEmail,
  buildTeamInviteEmail,
  buildSecurityAlertEmail,
} = require("./templates");
const { buildActionUrl, sendMail } = require("./sendMail");

const EMAIL_JOB_NAME = "email.send";
const EMAIL_TEMPLATE_TYPES = {
  verification: "verification",
  resetPassword: "resetPassword",
  emailChange: "emailChange",
  teamInvite: "teamInvite",
  securityAlert: "securityAlert",
};

const processQueuedMailJob = async (payload = {}) => {
  const type = String(payload.type || "").trim();

  switch (type) {
    case EMAIL_TEMPLATE_TYPES.verification:
      return sendMail({
        email: payload.email,
        subject: "Verify your Quest Esports account",
        skippedLogMessage: "Verification email skipped because SMTP is not configured.",
        templateBuilder: () =>
          buildVerificationEmail({
            firstName: payload.firstName,
            verificationUrl: buildActionUrl("/verify-email", payload.rawToken),
          }),
      });
    case EMAIL_TEMPLATE_TYPES.resetPassword:
      return sendMail({
        email: payload.email,
        subject: "Reset your Quest Esports password",
        skippedLogMessage:
          "Password reset email skipped because SMTP is not configured.",
        templateBuilder: () =>
          buildResetPasswordEmail({
            firstName: payload.firstName,
            resetUrl: buildActionUrl("/reset-password", payload.rawToken),
          }),
      });
    case EMAIL_TEMPLATE_TYPES.emailChange:
      return sendMail({
        email: payload.email,
        subject: "Confirm your new Quest Esports email",
        skippedLogMessage:
          "Email change confirmation skipped because SMTP is not configured.",
        templateBuilder: () =>
          buildEmailChangeEmail({
            firstName: payload.firstName,
            nextEmail: payload.nextEmail,
            confirmUrl: buildActionUrl("/confirm-email-change", payload.rawToken),
          }),
      });
    case EMAIL_TEMPLATE_TYPES.teamInvite:
      return sendMail({
        email: payload.email,
        subject: "Quest Esports team invitation",
        skippedLogMessage:
          "Team invitation email skipped because SMTP is not configured.",
        templateBuilder: () =>
          buildTeamInviteEmail({
            recipientName: payload.recipientName,
            teamName: payload.teamName,
            captainName: payload.captainName,
            tournamentTitle: payload.tournamentTitle,
            inviteUrl: buildActionUrl("/team-invite", payload.rawToken),
          }),
      });
    case EMAIL_TEMPLATE_TYPES.securityAlert:
      return sendMail({
        email: payload.email,
        subject: payload.subject,
        skippedLogMessage:
          "Security alert email skipped because SMTP is not configured.",
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
    default:
      throw new Error(`Unsupported queued mail type: ${type || "unknown"}`);
  }
};

module.exports = {
  EMAIL_JOB_NAME,
  EMAIL_TEMPLATE_TYPES,
  processQueuedMailJob,
};
