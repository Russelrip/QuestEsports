import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ValorantConnectionState } from "@/lib/game-accounts";

// Colour follows what the player has to do: nothing (green), wait (amber), act
// (rose), or start (neutral). The label always carries the meaning on its own,
// so the colour is never the only signal.
const toneFor: Record<ValorantConnectionState, string> = {
  connected: "border-emerald-300/25 bg-emerald-400/10 text-emerald-200",
  pending: "border-amber-300/25 bg-amber-400/10 text-amber-200",
  attention: "border-rose-300/25 bg-rose-400/10 text-rose-200",
  not_connected: "border-white/15 bg-white/6 text-slate-200",
};

export default function ValorantConnectionBadge({
  state,
  label,
  className,
}: {
  state: ValorantConnectionState;
  label: string;
  className?: string;
}) {
  return (
    <Badge className={cn("shrink-0 tracking-[0.16em]", toneFor[state], className)}>
      {label}
    </Badge>
  );
}
