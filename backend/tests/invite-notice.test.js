const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const servicePath = path.join(__dirname, "../src/modules/teams/invite-notice.service.js");
const prismaPath = path.join(__dirname, "../src/lib/prisma.js");
const envPath = path.join(__dirname, "../src/config/env.js");
const loggerPath = path.join(__dirname, "../src/lib/logger.js");
const notificationPath = path.join(__dirname, "../src/modules/notifications/notification.service.js");
const discordNoticePath = path.join(__dirname, "../src/modules/teams/invite-discord-notice.js");

// The invitation is a row before any of this runs. Everything here only points
// at it, so every channel is allowed to fail and none of them may throw: a
// notice that reaches nobody must cost a nudge, never a roster spot.

const dispatch = (overrides = {}) => ({
  invitationId: "invite-1",
  emailNormalized: "player@example.com",
  recipientName: "Player Two",
  teamName: "Quest Five",
  captainName: "Quest Captain",
  tournamentTitle: "Quest Cup",
  sentAt: new Date("2026-09-08T10:00:00.000Z"),
  ...overrides,
});

const loadService = ({
  userById = null,
  userByEmail = null,
  notificationImpl,
  discordImpl,
} = {}) => {
  const state = { notifications: [], discordCalls: [], warnings: [] };

  const loaded = loadModuleWithMocks(servicePath, {
    [prismaPath]: {
      prisma: {
        user: {
          findUnique: async () => userById,
          findFirst: async (args) => {
            // Only a verified address may claim an invitation, or signing up
            // with somebody else's address would hand over their invitations.
            assert.equal(args.where.emailVerified, true);
            return userByEmail;
          },
        },
      },
    },
    [envPath]: { env: { APP_URL: "https://quest.test" } },
    [loggerPath]: {
      logger: {
        info: () => {},
        warn: (message) => state.warnings.push(message),
        error: () => {},
      },
    },
    [notificationPath]: {
      createNotification: async (payload) => {
        state.notifications.push(payload);
        if (notificationImpl) return notificationImpl(payload);
        return { id: "notification-1" };
      },
    },
    [discordNoticePath]: {
      notifyInviteOnDiscord: async (payload) => {
        state.discordCalls.push(payload);
        if (discordImpl) return discordImpl(payload);
        return { delivered: true };
      },
      UNDELIVERABLE: { NO_DISCORD_ACCOUNT: "NO_DISCORD_ACCOUNT", FAILED: "FAILED" },
    },
  });

  return { ...loaded, state };
};

test("an invitee with a Quest account is notified in the app and on Discord", async () => {
  const { module: service, restore, state } = loadService({
    userByEmail: { id: "user-9" },
  });

  try {
    const result = await service.notifyInvite(dispatch());

    assert.equal(result.hasQuestAccount, true);
    assert.equal(result.inApp, true);
    assert.equal(result.discord, true);
    const [notification] = state.notifications;
    assert.deepEqual(notification.userIds, ["user-9"]);
    // Pointed at the invitation rather than at the tab, so somebody with
    // several waiting is not left to work out which one this was about.
    assert.equal(notification.actionUrl, "/profile?tab=invitations&member=invite-1");
    assert.match(notification.body, /Quest Captain/);
    assert.match(notification.body, /Quest Cup/);
  } finally {
    restore();
  }
});

test("an invitee with no Quest account is reported as unreachable, not as sent", async () => {
  const { module: service, restore, state } = loadService({});

  try {
    const result = await service.notifyInvite(dispatch());

    // The captain has to be told this, because they are the only remaining
    // channel: they are teammates and already have a way to talk.
    assert.equal(result.hasQuestAccount, false);
    assert.equal(result.inApp, false);
    assert.deepEqual(state.notifications, []);
    // The link the captain is told to send starts at onboarding, because the
    // person who needs it is the person with no account to sign in to yet.
    assert.equal(result.invitationUrl, "https://quest.test/team-invite?member=invite-1");
  } finally {
    restore();
  }
});

test("a Discord DM that cannot be delivered does not stop the in-app notice", async () => {
  const { module: service, restore } = loadService({
    userByEmail: { id: "user-9" },
    discordImpl: async () => ({ delivered: false, reason: "NO_DISCORD_ACCOUNT" }),
  });

  try {
    const result = await service.notifyInvite(dispatch());

    assert.equal(result.inApp, true);
    assert.equal(result.discord, false);
    assert.equal(result.discordReason, "NO_DISCORD_ACCOUNT");
  } finally {
    restore();
  }
});

test("a failing in-app notification still lets the Discord DM through", async () => {
  const { module: service, restore, state } = loadService({
    userByEmail: { id: "user-9" },
    notificationImpl: () => { throw new Error("notifications are down"); },
  });

  try {
    const result = await service.notifyInvite(dispatch());

    assert.equal(result.inApp, false);
    assert.equal(result.discord, true);
    assert.equal(state.warnings.length, 1);
  } finally {
    restore();
  }
});

test("a nudge produces a new notification rather than colliding with the first", async () => {
  const { module: service, restore, state } = loadService({
    userByEmail: { id: "user-9" },
  });

  try {
    await service.notifyInvite(dispatch());
    await service.notifyInvite(dispatch({ sentAt: new Date("2026-09-09T10:00:00.000Z") }));

    const [first, second] = state.notifications;
    assert.notEqual(first.eventKey, second.eventKey);
    assert.match(first.eventKey, /^team-invite:invite-1:/);
  } finally {
    restore();
  }
});

test("one failure in a batch does not take the rest of the roster down with it", async () => {
  let calls = 0;
  const { module: service, restore } = loadService({
    userByEmail: { id: "user-9" },
    discordImpl: async () => {
      calls += 1;
      if (calls === 1) throw new Error("discord is down");
      return { delivered: true };
    },
  });

  try {
    const results = await service.notifyInvites([
      dispatch({ invitationId: "invite-1" }),
      dispatch({ invitationId: "invite-2" }),
    ]);

    assert.equal(results.length, 2);
    // notifyInviteOnDiscord swallows its own failures in production; this
    // covers the batch surviving one that escapes anyway.
    assert.equal(results[1].discord, true);
  } finally {
    restore();
  }
});

test("an empty roster is not a dispatch", async () => {
  const { module: service, restore, state } = loadService({});

  try {
    assert.deepEqual(await service.notifyInvites([]), []);
    assert.deepEqual(await service.notifyInvites(), []);
    assert.deepEqual(state.discordCalls, []);
  } finally {
    restore();
  }
});
