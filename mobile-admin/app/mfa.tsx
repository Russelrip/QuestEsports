import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { useAuth } from "@/auth";
import { Button, ErrorNotice, Field, Screen } from "@/components/ui";
import { colors, radius, spacing } from "@/theme";

export default function MfaScreen() {
  const router = useRouter();
  const { verifyMfa, cancelMfa } = useAuth();
  const [code, setCode] = useState("");
  const [backupMode, setBackupMode] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const verify = async () => {
    setLoading(true);
    setError(null);
    try {
      await verifyMfa(code.trim(), backupMode);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace("/(tabs)");
    } catch (caught) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setError(caught instanceof Error ? caught.message : "Verification failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Screen scroll>
      <View style={styles.wrap}>
        <Text style={styles.eyebrow}>SECOND FACTOR</Text>
        <Text style={styles.title}>Verify it’s you</Text>
        <Text style={styles.subtitle}>{backupMode ? "Enter one unused recovery code." : "Enter the six-digit code from your authenticator app."}</Text>
        <View style={styles.panel}>
          {error ? <ErrorNotice message={error} /> : null}
          <Field
            label={backupMode ? "Recovery code" : "Authenticator code"}
            value={code}
            onChangeText={setCode}
            autoCapitalize={backupMode ? "characters" : "none"}
            keyboardType={backupMode ? "default" : "number-pad"}
            maxLength={backupMode ? 16 : 6}
            textAlign="center"
            style={styles.code}
            onSubmitEditing={() => void verify()}
          />
          <Button label="Verify and open admin" loading={loading} disabled={code.trim().length < 6} onPress={() => void verify()} />
          <Button label={backupMode ? "Use authenticator code" : "Use a recovery code"} tone="ghost" onPress={() => { setBackupMode((value) => !value); setCode(""); }} />
          <Button label="Back to sign in" tone="secondary" onPress={() => { cancelMfa(); router.replace("/login"); }} />
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, justifyContent: "center", gap: spacing.sm, paddingVertical: spacing.xl },
  eyebrow: { color: colors.accent, fontWeight: "900", letterSpacing: 2, fontSize: 11, textAlign: "center" },
  title: { color: colors.text, fontSize: 32, fontWeight: "900", textAlign: "center" },
  subtitle: { color: colors.muted, textAlign: "center", marginBottom: spacing.lg },
  panel: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.md },
  code: { fontSize: 24, fontWeight: "800", letterSpacing: 5 },
});
