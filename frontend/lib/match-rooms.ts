import { apiFetch, apiFetchJson } from "@/lib/auth";

export type RoomUser = {
  id: string;
  username: string;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
};

export type MatchRoom = {
  id: string;
  code: string;
  chatLocked: boolean;
  lastMessageAt: string | null;
  access: { role: "player" | "captain" | "staff"; teamSlot: number | null; mutedUntil: string | null };
  match: {
    id: string;
    identifier: string;
    status: string;
    scheduledAt: string | null;
    estimatedAt: string | null;
    station: string | null;
    tournament: { id: string; slug: string; title: string; game: string };
    participants: Array<{ id: string; slot: number; registrationId: string | null; displayName: string; score: string | null; result: string | null; logoUrl: string | null }>;
    veto: { id: string; code: string; status: string; format: string; revision: number } | null;
  };
  members: Array<{ id: string; role: "player" | "captain" | "staff"; teamSlot: number | null; mutedUntil: string | null; user: RoomUser }>;
};

export type MatchRoomSummary = {
  id: string;
  code: string;
  role: MatchRoom["access"]["role"];
  teamSlot: number | null;
  unreadMessages: number;
  chatLocked: boolean;
  match: {
    id: string;
    identifier: string;
    status: string;
    scheduledAt: string | null;
    tournament: { id: string; slug: string; title: string; game: string };
    participants: Array<{ slot: number; displayName: string }>;
    veto: { code: string; status: string; format: string } | null;
  };
};

export type RoomMessage = {
  id: string;
  kind: "player" | "staff" | "system";
  body: string;
  hidden: boolean;
  hiddenReason: string | null;
  sender: RoomUser | null;
  createdAt: string;
};

export type SupportRequest = {
  id: string;
  subject: string;
  status: "open" | "resolved";
  openedBy: RoomUser;
  resolvedBy: RoomUser | null;
  resolvedAt: string | null;
  createdAt: string;
  messages: Array<{ id: string; body: string; sender: RoomUser; createdAt: string }>;
};

type Envelope<T> = { success?: boolean; message?: string; data?: T };

export async function roomRequest<T>(path: string, options: Parameters<typeof apiFetch>[1] = {}) {
  const { response, data } = await apiFetchJson<Envelope<T>>(path, options);
  if (!response.ok || data.success === false || data.data === undefined) {
    throw new Error(data.message || "Match-room request failed.");
  }
  return data.data;
}
