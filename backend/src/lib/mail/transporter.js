const nodemailer = require("nodemailer");
const { env } = require("../../config/env");

let transporter;

const getMailConfigKeys = () =>
  env.MAIL_PROVIDER === "resend"
    ? ["RESEND_API_KEY", "MAIL_FROM", "APP_URL"]
    : ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "MAIL_FROM", "APP_URL"];

const hasConfigValue = (value) => value !== "" && value !== null && value !== undefined;

const isMailConfigured = () =>
  getMailConfigKeys().every((key) => hasConfigValue(env[key]));

const getTransportOptions = () => {
  if (env.MAIL_PROVIDER === "resend") {
    return {
      host: "smtp.resend.com",
      port: 465,
      secure: true,
      auth: {
        user: "resend",
        pass: env.RESEND_API_KEY,
      },
    };
  }

  return {
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    auth: {
      user: env.SMTP_USER,
      pass: env.SMTP_PASS,
    },
  };
};

const getMailTransporter = () => {
  if (!isMailConfigured()) {
    return null;
  }

  if (!transporter) {
    transporter = nodemailer.createTransport(getTransportOptions());
  }

  return transporter;
};

module.exports = {
  getMailConfigKeys,
  getMailTransporter,
  isMailConfigured,
};
