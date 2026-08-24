import PageLayout from "@/components/PageLayout";
import ValorantLeaderboard from "@/components/valorant/ValorantLeaderboard";
import { buildPageMetadata, defaultPageDescriptions } from "@/lib/site";
import type {
  ValorantPlayerLeaderboardPage,
  ValorantPlayerLeaderboardSearchEntry,
} from "@/lib/valorant";
import {
  fetchPublicValorantLeaderboard,
  searchPublicValorantLeaderboard,
} from "@/lib/valorant-api";

export const revalidate = 60;

export const metadata = buildPageMetadata({
  title: "Valorant Leaderboard",
  description: defaultPageDescriptions.valorantLeaderboard,
  path: "/valorant-leaderboard",
  keywords: [
    "valorant leaderboard sri lanka",
    "sri lanka valorant rankings",
    "valorant rank sri lanka",
    "quest esports valorant",
  ],
});

const PER_PAGE = 50;
const SEARCH_LIMIT = 25;

export default async function ValorantLeaderboardPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string }>;
}) {
  const { page = "1", q = "" } = await searchParams;
  const pageNumber = Math.max(1, Number.parseInt(page, 10) || 1);
  const query = q.trim();

  const renderUnavailable = () => (
    <PageLayout title="Valorant Leaderboard" description={defaultPageDescriptions.valorantLeaderboard}>
      <ValorantLeaderboard
        entries={[]}
        page={1}
        perPage={PER_PAGE}
        total={0}
        totalPages={1}
        query=""
        searchResults={[]}
      />
    </PageLayout>
  );

  if (query) {
    let results: ValorantPlayerLeaderboardSearchEntry[] = [];
    let failed = false;
    try {
      results = await searchPublicValorantLeaderboard(query, SEARCH_LIMIT);
    } catch (error) {
      // The upstream is unreachable (e.g. VALORANT_SL_API_URL unset → 503).
      // Render the component's "Leaderboard unavailable" EmptyState + register CTA
      // instead of throwing into the root error boundary. A query that simply
      // matches nobody is NOT an error — it comes back as an empty list and the
      // component renders "No player found".
      console.error("Valorant leaderboard search failed:", error);
      failed = true;
    }
    if (failed) return renderUnavailable();
    return (
      <PageLayout title="Valorant Leaderboard" description={defaultPageDescriptions.valorantLeaderboard}>
        <ValorantLeaderboard
          entries={[]}
          page={1}
          perPage={PER_PAGE}
          total={0}
          totalPages={1}
          query={query}
          searchResults={results}
        />
      </PageLayout>
    );
  }

  let pageData: ValorantPlayerLeaderboardPage | null = null;
  try {
    pageData = await fetchPublicValorantLeaderboard(pageNumber, PER_PAGE);
  } catch (error) {
    // The upstream is unreachable (e.g. VALORANT_SL_API_URL unset → 503).
    // Render the component's "Leaderboard unavailable" EmptyState + register CTA
    // instead of throwing into the root error boundary.
    console.error("Valorant leaderboard request failed:", error);
    pageData = null;
  }
  if (!pageData) return renderUnavailable();
  return (
    <PageLayout title="Valorant Leaderboard" description={defaultPageDescriptions.valorantLeaderboard}>
      <ValorantLeaderboard
        entries={pageData.entries}
        page={pageData.page}
        perPage={pageData.perPage}
        total={pageData.total}
        totalPages={pageData.totalPages}
        query=""
        searchResults={[]}
      />
    </PageLayout>
  );
}
