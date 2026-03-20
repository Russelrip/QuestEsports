const escapeHtml = (value) =>
  String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const renderEmailLayout = ({ title, intro, actionLabel, actionUrl, outro }) => ({
  html: `
    <div style="background:#090313;padding:32px 16px;font-family:Segoe UI,Tahoma,Geneva,Verdana,sans-serif;color:#f5f3ff;">
      <div style="max-width:640px;margin:0 auto;background:linear-gradient(180deg,#140a27,#0e061c);border:1px solid rgba(192,132,252,0.25);border-radius:20px;padding:32px;box-shadow:0 18px 40px rgba(0,0,0,0.28);">
        <p style="margin:0 0 12px;font-size:12px;letter-spacing:0.16em;text-transform:uppercase;color:#c4b5fd;">Quest Esports</p>
        <h1 style="margin:0 0 16px;font-size:28px;line-height:1.2;color:#ffffff;">${escapeHtml(title)}</h1>
        <p style="margin:0 0 24px;font-size:16px;line-height:1.7;color:#ddd6fe;">${escapeHtml(intro)}</p>
        <a href="${escapeHtml(actionUrl)}" style="display:inline-block;padding:14px 22px;border-radius:999px;background:linear-gradient(135deg,#7c3aed,#a855f7);color:#ffffff;text-decoration:none;font-weight:700;">${escapeHtml(actionLabel)}</a>
        <p style="margin:24px 0 0;font-size:14px;line-height:1.7;color:#c4b5fd;">${escapeHtml(outro)}</p>
        <p style="margin:16px 0 0;font-size:13px;line-height:1.7;color:#a78bfa;word-break:break-all;">${escapeHtml(actionUrl)}</p>
      </div>
    </div>
  `,
  text: `${title}\n\n${intro}\n\n${actionLabel}: ${actionUrl}\n\n${outro}`,
});

const buildGreeting = (firstName, message) =>
  `Hi ${firstName || "there"}, ${message}`;

const buildVerificationEmail = ({ firstName, verificationUrl }) =>
  renderEmailLayout({
    title: "Verify your Quest Esports account",
    intro: buildGreeting(
      firstName,
      "confirm your email address to finish setting up your Quest Esports account."
    ),
    actionLabel: "Verify Email",
    actionUrl: verificationUrl,
    outro:
      "This verification link expires in 24 hours. If you did not create this account, you can ignore this email.",
  });

const buildResetPasswordEmail = ({ firstName, resetUrl }) =>
  renderEmailLayout({
    title: "Reset your Quest Esports password",
    intro: buildGreeting(
      firstName,
      "we received a request to reset your password."
    ),
    actionLabel: "Reset Password",
    actionUrl: resetUrl,
    outro:
      "This reset link expires soon. If you did not request a password reset, you can safely ignore this email.",
  });

const buildEmailChangeEmail = ({ firstName, nextEmail, confirmUrl }) =>
  renderEmailLayout({
    title: "Confirm your new Quest Esports email",
    intro: buildGreeting(
      firstName,
      `confirm ${nextEmail} as the new email address for your Quest Esports account.`
    ),
    actionLabel: "Confirm New Email",
    actionUrl: confirmUrl,
    outro:
      "This confirmation link expires in 24 hours. If you did not request this change, you can ignore this email and keep your current address.",
  });

const buildTeamInviteEmail = ({
  recipientName,
  teamName,
  captainName,
  tournamentTitle,
  inviteUrl,
}) =>
  renderEmailLayout({
    title: "Confirm your Quest Esports team invite",
    intro: buildGreeting(
      recipientName,
      `you have been invited by ${captainName} to join ${teamName}${
        tournamentTitle ? ` for ${tournamentTitle}` : ""
      }.`
    ),
    actionLabel: "Review Invite",
    actionUrl: inviteUrl,
    outro:
      "Open the invite to accept or decline your place on the roster. If you were not expecting this, you can safely ignore the email.",
  });

module.exports = {
  buildVerificationEmail,
  buildResetPasswordEmail,
  buildEmailChangeEmail,
  buildTeamInviteEmail,
};
