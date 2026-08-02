import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useAuth } from "@/auth";
import { Button, ErrorNotice, Screen } from "@/components/ui";
import { colors, spacing } from "@/theme";

export default function OAuthReturnScreen() {
  const router = useRouter();
  const { grant } = useLocalSearchParams<{ grant?: string | string[] }>();
  const { exchangeOAuthGrant } = useAuth();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const grantToken = Array.isArray(grant) ? grant[0] : grant;
    if (!grantToken) {
      setError("The social sign-in did not return a valid grant.");
      return;
    }

    void exchangeOAuthGrant(grantToken)
      .then(() => router.replace("/(tabs)"))
      .catch((caught) => {
        setError(caught instanceof Error ? caught.message : "Social sign-in failed.");
      });
  }, [exchangeOAuthGrant, grant, router]);

  return (
    <Screen>
      <View style={styles.wrap}>
        {error ? (
          <>
            <ErrorNotice message={error} />
            <Button label="Back to sign in" tone="secondary" onPress={() => router.replace("/login")} />
          </>
        ) : (
          <>
            <ActivityIndicator size="large" color={colors.accent} />
            <Text style={styles.title}>Completing secure sign-in…</Text>
          </>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, justifyContent: "center", padding: spacing.lg, gap: spacing.md },
  title: { color: colors.text, textAlign: "center", fontSize: 18, fontWeight: "800" },
});
