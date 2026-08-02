import { useState } from "react";
import { Image, KeyboardAvoidingView, Platform, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useAuth } from "@/auth";
import { Button, ErrorNotice, Field, Screen } from "@/components/ui";
import { colors, radius, spacing } from "@/theme";

export default function LoginScreen() {
  const router = useRouter();
  const { login } = useAuth();
  const [identity, setIdentity] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setLoading(true);
    setError(null);
    try {
      await login(identity, password);
      setPassword("");
      router.replace("/mfa");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Sign in failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Screen scroll>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.wrap}>
        <View style={styles.brand}>
          <Image source={require("../assets/icon.png")} style={styles.logo} />
          <Text style={styles.eyebrow}>PRIVATE OPERATIONS</Text>
          <Text style={styles.title}>Quest Admin</Text>
          <Text style={styles.subtitle}>Secure mobile access for tournament and commerce operations.</Text>
        </View>
        <View style={styles.panel}>
          {error ? <ErrorNotice message={error} /> : null}
          <Field label="Email or username" value={identity} onChangeText={setIdentity} autoCapitalize="none" autoCorrect={false} textContentType="username" />
          <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry textContentType="password" onSubmitEditing={() => void submit()} />
          <Button label="Continue securely" icon="shield-checkmark-outline" loading={loading} disabled={!identity.trim() || !password} onPress={() => void submit()} />
          <Text style={styles.securityNote}>Admin MFA is mandatory. Your password is never stored on this device.</Text>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, justifyContent: "center", gap: spacing.xl, paddingVertical: spacing.xl },
  brand: { alignItems: "center", gap: spacing.xs },
  logo: { width: 104, height: 104, marginBottom: spacing.sm },
  eyebrow: { color: colors.accent, fontWeight: "900", letterSpacing: 2, fontSize: 11 },
  title: { color: colors.text, fontSize: 36, fontWeight: "900" },
  subtitle: { color: colors.muted, textAlign: "center", maxWidth: 320, lineHeight: 21 },
  panel: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.md },
  securityNote: { color: colors.muted, textAlign: "center", fontSize: 12, lineHeight: 18 },
});
