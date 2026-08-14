import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { apiRequest } from "@/api";
import { Card, EmptyState, ErrorNotice, PageHeader, Screen, StatusBadge } from "@/components/ui";
import { colors, spacing } from "@/theme";
import type { MatchRoomSummary } from "@/types";

export default function MatchRoomsScreen() {
  const router = useRouter();
  const [rooms, setRooms] = useState<MatchRoomSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      const response = await apiRequest<{ success: boolean; data: MatchRoomSummary[] }>("/api/v1/admin/match-rooms");
      setRooms(response.data || []); setError("");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to load match rooms."); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  return <Screen><PageHeader title="Match rooms" subtitle="Chat, support and official updates" />{loading ? <View style={styles.center}><ActivityIndicator size="large" color={colors.accent} /></View> : <ScrollView refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} tintColor={colors.accent} />} contentContainerStyle={styles.content}>{error ? <ErrorNotice message={error} retry={() => void load()} /> : null}{rooms.map((room) => <Card key={room.id} onPress={() => router.push({ pathname: "/match-room/[code]", params: { code: room.code } })}><View style={styles.row}><View style={styles.grow}><Text style={styles.title}>{room.match.participants.map((entry) => entry.displayName).join(" vs ")}</Text><Text style={styles.meta}>{room.match.tournament.title} · {room.match.identifier}</Text><Text style={styles.meta}>{room.messageCount} messages · {room.openSupportCount} open support</Text></View><StatusBadge value={room.match.status} /></View></Card>)}{!rooms.length && !error ? <EmptyState title="No active match rooms" message="Rooms appear when scheduled matches have two registered teams." /> : null}</ScrollView>}</Screen>;
}

const styles = StyleSheet.create({ center: { flex: 1, alignItems: "center", justifyContent: "center" }, content: { padding: spacing.md, gap: spacing.sm, paddingBottom: 80 }, row: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm }, grow: { flex: 1 }, title: { color: colors.text, fontSize: 16, fontWeight: "900" }, meta: { color: colors.muted, fontSize: 12, marginTop: 4 } });
