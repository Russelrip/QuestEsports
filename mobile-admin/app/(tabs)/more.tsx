import { Ionicons } from "@expo/vector-icons";
import Constants from "expo-constants";
import { useState } from "react";
import { Alert, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { SITE_URL } from "@/api";
import { useAuth } from "@/auth";
import { Button, PageHeader, Screen } from "@/components/ui";
import { colors, radius, spacing } from "@/theme";

const resources = [
  { kind: "tournaments", label: "Tournaments", description: "Events, capacity and brackets", icon: "trophy-outline" as const },
  { kind: "recruitment", label: "Recruitment", description: "Review Quest applications", icon: "person-add-outline" as const },
  { kind: "messages", label: "Contact messages", description: "Read and triage support", icon: "mail-outline" as const },
  { kind: "teams", label: "Teams", description: "Saved rosters and organizations", icon: "people-circle-outline" as const },
  { kind: "users", label: "Users", description: "Accounts and roles", icon: "person-circle-outline" as const },
  { kind: "products", label: "Products", description: "Stock and publication state", icon: "shirt-outline" as const },
  { kind: "series", label: "Event series", description: "Tournament groupings", icon: "albums-outline" as const },
  { kind: "games", label: "Game categories", description: "Game artwork and visibility", icon: "game-controller-outline" as const },
  { kind: "rulebooks", label: "Rulebooks", description: "Competition rules", icon: "document-text-outline" as const },
];

export default function MoreScreen() {
  const router = useRouter();
  const { user, logout } = useAuth();
  const [busy, setBusy] = useState(false);

  const signOut = () => Alert.alert("Sign out", "End this device’s admin session?", [
    { text: "Cancel", style: "cancel" },
    { text: "Sign out", style: "destructive", onPress: () => void (async () => { setBusy(true); await logout(); setBusy(false); router.replace("/login"); })() },
  ]);

  return (
    <Screen scroll>
      <PageHeader title="More tools" subtitle={`${user?.email || "Admin"} · secure mobile session`} />
      <View style={styles.grid}>
        {resources.map((item) => (
          <Pressable key={item.kind} onPress={() => router.push({ pathname: "/resources/[kind]", params: { kind: item.kind } })} style={({ pressed }) => [styles.resource, pressed && styles.pressed]}>
            <View style={styles.icon}><Ionicons name={item.icon} size={23} color={colors.accent} /></View>
            <View style={styles.resourceText}>
              <Text style={styles.resourceTitle}>{item.label}</Text>
              <Text style={styles.resourceDescription}>{item.description}</Text>
            </View>
            <Ionicons name="chevron-forward" size={19} color={colors.muted} />
          </Pressable>
        ))}
      </View>
      <View style={styles.securityPanel}>
        <Text style={styles.panelTitle}>Security and advanced tools</Text>
        <Button label="Manage device sessions" tone="secondary" icon="phone-portrait-outline" onPress={() => router.push("/sessions")} />
        <Button label="Open full web admin" tone="secondary" icon="open-outline" onPress={() => void Linking.openURL(`${SITE_URL}/admin`)} />
        <Button label="Sign out this device" tone="danger" icon="log-out-outline" loading={busy} onPress={signOut} />
      </View>
      <Text style={styles.version}>Quest Admin · Android release channel {Constants.expoConfig?.version || "development"}</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  grid: { gap: spacing.sm },
  resource: { minHeight: 76, flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.md },
  pressed: { opacity: 0.7 },
  icon: { height: 44, width: 44, borderRadius: radius.md, alignItems: "center", justifyContent: "center", backgroundColor: "#8b5cf620" },
  resourceText: { flex: 1 },
  resourceTitle: { color: colors.text, fontWeight: "800", fontSize: 16 },
  resourceDescription: { color: colors.muted, fontSize: 12, marginTop: 2 },
  securityPanel: { marginTop: spacing.lg, padding: spacing.md, gap: spacing.sm, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg },
  panelTitle: { color: colors.text, fontSize: 17, fontWeight: "900", marginBottom: spacing.xs },
  version: { color: colors.muted, fontSize: 11, textAlign: "center", marginTop: spacing.md },
});
