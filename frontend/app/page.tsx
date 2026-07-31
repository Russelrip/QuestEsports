import HomeFoundation from "@/components/home/HomeFoundation";
import StructuredData from "@/components/StructuredData";
import { fetchHomeFeed, type HomeFeed } from "@/lib/matches";
import {
  buildPageMetadata,
  defaultPageDescriptions,
  organizationStructuredData,
  websiteStructuredData,
} from "@/lib/site";

export const revalidate = 15;

export const metadata = buildPageMetadata({
  title: "Quest E-sports LK",
  absoluteTitle: "Quest E-sports LK | Sri Lanka Esports Tournaments",
  description: defaultPageDescriptions.home,
  path: "/",
  keywords: [
    "e-sports Sri Lanka home",
    "gaming tournaments Sri Lanka",
    "Quest E-sports community",
    "VALORANT events",
  ],
});

const emptyFeed: HomeFeed = { nextMatch: null, recentResults: [], upcomingMatches: [], featuredTournaments: [], featuredCompetitors: [] };

export default async function HomePage() {
  let feed = emptyFeed;
  let serverNow = new Date().toISOString();
  let failed = false;
  try {
    const response = await fetchHomeFeed();
    feed = response.data;
    serverNow = response.meta.serverNow;
  } catch (error) {
    failed = true;
    console.error("Unable to load the public home feed:", error);
  }
  return (
    <>
      <StructuredData data={organizationStructuredData} />
      <StructuredData data={websiteStructuredData} />
      <HomeFoundation feed={feed} serverNow={serverNow} failed={failed} />
    </>
  );
}
