import { redirect } from "next/navigation";
import { buildPageMetadata, defaultPageDescriptions } from "@/lib/site";

export const dynamic = "force-dynamic";

export const metadata = buildPageMetadata({
  title: "Tournament Registration",
  description: defaultPageDescriptions.tournamentRegistration,
  path: "/tournament-registration",
  keywords: [
    "tournament registration form",
    "register team valorant",
    "e-sports sign up",
    "team roster submission",
  ],
});

export default async function TournamentRegistrationPage() {
  redirect("/tournaments");
}
