import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AdminMatchRoomsManager from "../../components/admin/AdminMatchRoomsManager";
import AdminVetoRoomsManager from "../../components/admin/AdminVetoRoomsManager";

const mocks = vi.hoisted(() => ({
  roomRequest: vi.fn(), vetoRequest: vi.fn(), adminRequest: vi.fn(),
  navigation: { query: "" },
}));

vi.mock("@/lib/match-rooms", () => ({ roomRequest: mocks.roomRequest }));
vi.mock("@/lib/veto", () => ({
  vetoRequest: mocks.vetoRequest,
  buildVetoShareUrl: (origin: string, code: string, token: string) => `${origin}/veto/${encodeURIComponent(code)}#access=${encodeURIComponent(token)}`,
}));
vi.mock("@/lib/admin", () => ({ adminRequest: mocks.adminRequest }));
vi.mock("@/lib/media", () => ({ resolveImageUrl: (value: unknown) => typeof value === "string" ? value : null }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(mocks.navigation.query) }));
vi.mock("next/link", () => ({ default: ({ children, ...props }: React.ComponentProps<"a">) => <a {...props}>{children}</a> }));
vi.mock("next/image", () => ({
  default: (props: React.ImgHTMLAttributes<HTMLImageElement>) => {
    // The real next/image component is mocked so the review can inspect rendered logo URLs.
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    return <img {...props} />;
  },
}));
vi.mock("@/components/admin/AdminShell", () => ({ default: ({ children }: React.PropsWithChildren) => <main>{children}</main> }));
vi.mock("@/components/veto/VetoRoomView", () => ({ default: () => <div>Live veto view</div> }));
vi.mock("@/components/ui/badge", () => ({ Badge: ({ children }: React.PropsWithChildren) => <span>{children}</span> }));
vi.mock("@/components/ui/card", () => ({ Card: ({ children }: React.PropsWithChildren) => <section>{children}</section> }));
vi.mock("@/components/ui/empty-state", () => ({ default: ({ description }: { description: string }) => <p>{description}</p> }));
vi.mock("@/components/ui/button", () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
  buttonClassName: () => "button",
}));
vi.mock("@/components/ui/input", () => ({ Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} /> }));
vi.mock("@/components/ui/select", () => ({ Select: (props: React.SelectHTMLAttributes<HTMLSelectElement>) => <select {...props} /> }));

const match = {
  id: "match-1", identifier: "M1", status: "scheduled", game: "valorant",
  participants: [{ displayName: "Alpha", logoUrl: "/api/uploads/alpha.png", seed: 1 }, { displayName: "Bravo", logoUrl: "/api/uploads/bravo.png", seed: 2 }],
};
const room = {
  id: "veto-1", code: "ROOM1", title: "Alpha vs Bravo", format: "bo3", status: "draft", revision: 1,
  controlMode: "captain_or_link", teamOrderMethod: "toss", toss: { method: "digital", callerSlot: 2, call: null, result: null, winnerSlot: null, teamASlot: null },
  timer: { seconds: 60, deadline: null }, viewerEnabled: false, publishResult: true, tournament: { id: "tournament-1", slug: "cup", title: "Valorant Cup", game: "valorant" }, match,
  participants: [], maps: [], steps: [], currentStep: 0, currentAction: null, actions: [], access: { kind: "staff", slot: null },
  timestamps: { openedAt: null, startedAt: null, completedAt: null, cancelledAt: null, updatedAt: "now" },
};
const catalog = { maps: [], pools: [{ id: "pool-1", name: "Default", version: 1, maps: [] }], presets: [{ id: "preset-1", name: "BO3", format: "bo3", version: 1, steps: [] }], templates: [] };

const continueWizard = async (user: ReturnType<typeof userEvent.setup>, count: number) => {
  for (let index = 0; index < count; index += 1) {
    await user.click(screen.getByRole("button", { name: "Continue" }));
  }
};

afterEach(() => cleanup());
beforeEach(() => {
  vi.clearAllMocks();
  mocks.navigation.query = "";
  mocks.roomRequest.mockResolvedValue([]);
  mocks.adminRequest.mockResolvedValue({ tournaments: [{ id: "tournament-1", title: "Valorant Cup", game: "valorant", status: "published" }] });
  mocks.vetoRequest.mockImplementation((path: string) => {
    if (path === "/api/v1/admin/veto-rooms") return Promise.resolve([]);
    if (path.includes("/matches")) return Promise.resolve([match]);
    if (path.includes("/catalog")) return Promise.resolve(catalog);
    return Promise.resolve({});
  });
});

describe("admin veto launch navigation", () => {
  it("links an unlinked match to the prefilled veto wizard", async () => {
    mocks.roomRequest.mockResolvedValue([{
      id: "room-1", code: "ROOM1", chatLocked: false, messageCount: 0, openSupportCount: 0,
      match: { id: "match-1", identifier: "M1", status: "scheduled", scheduledAt: null, tournament: { id: "tournament-1", title: "Valorant Cup", game: "valorant" }, participants: [{ slot: 1, displayName: "Alpha" }, { slot: 2, displayName: "Bravo" }], veto: null,
    }}]);
    render(<AdminMatchRoomsManager />);
    expect(await screen.findByRole("link", { name: /start map veto/i })).toHaveAttribute("href", "/admin/veto-rooms?matchId=match-1&tournamentId=tournament-1");
  });

  it("does not offer veto launch for an ineligible match", async () => {
    mocks.roomRequest.mockResolvedValue([{
      id: "room-2", code: "ROOM2", chatLocked: false, messageCount: 0, openSupportCount: 0,
      match: { id: "match-2", identifier: "M2", status: "scheduled", scheduledAt: null, tournament: { id: "tournament-2", title: "Rocket League Cup", game: "rocket-league" }, participants: [{ slot: 1, displayName: "Alpha" }, { slot: 2, displayName: "Bravo" }], veto: null,
    }}]);
    render(<AdminMatchRoomsManager />);
    expect(await screen.findByText(/map veto unavailable/i)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /start map veto/i })).not.toBeInTheDocument();
  });

  it("prefills a match and tournament query, hides manual teams, and reviews logos", async () => {
    mocks.navigation.query = "matchId=match-1&tournamentId=tournament-1";
    const user = userEvent.setup();
    render(<AdminVetoRoomsManager />);
    expect(await screen.findByRole("heading", { name: "Choose match format" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /custom rule sequence/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /premier/i })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /bo3best of 3/i }));
    await continueWizard(user, 3);
    expect(screen.getByRole("combobox", { name: "Tournament (optional)" })).toHaveValue("tournament-1");
    expect(screen.getByRole("combobox", { name: "Existing match (optional)" })).toHaveValue("match-1");
    expect(screen.queryByRole("textbox", { name: "Team 1" })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Team 2" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Continue" }));
    const review = screen.getByText("Match").parentElement!;
    expect(within(review).getByText("Alpha vs Bravo")).toBeInTheDocument();
    expect(within(review).getAllByRole("presentation").map((logo) => logo.getAttribute("src"))).toEqual([
      "/api/uploads/alpha.png",
      "/api/uploads/bravo.png",
    ]);
  });

  it("selects the room requested by roomId", async () => {
    mocks.navigation.query = "roomId=veto-1";
    mocks.vetoRequest.mockImplementation((path: string) => path === "/api/v1/admin/veto-rooms" ? Promise.resolve([room]) : path.includes("/catalog") ? Promise.resolve(catalog) : Promise.resolve({}));
    render(<AdminVetoRoomsManager />);
    expect(await screen.findByText("Alpha vs Bravo")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /open room/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open live room" })).toHaveAttribute("href", "/veto/ROOM1");
  });

  it("keeps a caster token isolated when the viewer token is absent", async () => {
    mocks.navigation.query = "roomId=veto-1";
    mocks.vetoRequest.mockImplementation((path: string) => {
      if (path === "/api/v1/admin/veto-rooms") return Promise.resolve([room]);
      if (path.includes("/catalog")) return Promise.resolve(catalog);
      if (path.endsWith("/rotate-link")) return Promise.resolve({ role: "caster", token: "caster-secret" });
      return Promise.resolve({});
    });
    render(<AdminVetoRoomsManager />);
    await screen.findByText("Alpha vs Bravo");
    const user = userEvent.setup();
    const caster = screen.getByText("Caster link").parentElement!;
    const viewer = screen.getByText("Viewer link").parentElement!;
    expect(within(viewer).queryByRole("link", { name: /^Open$/i })).not.toBeInTheDocument();
    await user.click(within(caster).getByRole("button", { name: "Rotate" }));
    expect(await within(caster).findByRole("link", { name: "Open" })).toHaveAttribute("href", "http://localhost:3000/veto/ROOM1#access=caster-secret");
    expect(within(viewer).queryByRole("link", { name: /^Open$/i })).not.toBeInTheDocument();
    expect(viewer).not.toHaveTextContent("caster-secret");
  });

  it("limits linked matches to BO1, BO3, and BO5", async () => {
    mocks.navigation.query = "matchId=match-1&tournamentId=tournament-1";
    render(<AdminVetoRoomsManager />);
    expect(await screen.findByRole("heading", { name: "Choose match format" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /bo1best of 1/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /bo3best of 3/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /bo5best of 5/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /custom rule sequence/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /premier/i })).not.toBeInTheDocument();
  });

  it("recovers a duplicate linked create without issuing credentials", async () => {
    mocks.navigation.query = "matchId=match-1&tournamentId=tournament-1";
    const user = userEvent.setup();
    let roomsResponse: typeof room[] = [];
    mocks.vetoRequest.mockImplementation((path: string, options?: { method?: string }) => {
      if (path === "/api/v1/admin/veto-rooms" && options?.method === "POST") return Promise.reject(Object.assign(new Error("already linked"), { status: 409 }));
      if (path === "/api/v1/admin/veto-rooms") return Promise.resolve(roomsResponse);
      if (path.includes("/matches")) return Promise.resolve([match]);
      if (path.includes("/catalog")) return Promise.resolve(catalog);
      return Promise.resolve({});
    });
    render(<AdminVetoRoomsManager />);
    await screen.findByRole("heading", { name: "Choose match format" });
    await user.click(screen.getByRole("button", { name: /bo3best of 3/i }));
    await continueWizard(user, 4);
    roomsResponse = [room];
    await user.click(screen.getByRole("button", { name: "Create room" }));
    expect(await screen.findByRole("link", { name: "Open existing veto" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open existing veto" })).toHaveAttribute("href", "/admin/veto-rooms?roomId=veto-1");
    expect(screen.queryByRole("button", { name: "Copy" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^Open$/i })).not.toBeInTheDocument();
    expect(mocks.vetoRequest).toHaveBeenCalledWith("/api/v1/admin/veto-rooms", expect.objectContaining({ method: "POST" }));
  });
});
