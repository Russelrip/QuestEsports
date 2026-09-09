import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SignupForm from "../../components/auth/SignupForm";
import VerifyEmailContent from "../../components/auth/VerifyEmailContent";

// Accepting a team invitation can require signing up, verifying an address and
// connecting Discord before there is anything to accept. Each of those steps is
// a redirect away from the link that started it, so the destination has to
// survive all of them — otherwise the reward for doing what you were asked is
// being dropped on a dashboard to go and find it again.

const mocks = vi.hoisted(() => ({
  params: new URLSearchParams(),
  apiFetchJson: vi.fn(),
  refreshSession: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => mocks.params,
}));

vi.mock("@/lib/auth", async () => {
  const actual = await vi.importActual<typeof import("../../lib/auth")>("../../lib/auth");
  return { ...actual, apiFetchJson: (...args: unknown[]) => mocks.apiFetchJson(...args) };
});

vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => ({ user: null, isLoading: false, refreshSession: mocks.refreshSession }),
}));

vi.mock("@/components/auth/ResendVerificationButton", () => ({
  default: () => null,
}));

const destination = "/profile?tab=invitations&member=member-7";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.params = new URLSearchParams(`redirect=${encodeURIComponent(destination)}`);
  mocks.apiFetchJson.mockResolvedValue({
    response: { ok: true, status: 200 },
    data: { success: true, message: "Verified." },
  });
});

afterEach(() => cleanup());

describe("signup continuation", () => {
  it("sends the destination with the signup so the verification email can carry it", async () => {
    render(<SignupForm />);

    await userEvent.type(screen.getByLabelText(/First Name/i), "New");
    await userEvent.type(screen.getByLabelText(/Last Name/i), "Player");
    await userEvent.type(screen.getByLabelText(/^Email/i), "new@example.com");
    await userEvent.type(screen.getByLabelText(/Username/i), "new-player");
    await userEvent.type(screen.getByLabelText(/^Password/i), "correct-password");
    await userEvent.type(screen.getByLabelText(/Confirm Password/i), "correct-password");
    await userEvent.click(screen.getByRole("button", { name: /Create Account/i }));

    await waitFor(() => expect(mocks.apiFetchJson).toHaveBeenCalled());
    const [, options] = mocks.apiFetchJson.mock.calls[0] as [string, { json: Record<string, unknown> }];
    expect(options.json.redirect).toBe(destination);
  });

  it("does not invent a destination when there is none", async () => {
    mocks.params = new URLSearchParams();
    render(<SignupForm />);

    await userEvent.type(screen.getByLabelText(/First Name/i), "New");
    await userEvent.type(screen.getByLabelText(/Last Name/i), "Player");
    await userEvent.type(screen.getByLabelText(/^Email/i), "new@example.com");
    await userEvent.type(screen.getByLabelText(/Username/i), "new-player");
    await userEvent.type(screen.getByLabelText(/^Password/i), "correct-password");
    await userEvent.type(screen.getByLabelText(/Confirm Password/i), "correct-password");
    await userEvent.click(screen.getByRole("button", { name: /Create Account/i }));

    await waitFor(() => expect(mocks.apiFetchJson).toHaveBeenCalled());
    const [, options] = mocks.apiFetchJson.mock.calls[0] as [string, { json: Record<string, unknown> }];
    expect(options.json).not.toHaveProperty("redirect");
  });
});

describe("verification continuation", () => {
  it("sends the required post-verification login back to where it started", async () => {
    mocks.params = new URLSearchParams(
      `token=abc123&redirect=${encodeURIComponent(destination)}`,
    );
    render(<VerifyEmailContent />);

    const signIn = await screen.findByRole("link", { name: "Sign in and continue" });
    expect(signIn).toHaveAttribute("href", `/login?redirect=${encodeURIComponent(destination)}`);
    expect(screen.getByRole("link", { name: "Continue where you left off" })).toHaveAttribute(
      "href",
      destination,
    );
  });

  it("refuses a destination that is not a path on this site", async () => {
    mocks.params = new URLSearchParams("token=abc123&redirect=https://evil.example.com/steal");
    render(<VerifyEmailContent />);

    // Rejected rather than corrected. An email link is the one place a hostile
    // destination arrives already looking legitimate.
    expect(await screen.findByRole("link", { name: "Continue to Login" })).toHaveAttribute(
      "href",
      "/login",
    );
  });
});
