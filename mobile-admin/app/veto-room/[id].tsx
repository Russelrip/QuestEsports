import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Animated, Easing, Pressable, ScrollView, Share, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import * as Haptics from "expo-haptics";
import QRCode from "react-native-qrcode-svg";
import { apiRequest, jsonBody, SITE_URL } from "@/api";
import { Button, Card, ErrorNotice, PageHeader, Screen, StatusBadge } from "@/components/ui";
import { colors, radius, spacing } from "@/theme";
import type { VetoRoom } from "@/types";

const humanize = (value: string) => value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

export default function VetoRoomControlScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [room, setRoom] = useState<VetoRoom | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [shareLink, setShareLink] = useState("");
  const [shareRole, setShareRole] = useState("");
  const coin = useRef(new Animated.Value(0)).current;
  const previousToss = useRef<string | null>(null);

  const load = useCallback(async (quiet = false) => {
    if (!id) return;
    try {
      const response = await apiRequest<{ success: boolean; data: VetoRoom }>(`/api/v1/admin/veto-rooms/${id}`);
      if (response.data.toss.result && response.data.toss.result !== previousToss.current) {
        coin.setValue(0);
        Animated.timing(coin, { toValue: 1, duration: 1100, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      previousToss.current = response.data.toss.result;
      setRoom(response.data);
      setError("");
    } catch (caught) {
      if (!quiet) setError(caught instanceof Error ? caught.message : "Could not load room.");
    }
  }, [coin, id]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { const timer = setInterval(() => void load(true), 3000); return () => clearInterval(timer); }, [load]);

  const adminCommand = async (command: string, extra: Record<string, unknown> = {}) => {
    if (!room) return;
    setBusy(command);
    try {
      const latest = await apiRequest<{ success: boolean; data: VetoRoom }>(`/api/v1/admin/veto-rooms/${room.id}`);
      const response = await apiRequest<{ success: boolean; data: VetoRoom }>(`/api/v1/admin/veto-rooms/${room.id}/${command}`, { method: "POST", ...jsonBody({ expectedRevision: latest.data.revision, ...extra }) });
      setRoom(response.data);
      setError("");
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Action failed.");
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally { setBusy(""); }
  };

  const roomAction = async (path: string, extra: Record<string, unknown>, key: string) => {
    if (!room) return;
    setBusy(key);
    try {
      const latest = await apiRequest<{ success: boolean; data: VetoRoom }>(`/api/v1/admin/veto-rooms/${room.id}`);
      const response = await apiRequest<{ success: boolean; data: VetoRoom }>(`/api/v1/veto-rooms/${room.code}/${path}`, { method: "POST", ...jsonBody({ expectedRevision: latest.data.revision, ...extra }) });
      setRoom(response.data);
      setError("");
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Action failed.");
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally { setBusy(""); }
  };

  const confirmRoomAction = ({ title, message, path, extra, key, destructive = false, note = "Players cannot undo this decision. Staff can rewind it if needed." }: { title: string; message: string; path: string; extra: Record<string, unknown>; key: string; destructive?: boolean; note?: string }) => {
    Alert.alert(title, `${message}\n\n${note}`, [
      { text: "Go back", style: "cancel" },
      { text: "Confirm", style: destructive ? "destructive" : "default", onPress: () => void roomAction(path, extra, key) },
    ]);
  };

  const rotateLink = async (role: "team_1" | "team_2" | "viewer") => {
    if (!room) return;
    setBusy(role);
    try {
      const response = await apiRequest<{ success: boolean; data: { token: string } }>(`/api/v1/admin/veto-rooms/${room.id}/rotate-link`, { method: "POST", ...jsonBody({ role }) });
      const link = `${SITE_URL}/veto/${room.code}#access=${response.data.token}`;
      setShareLink(link);
      setShareRole(humanize(role));
      await Share.share({ title: `${room.title} · ${humanize(role)}`, message: link, url: link });
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not create link."); }
    finally { setBusy(""); }
  };

  if (!room) return <Screen><PageHeader title="Veto room" subtitle="Loading LAN controls" />{error ? <ErrorNotice message={error} retry={() => void load()} /> : null}</Screen>;

  const current = room.currentAction;
  const selected = new Map(room.actions.filter((entry) => entry.mapSlug).map((entry) => [entry.mapSlug, entry]));
  const rotateY = coin.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "1800deg"] });
  const firstActor = room.steps.find((step) => step.actor)?.actor || "A";
  const currentSlot = current?.actor === "A" ? room.toss.teamASlot : current?.actor === "B" && room.toss.teamASlot ? (room.toss.teamASlot === 1 ? 2 : 1) : null;
  const currentParticipant = room.participants.find((entry) => entry.slot === currentSlot);
  const actionInstruction = current?.kind === "ban" ? "Ban one map" : current?.kind === "pick" ? `Pick Map ${current.seriesIndex || ""}`.trim() : current?.kind === "side" ? "Choose starting side" : "Resolving decider";

  return <Screen>
    <PageHeader title={room.title} subtitle={`${room.format.toUpperCase()} · Room ${room.code}`} />
    <ScrollView contentContainerStyle={styles.content}>
      {error ? <ErrorNotice message={error} retry={() => void load()} /> : null}

      <Card>
        <View style={styles.rowBetween}><View style={styles.grow}><Text style={styles.eyebrow}>MATCH STATE</Text><Text style={styles.heading}>{humanize(room.status)}</Text></View><StatusBadge value={room.status} /></View>
        <View style={styles.row}>{room.participants.map((team) => <View key={team.id} style={[styles.team, { borderTopColor: team.accentColor }]}><Text style={styles.teamName}>{team.displayName}</Text><Text style={styles.meta}>Slot {team.slot}{team.team ? ` · Team ${team.team} · ${team.team === firstActor ? "opens veto" : "waits"}` : ""}</Text><Button label={team.ready ? "Ready" : "Set ready"} tone={team.ready ? "secondary" : "primary"} onPress={() => void roomAction("ready", { slot: team.slot, ready: !team.ready }, `ready-${team.slot}`)} /></View>)}</View>
      </Card>

      <Card>
        <Text style={styles.eyebrow}>ROOM OPERATION</Text>
        <View style={styles.actions}>
          {room.status === "draft" ? <Button label="Open room" icon="lock-open-outline" loading={busy === "open"} onPress={() => void adminCommand("open")} /> : null}
          {room.teamOrderMethod === "staff_assignment" && ["draft", "open"].includes(room.status) ? <View style={styles.row}><Button label="Slot 1 is A" tone="secondary" onPress={() => void adminCommand("assign-team-a", { teamASlot: 1 })} /><Button label="Slot 2 is A" tone="secondary" onPress={() => void adminCommand("assign-team-a", { teamASlot: 2 })} /></View> : null}
          {room.status === "open" ? <Button label="Start toss / veto" icon="play-outline" loading={busy === "start"} onPress={() => void adminCommand("start")} /> : null}
          {room.status === "toss_complete" ? <Button label="Start legacy veto" icon="play-outline" loading={busy === "start"} onPress={() => void adminCommand("start")} /> : null}
          {room.status === "open" ? <Button label="Force start" tone="secondary" onPress={() => void adminCommand("start", { force: true })} /> : null}
          {["in_progress", "completed"].includes(room.status) ? <Button label="Undo last step" tone="secondary" icon="arrow-undo-outline" onPress={() => void adminCommand("rewind", { targetStep: Math.max(0, room.currentStep - 1) })} /> : null}
          <Button label="Reset room" tone="secondary" icon="refresh-outline" onPress={() => void adminCommand("reset")} />
          <Button label="Cancel room" tone="danger" icon="close-circle-outline" onPress={() => void adminCommand("cancel")} />
        </View>
      </Card>

      {room.status === "toss_pending" || room.status === "toss_complete" ? <Card>
        <Text style={styles.eyebrow}>COIN TOSS</Text>
        <Animated.View style={[styles.coin, { transform: [{ rotateY }] }]}><Text style={styles.coinText}>{room.toss.result ? room.toss.result === "heads" ? "H" : "T" : "?"}</Text></Animated.View>
        <Text style={styles.centerText}>{room.toss.result ? `${humanize(room.toss.result)} · Slot ${room.toss.winnerSlot} won` : `Slot ${room.toss.callerSlot} calls`}</Text>
        {!room.toss.result && room.toss.method === "digital" ? <View style={styles.row}><Button label="Heads" onPress={() => void roomAction("toss", { call: "heads" }, "heads")} /><Button label="Tails" onPress={() => void roomAction("toss", { call: "tails" }, "tails")} /></View> : null}
        {room.toss.winnerSlot && !room.toss.teamASlot ? <View style={styles.stack}><Text style={styles.meta}>The veto starts immediately after the winner confirms a position.</Text><View style={styles.row}><Button label={`Team A · ${firstActor === "A" ? "opens veto" : "waits"}`} onPress={() => confirmRoomAction({ title: "Choose Team A?", message: `The toss winner will become Team A, ${firstActor === "A" ? "take the first veto action" : "wait for the first veto action"}, and the veto will start immediately.`, path: "team-a", extra: { choice: "A" }, key: "choose-a", note: "Staff can reset the room if this position was chosen incorrectly." })} /><Button label={`Team B · ${firstActor === "B" ? "opens veto" : "waits"}`} onPress={() => confirmRoomAction({ title: "Choose Team B?", message: `The toss winner will become Team B, ${firstActor === "B" ? "take the first veto action" : "wait for the first veto action"}, and the veto will start immediately.`, path: "team-a", extra: { choice: "B" }, key: "choose-b", note: "Staff can reset the room if this position was chosen incorrectly." })} /></View></View> : null}
        {!room.toss.result && room.toss.method === "manual" ? <View style={styles.stack}><Text style={styles.meta}>Record the physical result using the caller's selection.</Text><View style={styles.row}><Button label="Heads / Heads" onPress={() => void adminCommand("manual-toss", { call: "heads", result: "heads" })} /><Button label="Heads / Tails" onPress={() => void adminCommand("manual-toss", { call: "heads", result: "tails" })} /></View><View style={styles.row}><Button label="Tails / Heads" tone="secondary" onPress={() => void adminCommand("manual-toss", { call: "tails", result: "heads" })} /><Button label="Tails / Tails" tone="secondary" onPress={() => void adminCommand("manual-toss", { call: "tails", result: "tails" })} /></View></View> : null}
      </Card> : null}

      {room.status === "in_progress" ? <Card>
        <Text style={styles.eyebrow}>CURRENT TURN</Text>
        <Text style={styles.heading}>{current ? `${currentParticipant?.displayName || (current.actor ? `Team ${current.actor}` : "System")} · ${actionInstruction}` : "Resolving"}</Text>
        <Text style={styles.meta}>Every selection asks for confirmation before it is locked.</Text>
        {current?.kind === "side" ? <View style={styles.row}><Button label="Attack" onPress={() => confirmRoomAction({ title: "Confirm Attack start?", message: "This locks Attack as the starting side for this map.", path: "actions", extra: { side: "attack" }, key: "attack" })} /><Button label="Defense" onPress={() => confirmRoomAction({ title: "Confirm Defense start?", message: "This locks Defense as the starting side for this map.", path: "actions", extra: { side: "defense" }, key: "defense" })} /></View> : <View style={styles.mapGrid}>{room.maps.map((map) => {
          const action = selected.get(map.slug);
          return <Pressable key={map.slug} disabled={Boolean(action) || !current || !["ban", "pick"].includes(current.kind)} onPress={() => current && confirmRoomAction({ title: `${humanize(current.kind)} ${map.name}?`, message: current.kind === "ban" ? `${map.name} will be removed from the veto.` : `${map.name} will be locked as Map ${current.seriesIndex || ""}.`, path: "actions", extra: { mapSlug: map.slug }, key: map.slug, destructive: current.kind === "ban" })} style={[styles.map, { borderTopColor: map.accentColor }, action && styles.mapUsed]}><Text style={styles.mapName}>{map.name}</Text><Text style={styles.meta}>{action ? humanize(action.kind) : current ? `Review ${current.kind}` : "Available"}</Text></Pressable>;
        })}</View>}
      </Card> : null}

      <Card><Text style={styles.eyebrow}>SHARE LINKS</Text><Text style={styles.meta}>Rotating creates a fresh private link and immediately opens the Android share sheet.</Text><View style={styles.actions}><Button label="Share Team 1" icon="share-outline" loading={busy === "team_1"} onPress={() => void rotateLink("team_1")} /><Button label="Share Team 2" icon="share-outline" loading={busy === "team_2"} onPress={() => void rotateLink("team_2")} /><Button label="Share viewer" tone="secondary" icon="eye-outline" loading={busy === "viewer"} onPress={() => void rotateLink("viewer")} /></View>{shareLink ? <View style={styles.qr}><Text style={styles.optionTitle}>{shareRole}</Text><View style={styles.qrPaper}><QRCode value={shareLink} size={190} /></View><Text selectable style={styles.link}>{shareLink}</Text></View> : null}</Card>
    </ScrollView>
  </Screen>;
}

const styles = StyleSheet.create({
  content: { padding: spacing.md, paddingTop: spacing.sm, paddingBottom: 110, gap: spacing.md }, eyebrow: { color: colors.accent, fontSize: 10, fontWeight: "900", letterSpacing: 2 }, heading: { color: colors.text, fontSize: 24, fontWeight: "900", marginTop: 4 }, grow: { flex: 1 },
  rowBetween: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm }, row: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md }, stack: { gap: spacing.sm, marginTop: spacing.md }, actions: { gap: spacing.sm, marginTop: spacing.md },
  team: { flex: 1, minWidth: 0, borderWidth: 1, borderColor: colors.border, borderTopWidth: 3, borderRadius: radius.md, padding: spacing.sm, gap: spacing.sm }, teamName: { color: colors.text, fontSize: 14, fontWeight: "900" }, meta: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  coin: { width: 120, height: 120, borderRadius: 60, alignItems: "center", justifyContent: "center", alignSelf: "center", marginTop: spacing.lg, backgroundColor: colors.accent, borderWidth: 8, borderColor: "#e9d5ff55" }, coinText: { color: "white", fontSize: 42, fontWeight: "900" }, centerText: { color: colors.text, textAlign: "center", fontWeight: "800", marginTop: spacing.md },
  mapGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.md }, map: { width: "48%", minHeight: 90, justifyContent: "flex-end", borderWidth: 1, borderColor: colors.border, borderTopWidth: 4, borderRadius: radius.md, padding: spacing.md, backgroundColor: colors.background }, mapUsed: { opacity: 0.4 }, mapName: { color: colors.text, fontSize: 17, fontWeight: "900" },
  qr: { alignItems: "center", gap: spacing.md, marginTop: spacing.lg }, optionTitle: { color: colors.text, fontSize: 17, fontWeight: "900" }, qrPaper: { backgroundColor: "white", padding: 14, borderRadius: radius.md }, link: { color: colors.muted, fontSize: 10, textAlign: "center" },
});
