import { apiFetch, apiFetchJson } from "@/lib/auth";

export type VetoStep = {
  kind: "ban" | "pick" | "decider" | "side";
  actor: "A" | "B" | null;
  seriesIndex: number | null;
};

export type VetoMap = {
  id?: string;
  slug: string;
  name: string;
  artworkUrl?: string | null;
  accentColor: string;
  available?: boolean;
};

export type VetoParticipant = {
  id: string;
  slot: 1 | 2;
  registrationId?: string | null;
  displayName: string;
  seed?: number | null;
  accentColor: string;
  ready: boolean;
  joined: boolean;
  team: "A" | "B" | null;
};

export type VetoAction = {
  id: string;
  sequence: number;
  kind: VetoStep["kind"];
  actorSlot: number | null;
  mapSlug: string | null;
  mapName: string | null;
  side: "attack" | "defense" | null;
  payload: { seriesIndex?: number | null };
  createdAt: string;
};

export type VetoRoom = {
  id: string;
  code: string;
  title: string;
  format: "bo1" | "bo3" | "bo5" | "custom";
  status: "draft" | "open" | "toss_pending" | "toss_complete" | "in_progress" | "completed" | "cancelled";
  revision: number;
  controlMode: "captain_or_link" | "link_only" | "staff_only";
  teamOrderMethod: "toss" | "slot_order" | "higher_seed" | "lower_seed" | "staff_assignment";
  toss: {
    method: "digital" | "manual";
    callerSlot: 1 | 2;
    call: "heads" | "tails" | null;
    result: "heads" | "tails" | null;
    winnerSlot: 1 | 2 | null;
    teamASlot: 1 | 2 | null;
  };
  timer: { seconds: number | null; deadline: string | null };
  viewerEnabled: boolean;
  publishResult: boolean;
  tournament?: { id: string; slug: string; title: string; game: string } | null;
  match?: { id: string; identifier: string | null; status: string; scheduledAt: string | null } | null;
  participants: VetoParticipant[];
  maps: VetoMap[];
  steps: VetoStep[];
  currentStep: number;
  currentAction: VetoStep | null;
  actions: VetoAction[];
  access: { kind: "staff" | "team" | "viewer" | "public"; slot: 1 | 2 | null };
  timestamps: { openedAt: string | null; startedAt: string | null; completedAt: string | null; cancelledAt: string | null; updatedAt: string };
};

export type VetoCatalog = {
  maps: VetoMap[];
  pools: Array<{ id: string; name: string; version: number; tournamentId?: string | null; maps: VetoMap[] }>;
  presets: Array<{ id: string; name: string; format: VetoRoom["format"]; version: number; steps: VetoStep[]; tournamentId?: string | null }>;
  templates: Array<{ id: string; name: string; format: VetoRoom["format"]; version: number; mapPoolId: string; rulePresetId: string; settings: Record<string, unknown>; tournamentId?: string | null }>;
};

type Envelope<T> = { success?: boolean; message?: string; data?: T };

export async function vetoRequest<T>(path: string, options: Parameters<typeof apiFetch>[1] = {}) {
  const { response, data } = await apiFetchJson<Envelope<T>>(path, options);
  if (!response.ok || data.success === false || data.data === undefined) {
    throw new Error(data.message || "Veto request failed.");
  }
  return data.data;
}

export const readVetoToken = (code: string) => {
  if (typeof window === "undefined") return "";
  const key = `quest.veto.${code}`;
  const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const incoming = fragment.get("access");
  if (incoming) {
    sessionStorage.setItem(key, incoming);
    history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
  }
  return incoming || sessionStorage.getItem(key) || "";
};

export const vetoTokenHeaders = (token: string): Record<string, string> => token ? { "X-Veto-Token": token } : {};
