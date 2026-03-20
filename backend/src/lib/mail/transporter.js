const nodemailer = require("nodemailer");
const { env } = require("../../config/env");

let transporter;

const MAIL_CONFIG_KEYS = [
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_USER",
  "SMTP_PASS",
  "MAIL_FROM",
  "APP_URL",
];

const hasConfigValue = (value) => value !== "" && value !== null && value !== undefined;

const isMailConfigured = () => MAIL_CONFIG_KEYS.every((key) => hasConfigValue(env[key]));

const getMailTransporter = () => {
  if (!isMailConfigured()) {
    return null;
  }

  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_PORT === 465,
      auth: {
        user: env.SMTP_USER,
        pass: env.SMTP_PASS,
      },
    });
  }

  return transporter;
};

module.exports = {
  MAIL_CONFIG_KEYS,
  getMailTransporter,
  isMailConfigured,
};
