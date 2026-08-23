const { env } = require("../../config/env");
const { logger } = require("../logger");

// Sending a Discord DM needs no gateway connection and no discord.js: it is two
// REST calls with a bot token. Open a DM channel with the recipient, then post
// to it. That keeps this a thin outbound integration rather than a long-lived
// bot process Quest has to supervise.
//
// Everything here is BEST EFFORT. A DM that cannot be delivered must never cost
// anyone their roster spot, so every failure resolves to a reason rather than
// throwing. Email remains the guaranteed channel and is unchanged.
const DISCORD_API = "https://discord.com/api/v10";
const TIMEOUT_MS = 8000;

// Reasons a DM legitimately cannot arrive. None are faults to alert on:
// Discord simply does not let a bot message everyone.
const UNDELIVERABLE = {
  NOT_CONFIGURED: "discord_bot_not_configured",
  NO_DISCORD_ACCOUNT: "recipient_has_no_linked_discord",
  CANNOT_DM: "recipient_does_not_share_a_server_or_blocks_dms",
  RATE_LIMITED: "discord_rate_limited",
  FAILED: "discord_request_failed",
};

const isConfigured = () => Boolean(env.DISCORD_BOT_TOKEN);

const discordFetch = async (path, options = {}) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(`${DISCORD_API}${path}`, {
      ...options,
      headers: {
        Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
        "Content-Type": "application/json",
        ...options.headers,
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
};

// Discord returns 403 when the bot may not message someone — they share no
// server with it, or they block DMs from server members. Both are ordinary and
// common, and neither is worth an error log.
const classifyFailure = (status) => {
  if (status === 403) return UNDELIVERABLE.CANNOT_DM;
  if (status === 429) return UNDELIVERABLE.RATE_LIMITED;
  return UNDELIVERABLE.FAILED;
};

const sendDirectMessage = async ({ discordUserId, content }) => {
  if (!isConfigured()) {
    return { delivered: false, reason: UNDELIVERABLE.NOT_CONFIGURED };
  }
  if (!discordUserId) {
    return { delivered: false, reason: UNDELIVERABLE.NO_DISCORD_ACCOUNT };
  }

  try {
    const channelResponse = await discordFetch("/users/@me/channels", {
      method: "POST",
      body: JSON.stringify({ recipient_id: String(discordUserId) }),
    });

    if (!channelResponse.ok) {
      const reason = classifyFailure(channelResponse.status);
      logger.info("Discord DM channel could not be opened.", { reason });
      return { delivered: false, reason };
    }

    const channel = await channelResponse.json();
    if (!channel?.id) {
      return { delivered: false, reason: UNDELIVERABLE.FAILED };
    }

    const messageResponse = await discordFetch(`/channels/${channel.id}/messages`, {
      method: "POST",
      body: JSON.stringify({ content }),
    });

    if (!messageResponse.ok) {
      const reason = classifyFailure(messageResponse.status);
      logger.info("Discord DM could not be delivered.", { reason });
      return { delivered: false, reason };
    }

    return { delivered: true, reason: null };
  } catch (error) {
    // Timeouts and transport failures included: the invitation still exists in
    // Quest and the email still went out, so this is information, not an error.
    logger.info("Discord DM attempt failed.", { name: error?.name || null });
    return { delivered: false, reason: UNDELIVERABLE.FAILED };
  }
};

module.exports = {
  sendDirectMessage,
  isConfigured,
  UNDELIVERABLE,
};
