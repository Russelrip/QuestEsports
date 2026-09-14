import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AdminAuditLog from "../../components/admin/AdminAuditLog";
import type { AuditLogEntry } from "../../lib/audit-log";

const mocks = vi.hoisted(() => ({
  search: "",
  listAuditLogs: vi.fn(),
  getAuditLogFacets: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(mocks.search) }));
vi.mock("@/components/admin/AdminShell", () => ({
  default: ({ children, actions }: React.PropsWithChildren<{ actions?: React.ReactNode }>) => <div>{actions}{children}</div>,
}));
vi.mock("@/lib/audit-log", async () => {
  const actual = await vi.importActual<typeof import("../../lib/audit-log")>("../../lib/audit-log");
  return { ...actual, listAuditLogs: mocks.listAuditLogs, getAuditLogFacets: mocks.getAuditLogFacets };
});

const entry: AuditLogEntry = {
  id: "log-1",
  createdAt: "2026-09-14T08:30:00.000Z",
  action: "team_registration.status_changed",
  targetType: "TeamRegistration",
  targetId: "reg-42",
  actorUserId: "user-1",
  actor: { id: "user-1", username: "russ", name: "Russel Perera", email: "r@example.com" },
  source: "admin",
  reason: "Roster verified at check-in",
  requestId: "req-9",
  ipAddress: "203.0.113.4",
  beforeData: { status: "pending", teamName: "Quest" },
  afterData: { status: "approved", teamName: "Quest" },
};

const lastFilters = () => mocks.listAuditLogs.mock.calls.at(-1)?.[0];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.search = "";
  mocks.listAuditLogs.mockResolvedValue({ entries: [entry], pagination: { page: 1, pageSize: 25, total: 1, totalPages: 1 } });
  mocks.getAuditLogFacets.mockResolvedValue({
    actions: [{ value: "team_registration.status_changed", count: 1 }],
    targetTypes: [{ value: "TeamRegistration", count: 1 }],
    sources: ["web", "admin", "mobile", "bot", "system"],
  });
});
afterEach(() => cleanup());

describe("admin audit log", () => {
  it("lists who did what to which record, and why", async () => {
    render(<AdminAuditLog />);

    expect(await screen.findByText("Russel Perera (@russ)")).toBeTruthy();
    expect(screen.getByText("Admin panel", { selector: "p" })).toBeTruthy();
    expect(screen.getByText("team_registration.status_changed")).toBeTruthy();
    expect(screen.getByText("reg-42")).toBeTruthy();
    expect(screen.getByText("“Roster verified at check-in”")).toBeTruthy();
    expect(screen.getByText("Page 1 of 1 - 1 entries")).toBeTruthy();
  });

  it("opens the before and after for an entry", async () => {
    render(<AdminAuditLog />);
    fireEvent.click(await screen.findByRole("button", { name: "Changes" }));

    expect(screen.getByText("pending")).toBeTruthy();
    expect(screen.getByText("approved")).toBeTruthy();
    expect(screen.getByText("(unchanged)")).toBeTruthy();
    expect(screen.getByText("203.0.113.4")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Hide changes" }).getAttribute("aria-expanded")).toBe("true");
  });

  it("narrows to a record's history when its target is clicked", async () => {
    render(<AdminAuditLog />);
    fireEvent.click(await screen.findByRole("button", { name: "TeamRegistration" }));

    await waitFor(() => expect(lastFilters()).toMatchObject({ targetType: "TeamRegistration", targetId: "reg-42" }));
    expect(mocks.listAuditLogs.mock.calls.at(-1)?.[1]).toBe(1);
  });

  it("narrows to one account from its actor, and can widen again", async () => {
    render(<AdminAuditLog />);
    fireEvent.click(await screen.findByRole("button", { name: "Russel Perera (@russ)" }));

    await waitFor(() => expect(lastFilters()).toMatchObject({ actorUserId: "user-1" }));
    fireEvent.click(screen.getByRole("button", { name: "Show every account" }));
    await waitFor(() => expect(lastFilters()).toMatchObject({ actorUserId: "" }));
  });

  it("opens with the filters in the URL", async () => {
    mocks.search = "targetType=User&targetId=user-9";
    render(<AdminAuditLog />);

    await waitFor(() => expect(mocks.listAuditLogs).toHaveBeenCalled());
    expect(mocks.listAuditLogs.mock.calls[0][0]).toMatchObject({ targetType: "User", targetId: "user-9" });
    // A deep-linked value missing from the menu stays selectable.
    expect((screen.getByLabelText("Target type") as HTMLSelectElement).value).toBe("User");
  });

  it("says when nothing matches and shows load failures", async () => {
    mocks.listAuditLogs.mockResolvedValueOnce({ entries: [], pagination: { page: 1, pageSize: 25, total: 0, totalPages: 1 } });
    render(<AdminAuditLog />);
    expect(await screen.findByText("Nothing has been recorded yet.")).toBeTruthy();
    cleanup();

    mocks.listAuditLogs.mockRejectedValueOnce(new Error("Admin access required."));
    render(<AdminAuditLog />);
    expect(await screen.findByText("Admin access required.")).toBeTruthy();
  });
});
