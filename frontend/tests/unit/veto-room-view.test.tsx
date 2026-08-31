import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import VetoRoomView from "../../components/veto/VetoRoomView";

const mocks = vi.hoisted(() => ({ request: vi.fn() }));

vi.mock("@/lib/veto", async () => {
  const actual = await vi.importActual<typeof import("@/lib/veto")>("@/lib/veto");
  return { ...actual, vetoRequest: mocks.request, readVetoToken: () => "", vetoTokenHeaders: () => ({}) };
});
vi.mock("@/lib/realtime", () => ({ subscribeToRealtimeUpdates: () => () => undefined }));
vi.mock("next/image", () => ({ default: (props: React.ImgHTMLAttributes<HTMLImageElement>) => <img {...props} /> }));

const makeRoom = (kind: "caster" | "team") => ({
  id: "room-1", code: "ASCENT", title: "Alpha vs Bravo", format: "bo3" as const, status: "in_progress" as const,
  revision: 4, controlMode: "link_only" as const, teamOrderMethod: "toss" as const,
  toss: { method: "digital" as const, callerSlot: 1 as const, call: "heads" as const, result: "heads" as const, winnerSlot: 1 as const, teamASlot: 1 as const },
  timer: { seconds: 60, deadline: null }, viewerEnabled: true, publishResult: true, tournament: null, match: null,
  participants: [
    { id: "a", slot: 1 as const, displayName: "Alpha", accentColor: "#22d3ee", ready: true, joined: true, team: "A" as const, logoUrl: null },
    { id: "b", slot: 2 as const, displayName: "Bravo", accentColor: "#fb7185", ready: true, joined: true, team: "B" as const, logoUrl: null },
  ],
  maps: [{ slug: "ascent", name: "Ascent", accentColor: "#22d3ee", artworkUrl: null }],
  steps: [{ kind: "ban" as const, actor: "A" as const, seriesIndex: null }], currentStep: 0,
  currentAction: { kind: "ban" as const, actor: "A" as const, seriesIndex: null }, actions: [],
  access: { kind, slot: kind === "team" ? 1 as const : null },
  timestamps: { openedAt: null, startedAt: null, completedAt: null, cancelledAt: null, updatedAt: "now" },
});

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("caster veto presentation", () => {
  it("renders a read-only live broadcast", async () => {
    mocks.request.mockResolvedValue(makeRoom("caster"));
    render(<VetoRoomView code="ASCENT" />);
    expect(await screen.findByText(/live broadcast/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /ready up|heads|tails|attack|defense/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /ascent/i })).toBeDisabled();
  });

  it("keeps the active map enabled for the authorized team", async () => {
    mocks.request.mockResolvedValue(makeRoom("team"));
    render(<VetoRoomView code="ASCENT" />);
    expect(await screen.findByRole("button", { name: /ascent/i })).toBeEnabled();
  });
});
