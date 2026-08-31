import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AdminMatchRoomsManager from "../../components/admin/AdminMatchRoomsManager";
import { buildVetoShareUrl } from "../../lib/veto";

const roomRequest = vi.hoisted(() => vi.fn());
vi.mock("@/lib/match-rooms", () => ({ roomRequest }));
vi.mock("@/components/admin/AdminShell", () => ({ default: ({ children }: React.PropsWithChildren) => <main>{children}</main> }));
vi.mock("next/link", () => ({ default: ({ children, ...props }: React.ComponentProps<"a">) => <a {...props}>{children}</a> }));

afterEach(() => cleanup());
beforeEach(() => {
  vi.clearAllMocks();
  roomRequest.mockResolvedValue([{
    id: "room-1", code: "ROOM1", chatLocked: false, messageCount: 0, openSupportCount: 0,
    match: {
      id: "match-1", identifier: "M1", status: "scheduled", scheduledAt: null,
      tournament: { id: "tournament-1", title: "Valorant Cup", game: "valorant" },
      participants: [{ slot: 1, displayName: "Alpha" }, { slot: 2, displayName: "Bravo" }], veto: null,
    },
  }]);
});

describe("admin veto launch navigation", () => {
  it("links an unlinked match to the prefilled veto wizard", async () => {
    render(<AdminMatchRoomsManager />);
    expect(await screen.findByRole("link", { name: /start map veto/i })).toHaveAttribute(
      "href", "/admin/veto-rooms?matchId=match-1&tournamentId=tournament-1",
    );
  });

  it("does not offer veto launch for an ineligible match", async () => {
    roomRequest.mockResolvedValueOnce([{
      id: "room-2", code: "ROOM2", chatLocked: false, messageCount: 0, openSupportCount: 0,
      match: {
        id: "match-2", identifier: "M2", status: "scheduled", scheduledAt: null,
        tournament: { id: "tournament-2", title: "Rocket League Cup", game: "rocket-league" },
        participants: [{ slot: 1, displayName: "Alpha" }, { slot: 2, displayName: "Bravo" }], veto: null,
      },
    }]);
    render(<AdminMatchRoomsManager />);
    expect(await screen.findByText(/map veto unavailable/i)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /start map veto/i })).not.toBeInTheDocument();
  });

  it("encodes private caster share URLs", () => {
    expect(buildVetoShareUrl("https://admin.example", "room code", "caster/token")).toBe(
      "https://admin.example/veto/room%20code#access=caster%2Ftoken",
    );
  });
});
