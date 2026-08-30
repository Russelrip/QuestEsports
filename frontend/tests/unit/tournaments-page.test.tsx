import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetchPublicTournaments, fetchPublicGameCategories } = vi.hoisted(() => ({
  fetchPublicTournaments: vi.fn(),
  fetchPublicGameCategories: vi.fn(),
}));

vi.mock("@/lib/tournaments", () => ({
  fetchPublicTournaments,
  fetchPublicGameCategories,
}));

import PageLayout from "@/components/PageLayout";
import TournamentsPage from "@/app/tournaments/page";

describe("tournaments page availability", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchPublicTournaments.mockResolvedValue([]);
    fetchPublicGameCategories.mockResolvedValue([]);
  });

  it.each([
    ["tournaments", fetchPublicTournaments],
    ["game categories", fetchPublicGameCategories],
  ])("renders PageLayout with an unavailable state when %s fetch fails", async (_dependency, rejectedFetch) => {
    rejectedFetch.mockRejectedValueOnce(new Error("backend unavailable"));

    const page = await TournamentsPage({ searchParams: Promise.resolve({}) });

    expect(page.type).toBe(PageLayout);
    const html = renderToStaticMarkup(page);
    expect(html).toContain("Tournaments unavailable");
    expect(html).toContain("Tournaments are temporarily unavailable. Please try again shortly.");
  });
});
