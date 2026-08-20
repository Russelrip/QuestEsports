const test = require("node:test");
const assert = require("node:assert/strict");

const {
  resolveEffectiveTeamLogoName,
  getTeamLogoUrl,
} = require("../src/modules/teams/team-logo");

test("resolves the linked saved team's current logo", () => {
  assert.equal(
    resolveEffectiveTeamLogoName({
      teamLogoName: "stale.png",
      savedTeam: { logoName: "current.png" },
    }),
    "current.png",
  );
});

test("does not fall back to the historical logo when the saved team has none", () => {
  assert.equal(
    resolveEffectiveTeamLogoName({
      teamLogoName: "stale.png",
      savedTeam: { logoName: null },
    }),
    null,
  );
});

test("resolves the historical logo without a linked saved team", () => {
  assert.equal(
    resolveEffectiveTeamLogoName({
      teamLogoName: "historical.png",
      savedTeam: null,
    }),
    "historical.png",
  );
});

test("returns no URL when there is no logo filename", () => {
  assert.equal(getTeamLogoUrl(null), null);
});

test("builds the local team-logo upload URL", () => {
  assert.equal(
    getTeamLogoUrl("current.png"),
    "/api/uploads/team-logos/current.png",
  );
});
