import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("Challonge frontend boundary", () => {
  it("uses the public module without a frontend Challonge API credential", () => {
    const component = readFileSync(resolve(process.cwd(), "components/tournaments/TournamentDetailsContent.tsx"), "utf8");
    const frontendEnv = readFileSync(resolve(process.cwd(), ".env.example"), "utf8");
    expect(component).toMatch(/<iframe/i);
    expect(component).toContain("challongeEmbedUrl");
    expect(component).toContain('loading="eager"');
    expect(component).toContain('aria-hidden={activeTab !== "bracket"}');
    expect(component).toContain("setLoadedChallongeUrl");
    expect(component).not.toContain('activeTab === "bracket" && tournament.challongeEmbedUrl');
    expect(component).not.toContain("fetchPublicTournamentBracket");
    expect(component).not.toContain("EventSource");
    expect(component).not.toContain("api.challonge.com");
    expect(component).not.toContain("Bracket unavailable");
    expect(component).not.toContain("setTimeout");
    expect(frontendEnv).not.toContain("CHALLONGE_API_KEY");
    expect(frontendEnv).not.toContain("CHALLONGE_USERNAME");
    expect(frontendEnv).not.toContain("CHALLONGE_CLIENT_SECRET");
    expect(frontendEnv).not.toContain("CHALLONGE_CLIENT_ID");
  });

  it("keeps Challonge admin controls contained on mobile", () => {
    const panel = readFileSync(resolve(process.cwd(), "components/admin/ChallongeAdminPanel.tsx"), "utf8");
    const select = readFileSync(resolve(process.cwd(), "components/ui/select.tsx"), "utf8");

    expect(panel).toContain("min-w-0 overflow-hidden p-4 sm:p-8");
    expect(panel).toContain("[&>*]:w-full sm:[&>*]:w-auto");
    expect(panel).toContain("[&>*]:min-w-0");
    expect(select).toContain("w-full min-w-0 max-w-full");
  });

  it("ships deliberate, quota-labelled tournament-admin write controls", () => {
    const panel = readFileSync(resolve(process.cwd(), "components/admin/ChallongeAdminPanel.tsx"), "utf8");
    for (const label of ["Numeric tournament ID or public URL", "Load Current Data (3–4 Requests)", "Add Participant", "Apply State Action", "Report Result", "Last editor load", "Last error"]) {
      expect(panel).toContain(label);
    }
    expect(panel).not.toContain("Enable automatic synchronization");
  });
});
