import { useCallback, useEffect, useState } from "react";
import { Alert, ScrollView, Share, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { apiRequest, jsonBody, SITE_URL } from "@/api";
import { Button, Card, ErrorNotice, Field, PageHeader, Screen, StatusBadge } from "@/components/ui";
import { colors, radius, spacing } from "@/theme";
import type { MatchRoomDetail, MatchRoomMessage, MatchSupportRequest } from "@/types";

export default function MatchRoomScreen() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const router = useRouter();
  const [room, setRoom] = useState<MatchRoomDetail | null>(null);
  const [messages, setMessages] = useState<MatchRoomMessage[]>([]);
  const [support, setSupport] = useState<MatchSupportRequest[]>([]);
  const [message, setMessage] = useState("");
  const [supportReplies, setSupportReplies] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  const load = useCallback(async (quiet = false) => {
    if (!code) return;
    try {
      const [roomResponse, messageResponse, supportResponse] = await Promise.all([
        apiRequest<{ success: boolean; data: MatchRoomDetail }>(`/api/v1/match-rooms/${code}`),
        apiRequest<{ success: boolean; data: { items: MatchRoomMessage[] } }>(`/api/v1/match-rooms/${code}/messages`),
        apiRequest<{ success: boolean; data: MatchSupportRequest[] }>(`/api/v1/match-rooms/${code}/support`),
      ]);
      setRoom(roomResponse.data); setMessages(messageResponse.data.items); setSupport(supportResponse.data); setError("");
    } catch (caught) { if (!quiet) setError(caught instanceof Error ? caught.message : "Unable to load match room."); }
  }, [code]);
  useEffect(() => { void load(); const timer = setInterval(() => void load(true), 4_000); return () => clearInterval(timer); }, [load]);

  const run = async (key: string, path: string, method: "POST" | "PATCH", body: unknown = {}) => {
    setBusy(key);
    try { await apiRequest(path, { method, ...jsonBody(body) }); await load(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Action failed."); }
    finally { setBusy(""); }
  };

  if (!room) return <Screen><PageHeader title="Match room" subtitle="Loading staff controls" />{error ? <ErrorNotice message={error} retry={() => void load()} /> : null}</Screen>;

  return <Screen><PageHeader title={room.match.participants.map((entry) => entry.displayName).join(" vs ")} subtitle={`${room.match.tournament.title} · ${room.code}`} /><ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">{error ? <ErrorNotice message={error} retry={() => void load()} /> : null}<Card><View style={styles.row}><View style={styles.grow}><Text style={styles.eyebrow}>MATCH ROOM</Text><Text style={styles.heading}>{room.chatLocked ? "Chat locked" : "Chat open"}</Text></View><StatusBadge value={room.match.status} /></View><View style={styles.row}><Button label="Share room link" tone="secondary" onPress={() => void Share.share({ title: "Quest match room", message: `${SITE_URL}/match-room/${room.code}`, url: `${SITE_URL}/match-room/${room.code}` })} /><Button label={room.chatLocked ? "Unlock chat" : "Lock chat"} tone="secondary" loading={busy === "lock"} onPress={() => void run("lock", `/api/v1/match-rooms/${code}/chat-lock`, "PATCH", { locked: !room.chatLocked })} />{room.match.veto ? <Button label="Open veto controls" onPress={() => router.push({ pathname: "/veto-room/[id]", params: { id: room.match.veto?.id || "" } })} /> : null}</View></Card>
  <Card><Text style={styles.eyebrow}>ROSTER & MODERATION</Text>{room.members.filter((entry) => entry.role !== "staff").map((member) => <View key={member.id} style={styles.member}><View style={styles.grow}><Text style={styles.name}>{member.user.username}</Text><Text style={styles.meta}>Team {member.teamSlot || "—"} · {member.role}{member.mutedUntil ? " · muted" : ""}</Text></View><Button label={member.mutedUntil ? "Unmute" : "Mute 15m"} tone="ghost" onPress={() => void run(`mute-${member.id}`, `/api/v1/match-rooms/${code}/members/${member.id}/mute`, "PATCH", { mutedUntil: member.mutedUntil ? null : new Date(Date.now() + 15 * 60_000).toISOString() })} /></View>)}</Card>
  <Card><Text style={styles.eyebrow}>ROOM CHAT</Text>{messages.map((entry) => <View key={entry.id} style={[styles.message, entry.kind === "staff" && styles.official]}><View style={styles.row}><Text style={styles.name}>{entry.kind === "staff" ? "Official · " : ""}{entry.sender?.username || "System"}</Text>{!entry.hidden ? <Button label="Hide" tone="ghost" onPress={() => Alert.alert("Hide message", "Players will see a moderation placeholder.", [{ text: "Cancel", style: "cancel" }, { text: "Hide", style: "destructive", onPress: () => void run(`hide-${entry.id}`, `/api/v1/match-rooms/${code}/messages/${entry.id}/hide`, "POST", { reason: "Hidden by match staff" }) }])} /> : null}</View><Text style={styles.body}>{entry.body}</Text></View>)}<Field value={message} onChangeText={setMessage} multiline maxLength={1000} placeholder="Official room announcement" /><Button label="Send official announcement" loading={busy === "send"} disabled={room.chatLocked || !message.trim()} onPress={() => void (async () => { await run("send", `/api/v1/match-rooms/${code}/messages`, "POST", { body: message, official: true }); setMessage(""); })()} /></Card>
  <Card><Text style={styles.eyebrow}>MATCH SUPPORT</Text>{support.length ? support.map((request) => <View key={request.id} style={styles.ticket}><View style={styles.row}><View style={styles.grow}><Text style={styles.name}>{request.subject}</Text><Text style={styles.meta}>{request.openedBy.username} · {request.status}</Text></View>{request.status === "open" ? <Button label="Resolve" tone="secondary" onPress={() => void run(`resolve-${request.id}`, `/api/v1/match-rooms/${code}/support/${request.id}/resolve`, "POST")} /> : null}</View>{request.messages.map((entry) => <Text key={entry.id} style={styles.body}><Text style={styles.name}>{entry.sender.username}: </Text>{entry.body}</Text>)}{request.status === "open" ? <><Field value={supportReplies[request.id] || ""} onChangeText={(value) => setSupportReplies((current) => ({ ...current, [request.id]: value }))} multiline maxLength={2000} placeholder="Reply as match staff" /><Button label="Send support reply" disabled={!supportReplies[request.id]?.trim()} onPress={() => void (async () => { await run(`reply-${request.id}`, `/api/v1/match-rooms/${code}/support/${request.id}/messages`, "POST", { body: supportReplies[request.id] }); setSupportReplies((current) => ({ ...current, [request.id]: "" })); })()} /></> : null}</View>) : <Text style={styles.meta}>No support requests.</Text>}</Card></ScrollView></Screen>;
}

const styles = StyleSheet.create({ content: { padding: spacing.md, paddingTop: spacing.sm, paddingBottom: 100, gap: spacing.md }, row: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.sm }, grow: { flex: 1 }, eyebrow: { color: colors.accent, fontSize: 10, fontWeight: "900", letterSpacing: 1.5 }, heading: { color: colors.text, fontSize: 22, fontWeight: "900", marginTop: 3 }, name: { color: colors.text, fontSize: 14, fontWeight: "800" }, meta: { color: colors.muted, fontSize: 12, marginTop: 3 }, member: { flexDirection: "row", alignItems: "center", borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm }, message: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, backgroundColor: colors.background }, official: { borderColor: colors.accent, backgroundColor: "#8b5cf615" }, body: { color: colors.text, fontSize: 13, lineHeight: 19, marginTop: 5 }, ticket: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm, gap: spacing.xs } });
