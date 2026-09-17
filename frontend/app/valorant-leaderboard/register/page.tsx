import { redirect } from "next/navigation";

// Registering for the leaderboard is how a player connects VALORANT, so it
// lives on the profile now. This address stays for links already shared.
export default function ValorantLeaderboardRegisterPage() {
  redirect("/profile?tab=account#valorant-account");
}
