const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const dmPath = path.join(__dirname, "../src/lib/discord/discord-dm.js");
const noticePath = path.join(__dirname, "../src/modules/teams/invite-discord-notice.js");
const envPath = path.join(__dirname, "../src/config/env.js");
const loggerPath = path.join(__dirname, "../src/lib/logger.js");
const prismaPath = path.join(__dirname, "../src/lib/prisma.js");

const silentLogger = { logger: { info() {}, warn() {}, error() {} } };

const loadDm = ({ token = "bot-token", responses = [] } = {}) => {
  const calls = [];
  const queue = [...responses];
  const originalFetch = global.fetch;
  global.fetch = async (url, options) => {
    calls.push({ url, options });
    return queue.shift() ?? { ok: true, status: 200, json: async () => ({ id: "dm-1" }) };
  };
  const loaded = loadModuleWithMocks(dmPath, {
    [envPath]: { env: { DISCORD_BOT_TOKEN: token } },
    [loggerPath]: silentLogger,
  });
  return {
    ...loaded,
    calls,
    restore: () => {
      global.fetch = originalFetch;
      loaded.restore();
    },
  };
};

test("a DM needs no gateway connection, just two REST calls", async () => {
  const { module: dm, calls, restore } = loadDm();
  try {
    const result = await dm.sendDirectMessage({ discordUserId: "123", content: "hello" });
    assert.equal(result.delivered, true);
    assert.equal(calls.length, 2);
    // Open the DM channel, then post to it.
    assert.match(calls[0].url, /\/users\/@me\/channels$/);
    assert.deepEqual(JSON.parse(calls[0].options.body), { recipient_id: "123" });
    assert.match(calls[1].url, /\/channels\/dm-1\/messages$/);
    assert.equal(JSON.parse(calls[1].options.body).content, "hello");
    assert.match(calls[0].options.headers.Authorization, /^Bot /);
  } finally {
    restore();
  }
});

test("no bot token means no attempt, not an error", async () => {
  const { module: dm, calls, restore } = loadDm({ token: "" });
  try {
    const result = await dm.sendDirectMessage({ discordUserId: "123", content: "hi" });
    assert.equal(result.delivered, false);
    assert.equal(result.reason, dm.UNDELIVERABLE.NOT_CONFIGURED);
    // Leaving the token unset must change nothing about invitations.
    assert.equal(calls.length, 0);
  } finally {
    restore();
  }
});

test("a recipient the bot may not message is an ordinary outcome", async (t) => {
  const cases = [
    // Discord answers 403 when they share no server with the bot, or the user
    // blocks DMs from server members. Both are normal and common.
    [403, "recipient_does_not_share_a_server_or_blocks_dms"],
    [429, "discord_rate_limited"],
    [500, "discord_request_failed"],
  ];
  for (const [status, reason] of cases) {
    await t.test(`HTTP ${status}`, async () => {
      const { module: dm, restore } = loadDm({
        responses: [{ ok: false, status, json: async () => ({}) }],
      });
      try {
        const result = await dm.sendDirectMessage({ discordUserId: "123", content: "hi" });
        assert.equal(result.delivered, false);
        assert.equal(result.reason, reason);
      } finally {
        restore();
      }
    });
  }
});

test("a transport failure resolves rather than throwing", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => {
    throw new Error("socket hang up");
  };
  const { module: dm, restore } = loadModuleWithMocks(dmPath, {
    [envPath]: { env: { DISCORD_BOT_TOKEN: "bot-token" } },
    [loggerPath]: silentLogger,
  });
  try {
    // An invitation must never fail because a DM did.
    const result = await dm.sendDirectMessage({ discordUserId: "123", content: "hi" });
    assert.equal(result.delivered, false);
    assert.equal(result.reason, "discord_request_failed");
  } finally {
    global.fetch = originalFetch;
    restore();
  }
});

const loadNotice = ({ oauthAccount = null, userWithDiscord = null, sendResult } = {}) => {
  const sends = [];
  return {
    sends,
    ...loadModuleWithMocks(noticePath, {
      [prismaPath]: {
        prisma: {
          oAuthAccount: { findFirst: async () => oauthAccount },
          user: { findFirst: async () => userWithDiscord },
        },
      },
      [envPath]: { env: { APP_URL: "https://questesports.lk" } },
      [loggerPath]: silentLogger,
      [dmPath]: {
        sendDirectMessage: async (args) => {
          sends.push(args);
          return sendResult ?? { delivered: true, reason: null };
        },
        UNDELIVERABLE: {
          NO_DISCORD_ACCOUNT: "recipient_has_no_linked_discord",
          FAILED: "discord_request_failed",
        },
      },
    }),
  };
};

const invite = {
  recipientName: "Player One",
  teamName: "Example Team",
  captainName: "Russel",
  tournamentTitle: "Quest Ascension",
};

test("Discord identity comes from the OAuth link, not the display tag", async () => {
  const { module: notice, sends, restore } = loadNotice({
    oauthAccount: { providerUserId: "discord-999" },
  });
  try {
    const result = await notice.notifyInviteOnDiscord({ userId: "user-1", ...invite });
    assert.equal(result.delivered, true);
    assert.equal(sends[0].discordUserId, "discord-999");
  } finally {
    restore();
  }
});

test("an email match only counts when the address is verified", async () => {
  const { module: notice, restore } = loadNotice({ userWithDiscord: null });
  try {
    // The query filters on emailVerified; an unverified signup must not be able
    // to redirect someone else's invitation notice.
    const source = fs.readFileSync(noticePath, "utf8");
    assert.match(source, /emailVerified: true/);
    const result = await notice.notifyInviteOnDiscord({
      emailNormalized: "player@example.com",
      ...invite,
    });
    assert.equal(result.delivered, false);
  } finally {
    restore();
  }
});

test("a recipient with no Discord is skipped quietly", async () => {
  const { module: notice, sends, restore } = loadNotice({ oauthAccount: null });
  try {
    const result = await notice.notifyInviteOnDiscord({ userId: "user-1", ...invite });
    assert.equal(result.delivered, false);
    assert.equal(result.reason, "recipient_has_no_linked_discord");
    assert.equal(sends.length, 0);
  } finally {
    restore();
  }
});

test("the message carries no invite token and does not promise an email", async () => {
  const { module: notice, restore } = loadNotice();
  try {
    const message = notice.buildInviteMessage(invite);
    assert.match(message, /Example Team/);
    assert.match(message, /Russel/);
    assert.match(message, /Quest Ascension/);
    // A token in a DM is a credential sitting in a chat log. The recipient is
    // already signed in to Quest to see the invitation.
    assert.doesNotMatch(message, /token/i);
    // One link for everybody, naming no invitation. A link that named one told
    // readers it was not for their account whenever a roster edit replaced the
    // row it pointed at.
    assert.match(message, /questesports\.lk\/profile\?tab=invitations$/m);
    assert.doesNotMatch(message, /member=/);
    // There is no invitation email any more, so the DM must not say there is
    // one on its way — that was the line that made a missing DM look survivable
    // for a reason that had stopped being true.
    assert.doesNotMatch(message, /by email/i);
  } finally {
    restore();
  }
});
