const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const oauthSource = fs.readFileSync(
  path.join(__dirname, "../src/modules/auth/oauth.service.js"),
  "utf8",
);
const authSource = fs.readFileSync(
  path.join(__dirname, "../src/modules/auth/auth.service.js"),
  "utf8",
);

// The Discord tag used to be a free-text profile field: whatever the user typed
// was stored as their Discord identity, and linking Discord did not populate it
// at all. These assertions pin the corrected direction — the tag comes from the
// connection, and only from the connection.

test("linking Discord records the verified tag", () => {
  const linkCallback = /const handleOAuthLinkCallback[\s\S]*?\n};/.exec(oauthSource);
  assert.ok(linkCallback, "handleOAuthLinkCallback must exist");

  assert.match(
    linkCallback[0],
    /provider === "discord" && profile\.discordTag/,
    "linking must copy the tag from the verified provider profile",
  );
  assert.match(
    linkCallback[0],
    /discordTag: profile\.discordTag/,
    "the stored value must be the provider's, not the client's",
  );
});

test("the tag is written in the same transaction as the link", () => {
  const linkCallback = /const handleOAuthLinkCallback[\s\S]*?\n};/.exec(oauthSource)[0];
  // A link without its tag, or a tag without its link, leaves the profile
  // disagreeing with the connection it claims to come from.
  assert.match(linkCallback, /prisma\.\$transaction\(async \(tx\) => \{/);
  assert.match(linkCallback, /tx\.oAuthAccount\.create/);
  assert.match(linkCallback, /tx\.user\.update/);
});

test("unlinking Discord clears the tag", () => {
  const unlink = /const unlinkOAuthProvider[\s\S]*?\n};/.exec(oauthSource);
  assert.ok(unlink, "unlinkOAuthProvider must exist");
  // Keeping it would leave a handle that looks verified but no longer is.
  assert.match(unlink[0], /provider === "discord"/);
  assert.match(unlink[0], /discordTag: null/);
});

test("a profile edit cannot overwrite a linked Discord tag", () => {
  // Disabling the input is cosmetic: the client can post whatever it likes, so
  // the server has to be the authority.
  assert.match(
    authSource,
    /const linkedDiscord = await prisma\.oAuthAccount\.findFirst\(\{\s*where: \{ userId: requestedUserId, provider: "discord" \}/,
  );
  assert.match(
    authSource,
    /const nextDiscordTag = linkedDiscord \? existingUser\.discordTag : discordTag;/,
  );
  assert.match(authSource, /discordTag: nextDiscordTag,/);
  // And the raw client value must no longer reach the update directly.
  const updateBlock = /const user = await prisma\.user\.update\(\{[\s\S]*?\}\);/.exec(authSource)[0];
  assert.doesNotMatch(updateBlock, /^\s*discordTag,\s*$/m);
});

test("a user without a linked Discord can still set a tag manually", () => {
  // Legacy rosters and users who have not connected yet must not lose the
  // ability to record one; the value is simply not claimed to be verified.
  assert.match(
    authSource,
    /linkedDiscord \? existingUser\.discordTag : discordTag/,
    "the unlinked branch must fall back to the submitted value",
  );
});
