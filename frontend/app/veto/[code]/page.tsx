import PageLayout from "@/components/PageLayout";
import VetoRoomView from "@/components/veto/VetoRoomView";
import { buildNoIndexMetadata } from "@/lib/site";

export const metadata = buildNoIndexMetadata(
  "Valorant Map Veto",
  "Join a live Quest E-sports Valorant map veto room.",
  "/veto",
);

export default async function VetoRoomPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return <PageLayout title="Match Veto" description="Live toss, map picks, bans, and starting-side selection."><VetoRoomView code={code} /></PageLayout>;
}
