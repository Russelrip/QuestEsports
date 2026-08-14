import PageLayout from "@/components/PageLayout";
import ValorantLeaderboard from "@/components/valorant/ValorantLeaderboard";
import { buildPageMetadata, defaultPageDescriptions } from "@/lib/site";
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

export default async function ValorantLeaderboardPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string }>;
}) {
  const { page = "1", q = "" } = await searchParams;
  const pageNumber = Math.max(1, Number.parseInt(page, 10) || 1);
  const query = q.trim();

  if (query) {
    const entry = await searchPublicValorantLeaderboard(query);
    return (
      <PageLayout title="Valorant Leaderboard" description={defaultPageDescriptions.valorantLeaderboard}>
        <ValorantLeaderboard
          entries={[]}
          page={1}
          perPage={PER_PAGE}
          total={0}
          totalPages={1}
          query={query}
          searchResult={entry}
        />
      </PageLayout>
    );
  }

  const pageData = await fetchPublicValorantLeaderboard(pageNumber, PER_PAGE);
  return (
    <PageLayout title="Valorant Leaderboard" description={defaultPageDescriptions.valorantLeaderboard}>
      <ValorantLeaderboard
        entries={pageData.entries}
        page={pageData.page}
        perPage={pageData.perPage}
        total={pageData.total}
        totalPages={pageData.totalPages}
        query=""
        searchResult={null}
      />
    </PageLayout>
  );
}
