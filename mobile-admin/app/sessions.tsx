import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, FlatList, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { apiRequest } from "@/api";
import { useAuth } from "@/auth";
import { Button, Card, EmptyState, ErrorNotice, PageHeader, Screen, StatusBadge } from "@/components/ui";
import { colors, formatDate, spacing } from "@/theme";
import type { ApiEnvelope, SessionSummary } from "@/types";

export default function SessionsScreen() {
  const router = useRouter();
  const { logout } = useAuth();
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await apiRequest<ApiEnvelope & { sessions: SessionSummary[] }>("/api/sessions");
      setSessions(data.sessions);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load sessions.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const revoke = (session: SessionSummary) => Alert.alert(
    session.isCurrent ? "Sign out this device?" : "Revoke session?",
    session.isCurrent ? "This will return you to the login screen." : "That device will need to sign in again.",
    [
      { text: "Cancel", style: "cancel" },
      { text: "Revoke", style: "destructive", onPress: () => void (async () => {
        await apiRequest<ApiEnvelope>(`/api/sessions/${session.id}`, { method: "DELETE" });
        if (session.isCurrent) { await logout(); router.replace("/login"); }
        else await load();
      })() },
    ]
  );

  return (
    <Screen>
      <PageHeader title="Device sessions" subtitle="Review and revoke access to your account" />
      {error ? <ErrorNotice message={error} retry={() => void load()} /> : null}
      {loading ? <ActivityIndicator size="large" color={colors.accent} style={styles.loader} /> : (
        <FlatList
          data={sessions}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <Card>
              <View style={styles.top}>
                <Text style={styles.device}>{item.userAgent || "Unknown device"}</Text>
                {item.isCurrent ? <StatusBadge value="active" /> : null}
              </View>
              <Text style={styles.meta}>Last used: {formatDate(item.lastSeenAt)}</Text>
              <Text style={styles.meta}>Expires: {formatDate(item.expiresAt)}</Text>
              <Text style={styles.meta}>IP: {item.ipAddress || "Unavailable"}</Text>
              <Button label={item.isCurrent ? "Sign out this device" : "Revoke access"} tone="danger" onPress={() => revoke(item)} />
            </Card>
          )}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          ListEmptyComponent={<EmptyState title="No sessions" message="No active sessions were returned." />}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  loader: { marginTop: spacing.xl },
  list: { padding: spacing.md, paddingBottom: 60 },
  separator: { height: spacing.sm },
  top: { flexDirection: "row", justifyContent: "space-between", gap: spacing.sm },
  device: { color: colors.text, fontWeight: "800", flex: 1 },
  meta: { color: colors.muted, fontSize: 12 },
});
