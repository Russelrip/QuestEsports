import { Ionicons } from "@expo/vector-icons";
import { useCallback, useEffect, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { apiRequest, buildQuery } from "@/api";
import { useAuth } from "@/auth";
import { Card, ErrorNotice, IconButton, PageHeader, Screen, StatusBadge } from "@/components/ui";
import { colors, formatDate, formatMoney, radius, spacing } from "@/theme";
import type { ApiEnvelope, DashboardStats, PaymentSummary, RegistrationSummary } from "@/types";

type Activity = { id: string; title: string; subtitle: string; status: string; timestamp: string; kind: "registration" | "payment" };

export default function DashboardScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      const [dashboard, registrations, payments] = await Promise.all([
        apiRequest<ApiEnvelope & { stats: DashboardStats }>("/api/admin/dashboard"),
        apiRequest<ApiEnvelope & { registrations: RegistrationSummary[] }>(`/api/admin/team-registrations${buildQuery({ pageSize: 5 })}`),
        apiRequest<ApiEnvelope & { payments: PaymentSummary[] }>(`/api/admin/payments${buildQuery({ pageSize: 5 })}`),
      ]);
      setStats(dashboard.stats);
      const registrationActivity = registrations.registrations.map((item): Activity => ({
        id: item.id,
        title: item.teamName,
        subtitle: `Registration · ${item.tournament.title}`,
        status: item.status,
        timestamp: item.createdAt,
        kind: "registration",
      }));
      const paymentActivity = payments.payments.map((item): Activity => ({
        id: item.id,
        title: item.customerName,
        subtitle: `Payment · ${formatMoney(item.amount, item.currency)}`,
        status: item.status,
        timestamp: item.createdAt,
        kind: "payment",
      }));
      setActivity([...registrationActivity, ...paymentActivity].sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp)).slice(0, 8));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load dashboard.");
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const cards = stats
    ? [
        { label: "Pending registrations", value: stats.pendingRegistrations, icon: "people-outline" as const, color: colors.accent },
        { label: "Payments to review", value: stats.pendingPayments, icon: "card-outline" as const, color: colors.warning },
        { label: "Orders to action", value: stats.actionableOrders, icon: "bag-handle-outline" as const, color: colors.info },
        { label: "Open events", value: stats.openTournaments, icon: "trophy-outline" as const, color: colors.success },
        { label: "Recruitment", value: stats.pendingRecruitmentApplications, icon: "person-add-outline" as const, color: colors.warning },
        { label: "Unread messages", value: stats.unreadContactMessages, icon: "mail-unread-outline" as const, color: colors.info },
      ]
    : [];

  return (
    <Screen>
      <PageHeader
        title={`Hi, ${user?.firstName || "Admin"}`}
        subtitle="Here’s what needs attention."
        action={<IconButton icon="refresh" label="Refresh dashboard" onPress={() => void load()} />}
      />
      {error ? <ErrorNotice message={error} retry={() => void load()} /> : null}
      <ScrollView refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} tintColor={colors.accent} />} contentContainerStyle={styles.content}>
        <View style={styles.statsGrid}>
          {cards.map((item) => (
            <View key={item.label} style={styles.statCard}>
              <View style={[styles.statIcon, { backgroundColor: `${item.color}20` }]}><Ionicons name={item.icon} size={22} color={item.color} /></View>
              <Text style={styles.statValue}>{item.value}</Text>
              <Text style={styles.statLabel}>{item.label}</Text>
            </View>
          ))}
        </View>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Recent activity</Text>
          <Text style={styles.sectionMeta}>Newest first</Text>
        </View>
        {activity.map((item) => (
          <Card key={`${item.kind}-${item.id}`} onPress={() => router.push(item.kind === "payment" ? "/(tabs)/payments" : "/(tabs)/registrations")}>
            <View style={styles.activityTop}>
              <View style={styles.activityText}>
                <Text style={styles.activityTitle}>{item.title}</Text>
                <Text style={styles.activitySubtitle}>{item.subtitle}</Text>
              </View>
              <StatusBadge value={item.status} />
            </View>
            <Text style={styles.timestamp}>{formatDate(item.timestamp)}</Text>
          </Card>
        ))}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.md, paddingTop: 0, paddingBottom: 110, gap: spacing.sm },
  statsGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.md },
  statCard: { width: "48%", flexGrow: 1, minHeight: 132, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.md },
  statIcon: { width: 40, height: 40, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
  statValue: { color: colors.text, fontWeight: "900", fontSize: 28, marginTop: spacing.sm },
  statLabel: { color: colors.muted, fontSize: 12, fontWeight: "700" },
  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", marginTop: spacing.sm, marginBottom: spacing.xs },
  sectionTitle: { color: colors.text, fontSize: 19, fontWeight: "900" },
  sectionMeta: { color: colors.muted, fontSize: 11 },
  activityTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: spacing.sm },
  activityText: { flex: 1 },
  activityTitle: { color: colors.text, fontWeight: "800", fontSize: 16 },
  activitySubtitle: { color: colors.muted, fontSize: 12, marginTop: 2 },
  timestamp: { color: colors.muted, fontSize: 11 },
});
