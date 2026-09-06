import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ValorantRegistration from "../../components/valorant/ValorantRegistration";

const mocks = vi.hoisted(() => ({
  auth: { user: null as null | { discordId?: string | null; discordTag?: string | null }, isLoading: false },
  check: vi.fn(), preview: vi.fn(), submit: vi.fn(), linkUrl: vi.fn(() => "https://api.example.test/api/v1/auth/oauth/discord/link"),
  router: { push: vi.fn() },
}));

vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => mocks.auth }));
vi.mock("@/lib/account-linking", () => ({ getProviderLinkUrl: mocks.linkUrl }));
vi.mock("@/lib/valorant-api", () => ({ checkPuuidRegistered: mocks.check, previewValorantRegistration: mocks.preview, submitValorantRegistration: mocks.submit }));
vi.mock("next/navigation", () => ({ useRouter: () => mocks.router }));

const linkedUser = { discordId: "1134567890123456789", discordTag: "player#1234" };
const player = { puuid: "p-1", name: "Sahan", tag: "QST", current_rank: "Diamond 2", elo: 1850, peak_rank: "Ascendant 1", peak_season: "EP 9", last_played: null };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.user = null;
  mocks.auth.isLoading = false;
  mocks.check.mockResolvedValue({ exists: false, user: null });
  mocks.preview.mockResolvedValue(player);
  mocks.submit.mockResolvedValue({ success: true });
});
afterEach(() => cleanup());

describe("Valorant registration states", () => {
  it("shows an accessible loading status", () => {
    mocks.auth.isLoading = true;
    render(<ValorantRegistration />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading registration");
  });

  it("prompts anonymous visitors to sign in without registration inputs", () => {
    render(<ValorantRegistration />);
    expect(screen.getByRole("heading", { name: "Sign in to register" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign in to continue" })).toHaveAttribute("href", expect.stringContaining("/login"));
    expect(screen.queryByLabelText("PUUID")).not.toBeInTheDocument();
  });

  it("uses the existing account-link URL for authenticated users without an ID", async () => {
    mocks.auth.user = { discordTag: "tag-only" };
    const assign = vi.fn();
    const location = vi.spyOn(window, "location", "get").mockReturnValue({ assign } as unknown as Location);
    render(<ValorantRegistration />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Connect Discord" }));
    expect(mocks.linkUrl).toHaveBeenCalledWith("discord");
    expect(assign).toHaveBeenCalledWith("https://api.example.test/api/v1/auth/oauth/discord/link");
    expect(screen.queryByLabelText("PUUID")).not.toBeInTheDocument();
    location.mockRestore();
  });

  it("shows linked identity read-only and completes preview and submit with the PUUID", async () => {
    mocks.auth.user = linkedUser;
    const user = userEvent.setup();
    render(<ValorantRegistration />);
    expect(await screen.findByText("Welcome, player#1234")).toBeInTheDocument();
    expect(screen.getByText("Discord ID: 1134567890123456789")).toBeInTheDocument();
    await user.type(screen.getByLabelText("PUUID"), "p-1");
    await user.click(screen.getByRole("button", { name: "Verify Player" }));
    expect(await screen.findByRole("heading", { name: "Confirm Your Registration" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add to Leaderboard" }));
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledWith({ puuid: "p-1" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Registration Successful!");
    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
    expect(screen.getByRole("heading", { name: "Registration Successful!" })).toHaveFocus();
  });

  it("blocks preview and submit when Discord is not linked", () => {
    mocks.auth.user = { discordTag: "tag-only" };
    render(<ValorantRegistration />);
    expect(mocks.check).not.toHaveBeenCalled();
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it("returns to the unlinked state when Discord disappears during preview", async () => {
    mocks.auth.user = linkedUser;
    let resolvePreview: (value: typeof player) => void = () => undefined;
    mocks.preview.mockReturnValueOnce(new Promise((resolve) => { resolvePreview = resolve; }));
    const user = userEvent.setup();
    const view = render(<ValorantRegistration />);

    await user.type(await screen.findByLabelText("PUUID"), "p-1");
    await user.click(screen.getByRole("button", { name: "Verify Player" }));
    await waitFor(() => expect(mocks.preview).toHaveBeenCalledWith("p-1"));

    mocks.auth.user = { discordTag: "tag-only" };
    view.rerender(<ValorantRegistration />);
    resolvePreview(player);

    await waitFor(() => expect(screen.getByRole("button", { name: "Connect Discord" })).toBeInTheDocument());
    expect(screen.queryByRole("heading", { name: "Confirm Your Registration" })).not.toBeInTheDocument();
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it("announces preview and submission errors", async () => {
    mocks.auth.user = linkedUser;
    mocks.preview.mockRejectedValueOnce(new Error("Player lookup failed"));
    const user = userEvent.setup();
    render(<ValorantRegistration />);
    await user.type(await screen.findByLabelText("PUUID"), "p-1");
    await user.click(screen.getByRole("button", { name: "Verify Player" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Player lookup failed");
  });
});
