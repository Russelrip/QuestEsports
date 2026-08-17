import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { adminEventActionLabels, applyAdminEventMediaSelection, buildAdminEventFormData, getAdminEventArchiveLabel, getAdminEventStatusLabel, initialAdminEventFormValues } from "../../lib/admin";
import { buildTournamentFormData, initialTournamentFormValues } from "../../lib/admin";

const mocks = vi.hoisted(() => ({ events: null as unknown, push: vi.fn(), toast: vi.fn() }));
vi.mock("next/link", () => ({ default: ({ children, ...props }: { children: ReactNode }) => createElement("a", props, children) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("@/hooks/api/useAdmin", () => ({
  useAdminEvents: () => ({ data: mocks.events, loading: false, error: "", refetch: vi.fn() }),
  useAdminTournamentOptions: () => ({ data: [] }),
  useAdminEventRegistrations: () => ({ data: null, loading: false, error: "" }),
}));
vi.mock("@/hooks/useToastStore", () => ({ useToastStore: (selector: (state: { showToast: typeof mocks.toast }) => unknown) => selector({ showToast: mocks.toast }) }));
vi.mock("@/components/admin/AdminShell", () => ({ default: ({ children }: { children: ReactNode }) => createElement("main", null, children) }));
vi.mock("@/components/ui/card", () => ({ Card: ({ children }: { children: ReactNode }) => createElement("section", null, children) }));
vi.mock("@/components/ui/empty-state", () => ({ default: ({ description }: { description: string }) => createElement("p", null, description) }));
vi.mock("@/components/ui/skeleton", () => ({ AdminTableSkeleton: () => createElement("div", null, "Loading") }));
vi.mock("@/components/ui/form-field", () => ({ FormField: ({ label, children }: { label: string; children: ReactNode }) => createElement("label", null, label, children) }));
vi.mock("@/components/ui/input", () => ({ Input: (props: Record<string, unknown>) => createElement("input", props) }));
vi.mock("@/components/ui/select", () => ({ Select: (props: Record<string, unknown>) => createElement("select", props) }));
vi.mock("@/components/ui/textarea", () => ({ Textarea: (props: Record<string, unknown>) => createElement("textarea", props) }));
vi.mock("@/components/ui/button", () => ({ Button: ({ children, ...props }: { children: ReactNode } & Record<string, unknown>) => createElement("button", props, children), buttonClassName: () => "button" }));
import AdminEventDashboard from "../../components/admin/AdminEventDashboard";

const renderedEvent = {
  id: "event-1", slug: "quest-ascension", title: "Quest Ascension", description: "Multi-game event", heroUrl: "/hero.webp", bannerUrl: "/banner.webp", displayOrder: 1, isPublished: true,
  aggregate: { games: 2, teamsRegistered: 3, playersRegistered: 12, availableSlots: 4, registrationState: "open" as const }, tournaments: [],
};

describe("admin event form", () => {
  it("has safe draft defaults and serializes dates and booleans", () => {
    expect(initialAdminEventFormValues.isPublished).toBe(false);
    const body = buildAdminEventFormData({ ...initialAdminEventFormValues, title: "Quest Ascension", startDate: "2026-09-01T10:00" });
    expect(body.get("title")).toBe("Quest Ascension");
    expect(body.get("isPublished")).toBe("false");
    expect(body.get("startDate")).toBe("2026-09-01T04:30:00.000Z");
  });
  it("uses clear archive and status labels", () => {
    expect(getAdminEventArchiveLabel("Quest Ascension")).toBe("Archive Quest Ascension");
    expect(getAdminEventStatusLabel("open")).toBe("Open");
    expect(getAdminEventStatusLabel("draft")).toBe("Draft");
    expect(adminEventActionLabels.addTournament).toBe("Add tournament");
    expect(adminEventActionLabels.attachExisting).toBe("Attach existing");
    expect(adminEventActionLabels.viewPublic).toBe("View public event");
  });
  it("sends explicit empty optional values so PATCH can clear them", () => {
    const body = buildAdminEventFormData({ ...initialAdminEventFormValues, shortName: "", websiteUrl: null });
    expect(body.get("shortName")).toBe("");
    expect(body.get("websiteUrl")).toBe("");
  });
  it("rejects oversized event media with the shared upload limit", () => {
    const file = new File([new Uint8Array(10 * 1024 * 1024 + 1)], "hero.png", { type: "image/png" });
    expect(() => buildAdminEventFormData({ ...initialAdminEventFormValues, heroImage: file })).toThrow("Event hero image cannot exceed 10 MB.");
  });
  it("clears a matching remove flag when a replacement file is selected", () => {
    const file = new File(["replacement"], "hero.webp", { type: "image/webp" });
    const next = applyAdminEventMediaSelection({ ...initialAdminEventFormValues, removeHeroImage: true, removeBannerImage: true }, "heroImage", file);
    expect(next.heroImage).toBe(file);
    expect(next.removeHeroImage).toBe(false);
    expect(next.removeBannerImage).toBe(true);
    const banner = applyAdminEventMediaSelection(next, "bannerImage", file);
    expect(banner.removeBannerImage).toBe(false);
  });
  it("serializes waitlist settings with the existing tournament multipart fields", () => {
    const body = buildTournamentFormData({ ...initialTournamentFormValues, waitlistEnabled: true });
    expect(body.get("waitlistEnabled")).toBe("true");
  });
  it("renders reachable create and media controls for a new event", () => {
    mocks.events = { events: [] };
    const html = renderToStaticMarkup(createElement(AdminEventDashboard, { eventId: "new" }));
    expect(html).toContain("Create event");
    expect(html).toContain('id="event-hero"');
    expect(html).toContain('id="event-banner"');
    expect(html).toContain("Publish event");
    expect(html).not.toContain("Archive event");
  });
  it("renders edit, publish, archive, remove, and disabled handoff controls", () => {
    mocks.events = { events: [renderedEvent] };
    const html = renderToStaticMarkup(createElement(AdminEventDashboard, { eventId: "event-1", initialTab: "Settings" }));
    expect(html).toContain("Save event");
    expect(html).toContain("Unpublish");
    expect(html).toContain("Archive event");
    expect(html).toContain("Remove current hero image");
    expect(html).toContain("Remove banner image");
    const tournamentsHtml = renderToStaticMarkup(createElement(AdminEventDashboard, { eventId: "event-1", initialTab: "Tournaments" }));
    expect(tournamentsHtml).toContain("Add tournament");
    expect(tournamentsHtml).toContain("Attach existing");
    expect(tournamentsHtml).toContain("disabled");
  });
});
