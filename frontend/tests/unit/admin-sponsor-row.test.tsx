import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SponsorRow from "../../components/admin/SponsorRow";
import type { TournamentSponsor } from "../../lib/tournaments";

const mocks = vi.hoisted(() => ({ adminRequest: vi.fn() }));

vi.mock("@/lib/admin", () => ({ adminRequest: mocks.adminRequest }));
vi.mock("@/lib/media", () => ({ resolveImageUrl: (url: string | null) => url }));

const sponsor: TournamentSponsor = {
  id: "sponsor-1",
  name: "KOBRA ENERGY DRINK",
  partnershipLabel: "ENERGY PARTNER",
  logoUrl: "/api/uploads/sponsor-logos/kobra.webp",
  websiteUrl: "https://kobra.example",
  displayOrder: 99,
};

const renderRow = (overrides: Partial<TournamentSponsor> = {}) => {
  const onChanged = vi.fn().mockResolvedValue(undefined);
  const onMessage = vi.fn();
  render(
    <SponsorRow
      sponsor={{ ...sponsor, ...overrides }}
      sponsorsPath="/api/admin/events/event-1/sponsors"
      onChanged={onChanged}
      onMessage={onMessage}
    />,
  );
  return { onChanged, onMessage };
};

const bodyOf = (call: unknown[]) => (call[1] as { body: FormData }).body;

beforeEach(() => {
  mocks.adminRequest.mockReset();
  mocks.adminRequest.mockResolvedValue({});
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("SponsorRow", () => {
  it("shows the stored values, not a blank form, when editing opens", async () => {
    renderRow();
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));

    expect(screen.getByDisplayValue("KOBRA ENERGY DRINK")).toBeTruthy();
    expect(screen.getByDisplayValue("ENERGY PARTNER")).toBeTruthy();
    expect(screen.getByDisplayValue("https://kobra.example")).toBeTruthy();
    expect(screen.getByDisplayValue("99")).toBeTruthy();
  });

  it("PATCHes the edited fields rather than recreating the sponsor", async () => {
    const { onChanged } = renderRow();
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));

    const label = screen.getByDisplayValue("ENERGY PARTNER");
    await userEvent.clear(label);
    await userEvent.type(label, "GIFT PARTNER");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(mocks.adminRequest).toHaveBeenCalled());
    const call = mocks.adminRequest.mock.calls[0];
    expect(call[0]).toBe("/api/admin/events/event-1/sponsors/sponsor-1");
    expect((call[1] as { method: string }).method).toBe("PATCH");
    const body = bodyOf(call);
    expect(body.get("partnershipLabel")).toBe("GIFT PARTNER");
    expect(body.get("name")).toBe("KOBRA ENERGY DRINK");
    expect(onChanged).toHaveBeenCalled();
  });

  it("sends no logo field when the logo is left alone, so the file survives the edit", async () => {
    renderRow();
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(mocks.adminRequest).toHaveBeenCalled());
    const body = bodyOf(mocks.adminRequest.mock.calls[0]);
    expect(body.get("logo")).toBeNull();
    expect(body.get("removeLogo")).toBeNull();
  });

  it("asks for removal only when the checkbox is ticked", async () => {
    renderRow();
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    await userEvent.click(screen.getByRole("checkbox"));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(mocks.adminRequest).toHaveBeenCalled());
    expect(bodyOf(mocks.adminRequest.mock.calls[0]).get("removeLogo")).toBe("true");
  });

  it("offers no removal checkbox when there is no logo to remove", async () => {
    renderRow({ logoUrl: null });
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));

    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("discards edits on cancel and reopens with the stored values", async () => {
    renderRow();
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    const label = screen.getByDisplayValue("ENERGY PARTNER");
    await userEvent.clear(label);
    await userEvent.type(label, "TYPO PARTNER");
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(mocks.adminRequest).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByDisplayValue("ENERGY PARTNER")).toBeTruthy();
  });

  it("keeps the row open and reports why when the save is refused", async () => {
    mocks.adminRequest.mockRejectedValue(new Error("Partnership label must be 80 characters or fewer."));
    const { onMessage, onChanged } = renderRow();
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(onMessage).toHaveBeenCalledWith("Partnership label must be 80 characters or fewer."),
    );
    // Still editing, so the admin's typing is not thrown away by the failure.
    expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("warns that the logo file goes too before removing a sponsor", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderRow();
    await userEvent.click(screen.getByRole("button", { name: "Remove" }));

    expect(confirmSpy.mock.calls[0][0]).toContain("logo file is deleted");
    expect(mocks.adminRequest).not.toHaveBeenCalled();
  });
});
