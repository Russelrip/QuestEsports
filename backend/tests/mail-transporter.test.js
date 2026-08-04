const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const transporterPath = path.join(__dirname, "../src/lib/mail/transporter.js");
const envPath = path.join(__dirname, "../src/config/env.js");
const nodemailerPath = require.resolve("nodemailer");

const loadTransporter = (env) => {
  const transportOptions = [];
  const transport = { sendMail: async () => {}, verify: async () => true };
  const loaded = loadModuleWithMocks(transporterPath, {
    [envPath]: { env },
    [nodemailerPath]: {
      createTransport: (options) => {
        transportOptions.push(options);
        return transport;
      },
    },
  });

  return { ...loaded, transport, transportOptions };
};

test("Resend provider creates the documented secure SMTP transport", () => {
  const { module, restore, transport, transportOptions } = loadTransporter({
    MAIL_PROVIDER: "resend",
    RESEND_API_KEY: "re_test_key",
    MAIL_FROM: "Quest Esports <no-reply@example.com>",
    APP_URL: "https://example.com",
  });

  try {
    assert.equal(module.isMailConfigured(), true);
    assert.equal(module.getMailTransporter(), transport);
    assert.deepEqual(transportOptions, [
      {
        host: "smtp.resend.com",
        port: 465,
        secure: true,
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 60_000,
        auth: { user: "resend", pass: "re_test_key" },
      },
    ]);
  } finally {
    restore();
  }
});

test("SMTP provider remains available for a future SES switch", () => {
  const { module, restore, transportOptions } = loadTransporter({
    MAIL_PROVIDER: "smtp",
    SMTP_HOST: "email-smtp.ap-northeast-1.amazonaws.com",
    SMTP_PORT: 587,
    SMTP_USER: "ses-user",
    SMTP_PASS: "ses-password",
    MAIL_FROM: "Quest Esports <no-reply@example.com>",
    APP_URL: "https://example.com",
  });

  try {
    assert.equal(module.isMailConfigured(), true);
    module.getMailTransporter();
    assert.deepEqual(transportOptions, [
      {
        host: "email-smtp.ap-northeast-1.amazonaws.com",
        port: 587,
        secure: false,
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 60_000,
        auth: { user: "ses-user", pass: "ses-password" },
      },
    ]);
  } finally {
    restore();
  }
});

test("Resend provider reports missing configuration without creating a transport", () => {
  const { module, restore, transportOptions } = loadTransporter({
    MAIL_PROVIDER: "resend",
    RESEND_API_KEY: "",
    MAIL_FROM: "Quest Esports <no-reply@example.com>",
    APP_URL: "https://example.com",
  });

  try {
    assert.equal(module.isMailConfigured(), false);
    assert.equal(module.getMailTransporter(), null);
    assert.deepEqual(transportOptions, []);
    assert.deepEqual(module.getMailConfigKeys(), [
      "RESEND_API_KEY",
      "MAIL_FROM",
      "APP_URL",
    ]);
  } finally {
    restore();
  }
});
