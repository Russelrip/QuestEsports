import AboutSection from "@/components/home/AboutSection";
import FeaturedTournaments from "@/components/home/FeaturedTournaments";
import HomeHero from "@/components/home/HomeHero";
import StructuredData from "@/components/StructuredData";
import TeamSection from "@/components/home/TeamSection";
import {
  buildPageMetadata,
  defaultPageDescriptions,
  organizationStructuredData,
  websiteStructuredData,
} from "@/lib/site";

export const metadata = buildPageMetadata({
  title: "Home",
  description: defaultPageDescriptions.home,
  path: "/",
  keywords: [
    "esports Sri Lanka home",
    "gaming tournaments Sri Lanka",
    "Quest Esports community",
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
      <AboutSection />
      <TeamSection />
      <FeaturedTournaments />
    </>
  );
}
