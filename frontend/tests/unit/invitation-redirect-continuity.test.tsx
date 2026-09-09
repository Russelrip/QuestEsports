import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SocialAuthButtons } from "../../components/auth/AuthFormControls";
import ProfileView from "../../components/auth/ProfileView";

// The destination has to survive every way into an account, not just the one
// that was easiest to wire. A player following a captain's link may sign in
// with a password, with Google, or with Discord, and may arrive signed out at
// the invitations tab itself — and every one of those paths that forgets where
// they were going hands them a dashboard and leaves them to find it again.

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  user: null as Record<string, unknown> | null,
  isLoading: false,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace, push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => ({
    user: mocks.user,
    isLoading: mocks.isLoading,
    refreshUser: vi.fn(),
    logout: vi.fn(),
  }),
}));

const destination = "/profile?tab=invitations&member=member-7";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.replace = vi.fn();
  mocks.user = null;
  mocks.isLoading = false;
});

afterEach(() => cleanup());

describe("OAuth continuation", () => {
  it("carries the destination into both providers", () => {
    render(<SocialAuthButtons mode="login" redirectTo={destination} />);

    for (const name of [/Continue with Google/i, /Continue with Discord/i]) {
      const href = screen.getByRole("link", { name }).getAttribute("href") || "";
      expect(href).toContain(`redirect=${encodeURIComponent(destination)}`);
    }
  });

  it("leaves the provider URLs alone when there is nowhere in particular to go", () => {
    render(<SocialAuthButtons mode="login" redirectTo={null} />);

    for (const name of [/Continue with Google/i, /Continue with Discord/i]) {
      expect(screen.getByRole("link", { name }).getAttribute("href") || "").not.toContain("redirect=");
    }
  });
});

describe("signed-out profile", () => {
  it("sends a signed-out visitor to a login that comes back", () => {
    window.history.replaceState({}, "", destination);
    render(<ProfileView />);

    // A bare /login here is the difference between finishing the errand and
    // starting it again: the link that sent them is already two redirects back.
    expect(mocks.replace).toHaveBeenCalledWith(`/login?redirect=${encodeURIComponent(destination)}`);
  });

  it("does not decorate a plain profile visit with a pointless redirect", () => {
    window.history.replaceState({}, "", "/profile");
    render(<ProfileView />);

    expect(mocks.replace).toHaveBeenCalledWith("/login");
  });
});
