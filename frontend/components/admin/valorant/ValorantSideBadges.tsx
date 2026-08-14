"use client";

import { Badge } from "@/components/ui/badge";
import type { ValorantSide } from "@/lib/valorant";

const sideLabel = (side: ValorantSide) => (side === "red" ? "Red" : "Blue");

export default function ValorantSideBadges({
  teamASide,
  teamBSide,
}: {
  teamASide: ValorantSide;
  teamBSide: ValorantSide;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge>Team A: {sideLabel(teamASide)}</Badge>
      <Badge>Team B: {sideLabel(teamBSide)}</Badge>
    </div>
  );
}
