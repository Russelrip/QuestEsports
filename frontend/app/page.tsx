import FeaturedTournaments from "@/components/home/FeaturedTournaments";
import HomeHero from "@/components/home/HomeHero";
import JoinQuestSection from "@/components/home/JoinQuestSection";
import StructuredData from "@/components/StructuredData";
import TeamSection from "@/components/home/TeamSection";
import {
  buildPageMetadata,
  defaultPageDescriptions,
  organizationStructuredData,
  websiteStructuredData,
} from "@/lib/site";

export const dynamic = "force-dynamic";

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

export default function HomePage() {
  return (
    <>
      <StructuredData data={organizationStructuredData} />
      <StructuredData data={websiteStructuredData} />
      {/* The home page is assembled from reusable marketing sections. */}
      <HomeHero />
      <JoinQuestSection />
      <TeamSection />
      <FeaturedTournaments />
    </>
  );
}
