import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("tournament participant pagination contract", () => {
  it("requests the bounded first participant page", () => {
    const source = readFileSync(resolve(process.cwd(), "lib/tournaments.ts"), "utf8");
    expect(source).toContain('params.set("participantPage", String(page));');
    expect(source).toContain('params.set("participantPageSize", String(pageSize));');
  });

  it("keeps old-backend local pagination as a fallback", () => {
    const source = readFileSync(
      resolve(process.cwd(), "components/tournaments/TournamentDetailsContent.tsx"),
      "utf8",
    );
    expect(source).toContain("participantPagination");
    expect(source).toContain("fetchPublicTournamentBySlug");
    expect(source).toContain("participants.slice");
  });

  it("does not advance or overwrite participant state from failed or stale requests", () => {
    const source = readFileSync(
      resolve(process.cwd(), "components/tournaments/TournamentDetailsContent.tsx"),
      "utf8",
    );
    expect(source).toContain("useRef");
    expect(source).toContain("participantRequestId.current");
    expect(source).toContain("requestId !== participantRequestId.current");
  });
});
