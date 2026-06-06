const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const definitionsPath = path.join(
  __dirname,
  "../src/lib/mail/mail-job-definitions.js"
);
const templatesPath = path.join(__dirname, "../src/lib/mail/templates.js");
const sendMailPath = path.join(__dirname, "../src/lib/mail/sendMail.js");
const secretBoxPath = path.join(__dirname, "../src/lib/secret-box.js");

test("queued mail decrypts protected tokens only while building the email", async () => {
  const actionUrlCalls = [];
  const { module: definitions, restore } = loadModuleWithMocks(definitionsPath, {
    [templatesPath]: {
      buildVerificationEmail: (values) => values,
    },
    [sendMailPath]: {
      buildActionUrl: (pathname, token) => {
        actionUrlCalls.push({ pathname, token });
        return `https://app.example.com${pathname}?token=${token}`;
      },
      sendMail: async ({ templateBuilder }) => templateBuilder(),
    },
    [secretBoxPath]: {
      decryptSecret: (ciphertext) => {
        assert.equal(ciphertext, "encrypted-token");
        return "raw-verification-token";
      },
    },
  });

  try {
    await definitions.processQueuedMailJob({
      type: definitions.EMAIL_TEMPLATE_TYPES.verification,
      email: "player@example.com",
      firstName: "Quest",
      tokenCiphertext: "encrypted-token",
    });

    assert.deepEqual(actionUrlCalls, [
      {
        pathname: "/verify-email",
        token: "raw-verification-token",
      },
    ]);
  } finally {
    restore();
  }
});
