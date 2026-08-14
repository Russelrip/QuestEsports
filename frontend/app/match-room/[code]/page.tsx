import type { Metadata } from "next";
import MatchRoomView from "@/components/match-rooms/MatchRoomView";

export const metadata: Metadata = { title: "Match Room | Quest E-sports", robots: { index: false, follow: false } };

export default async function MatchRoomPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return <MatchRoomView code={code} />;
}
