import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TeamInviteOnboarding from "../../components/auth/TeamInviteOnboarding";
import { INVITATIONS_PATH, ONBOARDING_PATH, onboardingUrl } from "../../lib/team-invite-links";

// The signed-out half of a captain's invitation link.
//
// The reference it carries is a routing hint, not a credential: no endpoint
// takes it as authority, and this page resolves nothing with it. That is what
// makes it safe to forward — which is exactly what will happen to it, because
// it is a link a captain pastes into a group chat.

const mocks = vi.hoisted(() => ({
  user: null as Record<string, unknown> | null,
  isLoading: false,
  replace: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace }),
}));

vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => ({ user: mocks.user, isLoading: mocks.isLoading }),
}));

beforeEach(() => {
  mocks.user = null;
  mocks.isLoading = false;
  mocks.replace = vi.fn();
});

afterEach(() => cleanup());

describe("team invite links", () => {
  it("is the same link for everybody, carrying nothing about the invitation", () => {
    // It used to name a roster row. That reference is gone: the row is replaced
    // whenever a captain corrects an email, and an older link then told the
    // reader the invitation was not for their account.
    expect(ONBOARDING_PATH).toBe("/team-invite");
    expect(INVITATIONS_PATH).toBe("/profile?tab=invitations");
    expect(onboardingUrl("https://quest.test")).toBe("https://quest.test/team-invite");
    expect(onboardingUrl("https://quest.test")).not.toMatch(/member=/);
  });
});

describe("TeamInviteOnboarding", () => {
  it("explains what to do without naming the team, the captain or the address", async () => {
    render(<TeamInviteOnboarding />);

    expect(
      await screen.findByText("Sign in with the email you were invited on"),
    ).toBeInTheDocument();
    // Nothing is resolved anonymously, so there is nothing here to learn from a
    // link that was forwarded to the wrong person.
    expect(document.body.textContent).not.toMatch(/@/);
  });

  it("carries the destination through both ways in", async () => {
    render(<TeamInviteOnboarding />);

    const destination = encodeURIComponent("/profile?tab=invitations");
    expect(await screen.findByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      `/login?redirect=${destination}`,
    );
    expect(screen.getByRole("link", { name: "Create account" })).toHaveAttribute(
      "href",
      `/signup?redirect=${destination}`,
    );
  });

  it("sends somebody already signed in straight to the invitation", async () => {
    mocks.user = { id: "user-1" };
    render(<TeamInviteOnboarding />);

    // Replaced rather than pushed: Back should not drop them on a page of
    // instructions they have already outgrown.
    await waitFor(() =>
      expect(mocks.replace).toHaveBeenCalledWith("/profile?tab=invitations"),
    );
  });

  it("waits rather than flashing onboarding text at a signed-in user", () => {
    mocks.isLoading = true;
    render(<TeamInviteOnboarding />);

    expect(mocks.replace).not.toHaveBeenCalled();
    expect(
      screen.queryByText("Sign in with the email you were invited on"),
    ).not.toBeInTheDocument();
  });
});
