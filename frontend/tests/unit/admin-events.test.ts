import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { adminEventActionLabels, applyAdminEventMediaSelection, buildAdminEventFormData, getAdminEventArchiveLabel, getAdminEventStatusLabel, initialAdminEventFormValues } from "../../lib/admin";
import { buildTournamentFormData, initialTournamentFormValues } from "../../lib/admin";

const mocks = vi.hoisted(() => ({
  events: null as unknown,
  registrations: null as unknown,
  registrationState: { loading: false, error: "", refetch: vi.fn() },
  queryCalls: [] as Array<{ key: unknown[]; queryFn: () => Promise<unknown>; options?: { enabled?: boolean } }>,
  push: vi.fn(),
  toast: vi.fn(),
}));
vi.mock("next/link", () => ({ default: ({ children, ...props }: { children: ReactNode }) => createElement("a", props, children) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("@/hooks/api/useAdmin", () => ({
  useAdminEvents: () => ({ data: mocks.events, loading: false, error: "", refetch: vi.fn() }),
  useAdminRegistrations: () => ({ data: null, loading: false, error: "", refetch: vi.fn() }),
  useAdminTournamentOptions: () => ({ data: [] }),
  useAdminEventRegistrations: () => ({ data: mocks.registrations, ...mocks.registrationState }),
}));
vi.mock("@/hooks/api/useApiQuery", () => ({
  useApiQuery: (key: unknown[], queryFn: () => Promise<unknown>, options?: { enabled?: boolean }) => {
    mocks.queryCalls.push({ key, queryFn, options });
    return { data: null, loading: options?.enabled !== false, error: "", refetch: vi.fn() };
  },
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
  it("renders event registration filters and waitlist-aware management controls", () => {
    mocks.events = { events: [{ ...renderedEvent, tournaments: [{ id: "tournament-1", slug: "valorant-cup", title: "Valorant Cup", game: "Valorant", status: "registration_open", isPublished: true, registrationCount: 1, maxTeams: 16 }] }] };
    mocks.registrations = {
      registrations: [{ id: "registration-1", entryType: "team", teamName: "Quest Five", status: "waitlisted", paymentStatus: "unpaid", verificationStatus: "pending", createdAt: "2026-08-17T10:00:00.000Z", tournament: { id: "tournament-1", slug: "valorant-cup", title: "Valorant Cup", game: "Valorant", status: "registration_open", isPublished: true, waitlistEnabled: true }, captain: { name: "Captain", email: "captain@example.com" }, memberCount: 5, coachName: null, coachRiotId: null }],
      tournaments: [{ id: "tournament-1", slug: "valorant-cup", title: "Valorant Cup", game: "Valorant", status: "registration_open", isPublished: true, waitlistEnabled: true }],
      pagination: { page: 1, pageSize: 10, total: 1, totalPages: 1 },
    };
    const html = renderToStaticMarkup(createElement(AdminEventDashboard, { eventId: "event-1", initialTab: "Registrations" }));
    expect(html).toContain("All Games");
    expect(html).toContain("Search teams or captains");
    expect(html).toContain("Waitlisted");
    expect(html).toContain("View &amp; manage");
  });
  it("composes the event registration request with server-side filters and pagination", async () => {
    mocks.queryCalls.length = 0;
    const actual = await vi.importActual<typeof import("../../hooks/api/useAdmin")>("../../hooks/api/useAdmin");
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      void input;
      return new Response(JSON.stringify({ success: true, registrations: [], tournaments: [], pagination: { page: 3, pageSize: 10, total: 0, totalPages: 0 } }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    try {
      actual.useAdminEventRegistrations("event-1", "captain", "valorant-cup", "Valorant", "waitlisted", 3);
      const query = mocks.queryCalls.at(-1);
      expect(query?.key).toEqual(["admin-event-registrations", "event-1", "captain", "valorant-cup", "Valorant", "waitlisted", 3]);
      expect(query?.options).toEqual({ enabled: true });
      await query?.queryFn();
      const requestedUrl = String(fetchMock.mock.calls[0]?.[0]);
      const request = new URL(requestedUrl, "http://localhost");
      expect(request.pathname).toBe("/api/admin/events/event-1/registrations");
      expect(Object.fromEntries(request.searchParams)).toEqual({ page: "3", pageSize: "10", search: "captain", tournament: "valorant-cup", game: "Valorant", status: "waitlisted" });
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("preserves loading, error, empty, and mobile-card states for event registrations", () => {
    mocks.events = { events: [{ ...renderedEvent, tournaments: [{ id: "tournament-1", slug: "valorant-cup", title: "Valorant Cup", game: "Valorant", status: "registration_open", isPublished: true, registrationCount: 1, maxTeams: 16 }] }] };
    mocks.registrationState = { loading: true, error: "", refetch: vi.fn() };
    mocks.registrations = null;
    expect(renderToStaticMarkup(createElement(AdminEventDashboard, { eventId: "event-1", initialTab: "Registrations" }))).toContain("Loading");

    mocks.registrationState = { loading: false, error: "Registration service unavailable", refetch: vi.fn() };
    expect(renderToStaticMarkup(createElement(AdminEventDashboard, { eventId: "event-1", initialTab: "Registrations" }))).toContain("Registration service unavailable");

    mocks.registrationState = { loading: false, error: "", refetch: vi.fn() };
    mocks.registrations = { registrations: [], tournaments: [], pagination: { page: 1, pageSize: 10, total: 0, totalPages: 0 } };
    expect(renderToStaticMarkup(createElement(AdminEventDashboard, { eventId: "event-1", initialTab: "Registrations" }))).toContain("No registrations matched your filters.");

    mocks.registrations = {
      registrations: [{ id: "registration-mobile", entryType: "team", teamName: "Mobile Quest", status: "approved", paymentStatus: "paid", verificationStatus: "verified", publicReference: "QES-MOBILE", createdAt: "2026-08-17T10:00:00.000Z", tournament: { id: "tournament-1", slug: "valorant-cup", title: "Valorant Cup", game: "Valorant", status: "registration_open", isPublished: true, waitlistEnabled: true }, captain: { name: "Mobile Captain", email: "captain@example.com" }, memberCount: 5, coachName: null, coachRiotId: null }],
      tournaments: [{ id: "tournament-1", slug: "valorant-cup", title: "Valorant Cup", game: "Valorant", status: "registration_open", isPublished: true, waitlistEnabled: true }],
      pagination: { page: 1, pageSize: 10, total: 1, totalPages: 1 },
    };
    const html = renderToStaticMarkup(createElement(AdminEventDashboard, { eventId: "event-1", initialTab: "Registrations" }));
    expect(html).toContain("Mobile Quest");
    expect(html).toContain("Mobile Captain");
    expect(html).toContain("QES-MOBILE");
    expect(html).toContain("View &amp; manage");
    expect((html.match(/<article/g) || []).length).toBe(1);
  });
});
