process.env.DOTENV_CONFIG_QUIET = process.env.DOTENV_CONFIG_QUIET || "true";

const { env } = require("../src/config/env");
const {
  MAIL_CONFIG_KEYS,
  getMailTransporter,
  isMailConfigured,
} = require("../src/lib/mail/transporter");

const main = async () => {
  if (!isMailConfigured()) {
    const missingKeys = MAIL_CONFIG_KEYS.filter((key) => {
      const value = env[key];
      return value === "" || value === null || value === undefined;
    });

    console.error(`Mail is not configured. Missing: ${missingKeys.join(", ")}`);
    process.exitCode = 1;
    return;
  }

  await getMailTransporter().verify();

  console.log("SMTP configuration verified.");
  console.log(`SMTP_HOST=${env.SMTP_HOST}`);
  console.log(`SMTP_PORT=${env.SMTP_PORT}`);
  console.log(`MAIL_FROM=${env.MAIL_FROM}`);
};

main().catch((error) => {
  console.error("SMTP verification failed.");
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
