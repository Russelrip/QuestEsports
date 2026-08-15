import { useEffect } from "react";
import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthProvider, useAuth } from "@/auth";
import { colors } from "@/theme";
import { Button } from "@/components/ui";

function AuthGate() {
  const { clearLocalSession, loading, retrySession, sessionError, user } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    const route = segments[0];
    const inLogin = route === "login";
    const inOAuth = route === "oauth";
    if (!user && !inLogin && !inOAuth) router.replace("/login");
    else if (user && (inLogin || inOAuth || !route)) router.replace("/(tabs)");
  }, [loading, router, segments, user]);

  if (loading) {
    return <View style={styles.loading}><ActivityIndicator size="large" color={colors.accent} /></View>;
  }

  if (sessionError && !user) {
    return (
      <View style={styles.sessionError}>
        <Text style={styles.sessionErrorTitle}>Unable to verify your session</Text>
        <Text style={styles.sessionErrorMessage}>{sessionError}</Text>
        <Button label="Try again" onPress={() => void retrySession()} />
        <Button label="Sign in again" tone="secondary" onPress={() => void clearLocalSession()} />
      </View>
    );
  }

  return (
    <Stack screenOptions={{ headerStyle: { backgroundColor: colors.surface }, headerTintColor: colors.text, contentStyle: { backgroundColor: colors.background } }}>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="login" options={{ headerShown: false }} />
      <Stack.Screen name="oauth" options={{ headerShown: false }} />
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="resources/[kind]" options={{ headerShown: false }} />
      <Stack.Screen name="expenses" options={{ headerShown: false }} />
      <Stack.Screen name="veto-rooms" options={{ headerShown: false }} />
      <Stack.Screen name="veto-room/[id]" options={{ headerShown: false }} />
      <Stack.Screen name="match-rooms" options={{ headerShown: false }} />
      <Stack.Screen name="match-room/[code]" options={{ headerShown: false }} />
      <Stack.Screen name="sessions" options={{ title: "Device sessions" }} />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <StatusBar style="light" />
        <AuthGate />
      </AuthProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background },
  sessionError: { flex: 1, justifyContent: "center", gap: 14, padding: 24, backgroundColor: colors.background },
  sessionErrorTitle: { color: colors.text, fontSize: 24, fontWeight: "900", textAlign: "center" },
  sessionErrorMessage: { color: colors.muted, fontSize: 14, lineHeight: 21, textAlign: "center" },
});
