import AboutSection from "@/components/home/AboutSection";
import FeaturedTournaments from "@/components/home/FeaturedTournaments";
import HomeHero from "@/components/home/HomeHero";
import TeamSection from "@/components/home/TeamSection";

export default function HomePage() {
  return (
    <>
      {/* The home page is assembled from reusable marketing sections. */}
      <HomeHero />
      <AboutSection />
      <TeamSection />
      <FeaturedTournaments />
    </>
  );
}
