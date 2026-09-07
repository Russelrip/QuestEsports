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

test("no auth flow reads a Discord tag off the request body", () => {
  // Disabling the input is cosmetic: the client can post whatever it likes, so
  // the server has to be the authority. Neither signup nor a profile edit reads
  // `body.discordTag` any more — there is no branch left that accepts a client
  // value, verified or otherwise.
  assert.doesNotMatch(authSource, /body\.discordTag/);
});

test("the profile update does not write the tag at all", () => {
  // An account starts with no handle and earns one by completing the OAuth
  // link, which is the only writer. A profile edit that touched the column
  // would put an unverified string in the field match communication now trusts.
  const updateBlock = /const user = await prisma\.user\.update\(\{[\s\S]*?\}\);/.exec(authSource)[0];
  assert.doesNotMatch(updateBlock, /discordTag/);
});

test("signup creates the user without a tag", () => {
  const createBlock = /const createdUser = await tx\.user\.create\(\{[\s\S]*?\}\);/.exec(authSource)[0];
  assert.doesNotMatch(createBlock, /discordTag/);
});
