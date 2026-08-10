const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const templatesPath = path.join(__dirname, "../src/lib/mail/templates.js");
const envPath = path.join(__dirname, "../src/config/env.js");

test("email templates show the Quest avatar from the public app", () => {
  const { module: templates, restore } = loadModuleWithMocks(templatesPath, {
    [envPath]: { env: { APP_URL: "https://quest.example.com" } },
  });

  try {
    const email = templates.buildVerificationEmail({
      firstName: "Player",
      verificationUrl: "https://quest.example.com/verify-email?token=test",
    });

    assert.match(email.html, /src="https:\/\/quest\.example\.com\/icon-192\.png"/);
    assert.match(email.html, /alt="Quest E-sports"/);
    assert.match(email.html, /border-radius:50%/);
  } finally {
    restore();
  }
});
