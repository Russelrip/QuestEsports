import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AdminGameAccountChanges from "../../components/admin/AdminGameAccountChanges";
import type { GameAccountChangeRequest } from "../../lib/game-account-admin";

const mocks = vi.hoisted(() => ({
  listChangeRequests: vi.fn(),
  reviewChangeRequest: vi.fn(),
  adminRequest: vi.fn(),
}));

vi.mock("@/lib/game-account-admin", async () => {
  const actual = await vi.importActual<typeof import("../../lib/game-account-admin")>(
    "../../lib/game-account-admin",
  );
  return { ...actual, ...mocks };
});
vi.mock("@/lib/admin", () => ({ adminRequest: mocks.adminRequest, ADMIN_NAV_GROUPS: [] }));
vi.mock("@/components/admin/AdminShell", () => ({
  default: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
}));

const request = (overrides: Partial<GameAccountChangeRequest> = {}): GameAccountChangeRequest => ({
  id: "req-1",
  status: "pending",
  game: "valorant",
  reason: "I lost access to my old Riot account",
  requestedIdentity: "NewName#2222",
  requestedRegion: "ap",
  currentIdentity: "OldName#1111",
  player: { publicId: "QPID-000007", displayName: "Russel" },
  requestedAt: "2026-08-24T00:00:00.000Z",
  reviewedAt: null,
  adminNote: null,
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listChangeRequests.mockResolvedValue([request()]);
  mocks.reviewChangeRequest.mockResolvedValue({ status: "approved", gameAccountId: "acc-2" });
});
afterEach(() => cleanup());

describe("account change review", () => {
  it("shows both accounts, because that is the whole decision", async () => {
    render(<AdminGameAccountChanges />);
    expect(await screen.findByText("OldName#1111")).toBeTruthy();
    expect(screen.getByText("NewName#2222")).toBeTruthy();
    expect(screen.getByText("I lost access to my old Riot account")).toBeTruthy();
    expect(screen.getByText("QPID-000007")).toBeTruthy();
  });

  it("explains that renames never appear here", async () => {
    // Otherwise an admin reasonably wonders why a player who renamed is missing
    // from the queue, and starts looking for a bug.
    render(<AdminGameAccountChanges />);
    expect(await screen.findByText(/never appears here/i)).toBeTruthy();
  });

  it("approves with the admin note attached", async () => {
    const user = userEvent.setup();
    render(<AdminGameAccountChanges />);
    await screen.findByText("NewName#2222");

    await user.type(screen.getByLabelText(/Note to the player/i), "verified support ticket");
    await user.click(screen.getByRole("button", { name: "Approve change" }));

    await waitFor(() => {
      expect(mocks.reviewChangeRequest).toHaveBeenCalledWith({
        requestId: "req-1",
        approve: true,
        adminNote: "verified support ticket",
      });
    });
  });

  it("refuses to reject without a reason, before calling the server", async () => {
    const user = userEvent.setup();
    render(<AdminGameAccountChanges />);
    await screen.findByText("NewName#2222");

    await user.click(screen.getByRole("button", { name: "Reject" }));

    // The server enforces this too; catching it here tells the admin what the
    // player would have seen instead of bouncing off a 400.
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(mocks.reviewChangeRequest).not.toHaveBeenCalled();
  });

  it("rejects once a reason is given", async () => {
    const user = userEvent.setup();
    mocks.reviewChangeRequest.mockResolvedValue({ status: "rejected", gameAccountId: null });
    render(<AdminGameAccountChanges />);
    await screen.findByText("NewName#2222");

    await user.type(screen.getByLabelText(/Note to the player/i), "could not verify the claim");
    await user.click(screen.getByRole("button", { name: "Reject" }));

    await waitFor(() => {
      expect(mocks.reviewChangeRequest).toHaveBeenCalledWith({
        requestId: "req-1",
        approve: false,
        adminNote: "could not verify the claim",
      });
    });
  });

  it("offers no decision on an already-reviewed request", async () => {
    mocks.listChangeRequests.mockResolvedValue([
      request({ status: "approved", adminNote: "verified", reviewedAt: "2026-08-24T01:00:00.000Z" }),
    ]);
    render(<AdminGameAccountChanges />);

    expect(await screen.findByText("Approved")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Approve change" })).toBeNull();
    // The decision note stays visible as the record of why.
    expect(screen.getByText("verified")).toBeTruthy();
  });

  it("says plainly when the queue is empty", async () => {
    mocks.listChangeRequests.mockResolvedValue([]);
    render(<AdminGameAccountChanges />);
    expect(await screen.findByText("Nothing awaiting review.")).toBeTruthy();
  });

  it("surfaces a load failure instead of showing an empty queue", async () => {
    // An empty list and a failed request look identical to an admin, and one of
    // them means work is silently piling up.
    mocks.listChangeRequests.mockRejectedValue(new Error("Unable to load account change requests."));
    render(<AdminGameAccountChanges />);
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.queryByText("Nothing awaiting review.")).toBeNull();
  });
});
