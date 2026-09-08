const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const modulePath = path.join(__dirname, "../src/lib/mail/sendMail.js");
const envPath = path.join(__dirname, "../src/config/env.js");
const loggerPath = path.join(__dirname, "../src/lib/logger.js");
const transporterPath = path.join(__dirname, "../src/lib/mail/transporter.js");

const load = ({ configured = true, appUrl = "https://questesports.lk" } = {}) => {
  const sent = [];
  const warnings = [];
  const loaded = loadModuleWithMocks(modulePath, {
    [envPath]: { env: { APP_URL: appUrl, MAIL_FROM: "Quest <no-reply@questesports.lk>" } },
    [loggerPath]: {
      logger: {
        info() {},
        error() {},
        warn: (message, meta) => warnings.push({ message, meta }),
      },
    },
    [transporterPath]: {
      isMailConfigured: () => configured,
      getMailTransporter: () => ({
        sendMail: async (payload) => {
          sent.push(payload);
          return { accepted: [payload.to] };
        },
      }),
    },
  });
  return { ...loaded, sent, warnings };
};

const template = () => ({ html: "<p>Hello</p>", text: "Hello" });

test("buildActionUrl attaches the token to the configured app origin", () => {
  const { module: mail, restore } = load();
  try {
    const url = mail.buildActionUrl("/verify-email", "abc123");
    assert.equal(url, "https://questesports.lk/verify-email?token=abc123");
  } finally {
    restore();
  }
});

test("buildActionUrl encodes a token that would otherwise break the query string", () => {
  const { module: mail, restore } = load();
  try {
    // A raw `&` or `=` in a token would silently create extra query parameters
    // and the link would arrive with a truncated token.
    const url = mail.buildActionUrl("/reset-password", "a&b=c d/e+f");
    assert.ok(url.startsWith("https://questesports.lk/reset-password?token="));
    assert.equal(new URL(url).searchParams.get("token"), "a&b=c d/e+f");
  } finally {
    restore();
  }
});

test("buildActionUrl carries a destination back to where the errand started", () => {
  const { module: mail, restore } = load();
  try {
    const url = mail.buildActionUrl(
      "/verify-email",
      "abc123",
      "/profile?tab=invitations&member=member-7"
    );
    const parsed = new URL(url);
    assert.equal(parsed.searchParams.get("token"), "abc123");
    // Somebody who signed up in order to accept a team invitation cannot answer
    // it until this address is verified, and by the time they come back the
    // link that sent them here is two redirects behind them.
    assert.equal(
      parsed.searchParams.get("redirect"),
      "/profile?tab=invitations&member=member-7"
    );
  } finally {
    restore();
  }
});

test("buildActionUrl refuses to send anybody off this site", () => {
  const { module: mail, restore } = load();
  try {
    // The destination decides where a page sends somebody. An email is the one
    // place a hostile value would arrive already looking legitimate, so
    // anything but a path here is dropped rather than corrected.
    for (const hostile of [
      "https://evil.example.com/steal",
      "//evil.example.com",
      "/profile%2f..%2fadmin",
      "\evil.example.com",
      "javascript:alert(1)",
    ]) {
      const parsed = new URL(mail.buildActionUrl("/verify-email", "abc123", hostile));
      assert.equal(parsed.origin, "https://questesports.lk");
      assert.equal(parsed.searchParams.get("redirect"), null);
    }
  } finally {
    restore();
  }
});

test("nothing is sent when mail is not configured, and the caller is told", async () => {
  const { module: mail, sent, warnings, restore } = load({ configured: false });
  try {
    const delivered = await mail.sendMail({
      email: "player@example.com",
      subject: "Verify your email",
      skippedLogMessage: "Verification email skipped: mail is not configured",
      templateBuilder: template,
    });
    // false, not a throw: an unconfigured mailer must not fail a signup, but
    // the caller has to be able to tell the mail did not go out.
    assert.equal(delivered, false);
    assert.equal(sent.length, 0);
    assert.equal(warnings.length, 1);
    assert.equal(warnings[0].meta.email, "player@example.com");
  } finally {
    restore();
  }
});

test("the template is not even built when mail is not configured", async () => {
  const { module: mail, restore } = load({ configured: false });
  let built = 0;
  try {
    await mail.sendMail({
      email: "player@example.com",
      subject: "Verify your email",
      skippedLogMessage: "skipped",
      templateBuilder: () => { built += 1; return template(); },
    });
    // Rendering a template can be expensive and can throw on partial data;
    // neither should happen for mail that will not be sent.
    assert.equal(built, 0);
  } finally {
    restore();
  }
});

test("a configured mailer sends the rendered template from the configured sender", async () => {
  const { module: mail, sent, restore } = load();
  try {
    const delivered = await mail.sendMail({
      email: "player@example.com",
      subject: "Your tickets",
      skippedLogMessage: "skipped",
      templateBuilder: template,
    });
    assert.equal(delivered, true);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, "player@example.com");
    assert.equal(sent[0].from, "Quest <no-reply@questesports.lk>");
    assert.equal(sent[0].subject, "Your tickets");
    assert.equal(sent[0].html, "<p>Hello</p>");
    // Both parts, so the mail is readable in a client that refuses HTML.
    assert.equal(sent[0].text, "Hello");
  } finally {
    restore();
  }
});

test("a delivery id becomes a Message-ID stripped of everything but safe characters", async () => {
  const { module: mail, sent, restore } = load();
  try {
    // The delivery id reaches this from a job payload. Anything that survives
    // into a header could inject a second header or a bogus address, so the
    // sanitiser is the guard and this pins it.
    await mail.sendMail({
      deliveryId: "job/42 <bad>@evil.com\r\nBcc: attacker@example.com",
      email: "player@example.com",
      subject: "Your tickets",
      skippedLogMessage: "skipped",
      templateBuilder: template,
    });
    assert.equal(sent[0].messageId, "<quest-job-job42badevilcomBccattackerexamplecom@questesports.lk>");
    assert.ok(!/[\r\n<>@]/.test(sent[0].messageId.slice(1, -"@questesports.lk>".length)));
  } finally {
    restore();
  }
});

test("a plain delivery id keeps its hyphens and alphanumerics", async () => {
  const { module: mail, sent, restore } = load();
  try {
    await mail.sendMail({
      deliveryId: "a1b2-c3d4",
      email: "player@example.com",
      subject: "Your tickets",
      skippedLogMessage: "skipped",
      templateBuilder: template,
    });
    assert.equal(sent[0].messageId, "<quest-job-a1b2-c3d4@questesports.lk>");
  } finally {
    restore();
  }
});

test("no delivery id means no Message-ID header rather than an empty one", async () => {
  const { module: mail, sent, restore } = load();
  try {
    await mail.sendMail({
      email: "player@example.com",
      subject: "Your tickets",
      skippedLogMessage: "skipped",
      templateBuilder: template,
    });
    // An empty or malformed Message-ID is worse than none: some servers treat
    // it as a spam signal.
    assert.equal("messageId" in sent[0], false);
  } finally {
    restore();
  }
});
